import {
  IdentityKeyPair,
  KyberPreKeyRecord,
  PreKeyBundle,
  PreKeyRecord,
  type PreKeySignalMessage,
  ProtocolAddress,
  SessionBuilder,
  SessionCipher,
  type SignalMessage,
  SignedPreKeyRecord,
} from 'expo-libsignal'
import { SQLCipherProtocolStore } from 'expo-libsignal/stores'
import { useEffect, useState } from 'react'
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native'

interface StepResult {
  label: string
  detail: string
  ok: boolean
}

const utf8Encode = (s: string) => new TextEncoder().encode(s)
const utf8Decode = (b: Uint8Array) => new TextDecoder().decode(b)

const PRE_KEY_ID = 11
const SIGNED_PRE_KEY_ID = 7
const KYBER_PRE_KEY_ID = 101
const DECOY_KYBER_PRE_KEY_ID = 100

interface PersistedPersona {
  store: SQLCipherProtocolStore
  address: ProtocolAddress
}

async function openPersona(name: string): Promise<PersistedPersona> {
  const store = await SQLCipherProtocolStore.open({
    databaseName: `${name}.db`,
    keyAlias: `expo-libsignal-example.${name}.dbkey`,
  })
  const address = await ProtocolAddress.create(`${name}-persisted`, 1)
  return { store, address }
}

function cipherStores(store: SQLCipherProtocolStore) {
  return {
    sessionStore: store,
    identityStore: store,
    preKeyStore: store,
    signedPreKeyStore: store,
    kyberPreKeyStore: store,
  }
}

export default function PersistenceScreen() {
  const [steps, setSteps] = useState<StepResult[]>([])
  const [status, setStatus] = useState<'idle' | 'running' | 'ok' | 'fail'>('idle')
  const [runKind, setRunKind] = useState<'fresh' | 'resumed' | null>(null)

  async function run() {
    setStatus('running')
    const results: StepResult[] = []
    const push = (s: StepResult) => results.push(s)
    let alice: PersistedPersona | null = null
    let bob: PersistedPersona | null = null
    let kind: 'fresh' | 'resumed' = 'fresh'
    let kyberUsedId: number | null = null
    try {
      alice = await openPersona('alice')
      bob = await openPersona('bob')
      const bobPersona = bob
      push({
        label: '1. Open SQLCipher stores',
        detail: 'alice.db + bob.db (WAL, migrated)',
        ok: true,
      })

      const resumed =
        (await alice.store.hasLocalIdentity()) &&
        (await bob.store.hasLocalIdentity()) &&
        (await alice.store.loadSession(bob.address)) !== null
      kind = resumed ? 'resumed' : 'fresh'
      setRunKind(kind)

      // Observe which kyber id the decrypt marks used, via an interface-level
      // wrapper around Bob's store (the library needs no debug surface).
      const recordingKyberStore = {
        loadKyberPreKey: (id: number) => bobPersona.store.loadKyberPreKey(id),
        loadKyberPreKeys: () => bobPersona.store.loadKyberPreKeys(),
        storeKyberPreKey: (id: number, r: KyberPreKeyRecord) =>
          bobPersona.store.storeKyberPreKey(id, r),
        markKyberPreKeyUsed: async (id: number) => {
          kyberUsedId = id
          await bobPersona.store.markKyberPreKeyUsed(id)
        },
      }

      const aliceCipher = new SessionCipher(cipherStores(alice.store), bob.address, alice.address)
      const bobCipher = new SessionCipher(
        { ...cipherStores(bob.store), kyberPreKeyStore: recordingKyberStore },
        alice.address,
        bob.address,
      )

      if (!resumed) {
        const aliceIdentity = await IdentityKeyPair.generate()
        const bobIdentity = await IdentityKeyPair.generate()
        await alice.store.initializeLocalIdentity(
          aliceIdentity,
          1 + Math.floor(Math.random() * 0x3fff),
        )
        await bob.store.initializeLocalIdentity(
          bobIdentity,
          1 + Math.floor(Math.random() * 0x3fff),
        )
        push({ label: '2. Initialize identities', detail: 'persisted to local_identity', ok: true })

        const ts = Date.now()
        const preKey = await PreKeyRecord.generate(PRE_KEY_ID)
        const signedPreKey = await SignedPreKeyRecord.generate(SIGNED_PRE_KEY_ID, bobIdentity, ts)
        const kyberPreKey = await KyberPreKeyRecord.generate(KYBER_PRE_KEY_ID, bobIdentity, ts)
        const decoy = await KyberPreKeyRecord.generate(DECOY_KYBER_PRE_KEY_ID, bobIdentity, ts)
        await bob.store.storePreKey(PRE_KEY_ID, preKey)
        await bob.store.storeSignedPreKey(SIGNED_PRE_KEY_ID, signedPreKey)
        await bob.store.storeKyberPreKey(KYBER_PRE_KEY_ID, kyberPreKey)
        await bob.store.storeKyberPreKey(DECOY_KYBER_PRE_KEY_ID, decoy)
        const bundle = await PreKeyBundle.create({
          registrationId: await bob.store.getLocalRegistrationId(),
          deviceId: bob.address.deviceId(),
          identityKey: bobIdentity.publicKey(),
          signedPreKeyId: SIGNED_PRE_KEY_ID,
          signedPreKeyPublic: signedPreKey.publicKey(),
          signedPreKeySignature: signedPreKey.signature(),
          kyberPreKeyId: KYBER_PRE_KEY_ID,
          kyberPreKeyPublic: kyberPreKey.kyberPublicKey(),
          kyberPreKeySignature: kyberPreKey.signature(),
          preKeyId: PRE_KEY_ID,
          preKeyPublic: preKey.publicKey(),
        })
        push({
          label: '3. Bob publishes bundle',
          detail: `kyber=${KYBER_PRE_KEY_ID}, decoy=${DECOY_KYBER_PRE_KEY_ID}, signed=${SIGNED_PRE_KEY_ID}`,
          ok: true,
        })

        const builder = new SessionBuilder(
          { sessionStore: alice.store, identityStore: alice.store },
          bob.address,
          alice.address,
        )
        await alice.store.runExclusive(() => builder.processPreKeyBundle(bundle))
        push({ label: '4. Alice processPreKeyBundle', detail: 'session persisted', ok: true })

        const msg1 = await alice.store.runExclusive(() =>
          aliceCipher.encrypt(utf8Encode('hello bob')),
        )
        const ok1 = msg1.type === 'preKeySignal'
        push({ label: '5. Alice encrypts', detail: `type=${msg1.type}`, ok: ok1 })
        if (!ok1) throw new Error('expected preKeySignal')

        const recovered = await bob.store.runExclusive(() =>
          bobCipher.decryptPreKeySignal(msg1 as PreKeySignalMessage),
        )
        push({
          label: '6. Bob decryptPreKeySignal',
          detail: `plaintext="${utf8Decode(recovered)}"`,
          ok: utf8Decode(recovered) === 'hello bob',
        })

        const kyberOk = kyberUsedId === KYBER_PRE_KEY_ID
        push({
          label: '7. Kyber id mapping',
          detail: `marked used: ${kyberUsedId} (expected ${KYBER_PRE_KEY_ID}, decoy ${DECOY_KYBER_PRE_KEY_ID} present)`,
          ok: kyberOk,
        })
        if (!kyberOk) throw new Error('wrong kyber prekey marked used')

        const msg2 = await bob.store.runExclusive(() => bobCipher.encrypt(utf8Encode('hi alice')))
        const recovered2 = await alice.store.runExclusive(() =>
          aliceCipher.decryptSignal(msg2 as SignalMessage),
        )
        push({
          label: '8. Bob replies, Alice decrypts',
          detail: `type=${msg2.type} plaintext="${utf8Decode(recovered2)}"`,
          ok: msg2.type === 'signal' && utf8Decode(recovered2) === 'hi alice',
        })
        push({
          label: '9. Restart the app to test persistence',
          detail: 'next run should report run=resumed',
          ok: true,
        })
      } else {
        // No handshake: the session must already be on disk, so the first
        // message is an ordinary ratcheted 'signal' message.
        const msg = await alice.store.runExclusive(() =>
          aliceCipher.encrypt(utf8Encode('persisted hello')),
        )
        const okType = msg.type === 'signal'
        push({
          label: '2. Alice encrypts with persisted session',
          detail: `type=${msg.type}`,
          ok: okType,
        })
        if (!okType) throw new Error('expected signal (session should be persisted)')

        const recovered = await bob.store.runExclusive(() =>
          bobCipher.decryptSignal(msg as SignalMessage),
        )
        push({
          label: '3. Bob decrypts with persisted session',
          detail: `plaintext="${utf8Decode(recovered)}"`,
          ok: utf8Decode(recovered) === 'persisted hello',
        })

        const reply = await bob.store.runExclusive(() => bobCipher.encrypt(utf8Encode('still here')))
        const recovered2 = await alice.store.runExclusive(() =>
          aliceCipher.decryptSignal(reply as SignalMessage),
        )
        push({
          label: '4. Bob replies, Alice decrypts',
          detail: `plaintext="${utf8Decode(recovered2)}"`,
          ok: utf8Decode(recovered2) === 'still here',
        })
      }

      const pass = results.every((r) => r.ok)
      console.log(
        '[SQLCIPHER-SUMMARY]',
        JSON.stringify({
          run: kind,
          pass,
          kyberUsedId,
          steps: results.map((r) => ({ label: r.label, ok: r.ok, detail: r.detail })),
        }),
      )
      setSteps(results)
      setStatus(pass ? 'ok' : 'fail')
    } catch (e) {
      results.push({ label: 'error', detail: String(e), ok: false })
      console.log(
        '[SQLCIPHER-SUMMARY]',
        JSON.stringify({
          run: kind,
          pass: false,
          kyberUsedId,
          steps: results.map((r) => ({ label: r.label, ok: r.ok, detail: r.detail })),
        }),
      )
      setSteps(results)
      setStatus('fail')
    } finally {
      await alice?.store.close().catch(() => {})
      await bob?.store.close().catch(() => {})
    }
  }

  async function wipe() {
    setStatus('running')
    try {
      const alice = await openPersona('alice')
      await alice.store.wipe()
      const bob = await openPersona('bob')
      await bob.store.wipe()
      setSteps([
        {
          label: 'wiped',
          detail: 'both stores and keys deleted; re-run for a fresh handshake',
          ok: true,
        },
      ])
      setRunKind(null)
      setStatus('idle')
    } catch (e) {
      setSteps([{ label: 'wipe failed', detail: String(e), ok: false }])
      setStatus('fail')
    }
  }

  useEffect(() => {
    run()
  }, [])

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Persistence: SQLCipher stores</Text>
      <Text style={[styles.status, statusStyle(status)]}>
        Status: {status}
        {runKind ? ` (run=${runKind})` : ''}
      </Text>
      <Button title="Re-run" onPress={run} />
      <Button title="Wipe both stores" onPress={wipe} />
      <View style={{ height: 8 }} />
      {steps.map((s, i) => (
        <View key={i} style={styles.row}>
          <Text style={[styles.label, { color: s.ok ? '#0a0' : '#a00' }]}>
            {s.ok ? '[OK]' : '[X]'} {s.label}
          </Text>
          <Text style={styles.detail}>{s.detail}</Text>
        </View>
      ))}
    </ScrollView>
  )
}

function statusStyle(s: string) {
  if (s === 'ok') return { color: '#0a0' }
  if (s === 'fail') return { color: '#a00' }
  return { color: '#666' }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, gap: 8 },
  title: { fontSize: 18, fontWeight: '600' },
  status: { fontSize: 14, fontFamily: 'Courier' },
  row: { paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#ddd' },
  label: { fontSize: 13, fontWeight: '600' },
  detail: { fontSize: 11, fontFamily: 'Courier', color: '#333' },
})
