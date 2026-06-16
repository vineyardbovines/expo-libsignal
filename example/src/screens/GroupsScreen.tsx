import { open as openOpSqlite } from '@op-engineering/op-sqlite'
import * as SecureStore from 'expo-secure-store'
import {
  GroupCipher,
  GroupSessionBuilder,
  IdentityKeyPair,
  KyberPreKeyRecord,
  PreKeyBundle,
  PreKeyRecord,
  type PreKeySignalMessage,
  ProtocolAddress,
  SenderKeyDistributionMessage,
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

// Per-pair id namespacing so each receiver can publish a fresh one-time prekey
// per inbound peer (one-time prekeys cannot be reused). The receiver is the
// first axis, the sender is the second.
const PRE_KEY_ID_PREFIX = 100
const PRE_KEY_IDS = {
  alice: { bob: 110, carol: 111 },
  bob: { alice: 120, carol: 121 },
  carol: { alice: 130, bob: 131 },
} as const
const SIGNED_PRE_KEY_IDS = { alice: 210, bob: 220, carol: 230 } as const
const KYBER_PRE_KEY_IDS = { alice: 310, bob: 320, carol: 330 } as const

// Stable distribution ids so resumed-run detection works without a side
// channel; UUID v4 format because libsignal requires UUID strings.
// Production senders would call crypto.randomUUID() once per group.
const ALICE_DIST_ID = '00000000-0000-4000-8000-0000000a11ce'
const BOB_DIST_ID = '00000000-0000-4000-8000-00000000b0b0'

type PersonaName = 'alice' | 'bob' | 'carol'

interface GroupPersona {
  name: PersonaName
  store: SQLCipherProtocolStore
  address: ProtocolAddress
}

const personaDb = (name: PersonaName) => `${name}.group.db`
const personaKeyAlias = (name: PersonaName) => `expo-libsignal-example.${name}.group.dbkey`

async function openPersona(name: PersonaName): Promise<GroupPersona> {
  const store = await SQLCipherProtocolStore.open({
    databaseName: personaDb(name),
    keyAlias: personaKeyAlias(name),
  })
  const address = await ProtocolAddress.create(`${name}-group`, 1)
  return { name, store, address }
}

async function forceWipePersona(name: PersonaName): Promise<string | null> {
  let detail: string | null = null
  try {
    const db = openOpSqlite({ name: personaDb(name) })
    db.delete()
  } catch (e) {
    detail = `op-sqlite delete failed: ${String(e)}`
  }
  try {
    const alias = personaKeyAlias(name)
    await SecureStore.deleteItemAsync(alias, { keychainService: alias })
  } catch (e) {
    detail = `${detail ? `${detail}; ` : ''}secure-store delete failed: ${String(e)}`
  }
  return detail
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

async function ensureIdentity(p: GroupPersona): Promise<void> {
  if (await p.store.hasLocalIdentity()) return
  const identity = await IdentityKeyPair.generate()
  await p.store.initializeLocalIdentity(identity, 1 + Math.floor(Math.random() * 0x3fff))
}

// Publish a one-time prekey bundle on `receiver` and have `sender` consume it
// to build a 1:1 session. Each pair uses distinct prekey ids so the receiver
// can serve every sender without reusing one-time prekeys.
async function establishOneToOne(
  sender: GroupPersona,
  receiver: GroupPersona,
  preKeyId: number,
  signedPreKeyId: number,
  kyberPreKeyId: number,
): Promise<void> {
  const existing = await sender.store.loadSession(receiver.address)
  if (existing !== null) return

  const receiverIdentity = await receiver.store.getIdentityKeyPair()
  const receiverRegId = await receiver.store.getLocalRegistrationId()
  const ts = Date.now()
  const preKey = await PreKeyRecord.generate(preKeyId)
  const signedPreKey = await SignedPreKeyRecord.generate(signedPreKeyId, receiverIdentity, ts)
  const kyberPreKey = await KyberPreKeyRecord.generate(kyberPreKeyId, receiverIdentity, ts)
  // Decoy proves the kyber id mapping: store an extra record at id+1 so the
  // receiver has two kyber records and the op resolves the bundle's, not the
  // decoy's.
  const decoy = await KyberPreKeyRecord.generate(kyberPreKeyId + 1, receiverIdentity, ts)
  await receiver.store.runExclusive(async () => {
    await receiver.store.storePreKey(preKeyId, preKey)
    await receiver.store.storeSignedPreKey(signedPreKeyId, signedPreKey)
    await receiver.store.storeKyberPreKey(kyberPreKeyId, kyberPreKey)
    await receiver.store.storeKyberPreKey(kyberPreKeyId + 1, decoy)
  })

  const bundle = await PreKeyBundle.create({
    registrationId: receiverRegId,
    deviceId: receiver.address.deviceId(),
    identityKey: receiverIdentity.publicKey(),
    signedPreKeyId,
    signedPreKeyPublic: signedPreKey.publicKey(),
    signedPreKeySignature: signedPreKey.signature(),
    kyberPreKeyId,
    kyberPreKeyPublic: kyberPreKey.kyberPublicKey(),
    kyberPreKeySignature: kyberPreKey.signature(),
    preKeyId,
    preKeyPublic: preKey.publicKey(),
  })
  const builder = new SessionBuilder(
    { sessionStore: sender.store, identityStore: sender.store },
    receiver.address,
    sender.address,
  )
  await sender.store.runExclusive(() => builder.processPreKeyBundle(bundle))
}

// Ship `bytes` from sender to receiver over their existing 1:1 session. The
// receiver tries decryptSignal first (resumed runs have a ratcheted session
// already) and falls back to decryptPreKeySignal for the fresh first message.
async function send1to1(
  sender: GroupPersona,
  receiver: GroupPersona,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  const senderCipher = new SessionCipher(
    cipherStores(sender.store),
    receiver.address,
    sender.address,
  )
  const receiverCipher = new SessionCipher(
    cipherStores(receiver.store),
    sender.address,
    receiver.address,
  )
  const msg = await sender.store.runExclusive(() => senderCipher.encrypt(bytes))
  if (msg.type === 'preKeySignal') {
    return receiver.store.runExclusive(() =>
      receiverCipher.decryptPreKeySignal(msg as PreKeySignalMessage),
    )
  }
  return receiver.store.runExclusive(() => receiverCipher.decryptSignal(msg as SignalMessage))
}

async function shipSenderKey(
  sender: GroupPersona,
  receiver: GroupPersona,
  distributionId: string,
): Promise<void> {
  const skdm = await sender.store.runExclusive(() =>
    new GroupSessionBuilder(sender.store).createSenderKeyDistributionMessage(
      sender.address,
      distributionId,
    ),
  )
  const recovered = await send1to1(sender, receiver, skdm.serialize())
  const parsed = await SenderKeyDistributionMessage.deserialize(recovered)
  await receiver.store.runExclusive(() =>
    new GroupSessionBuilder(receiver.store).processSenderKeyDistributionMessage(
      sender.address,
      parsed,
    ),
  )
}

export default function GroupsScreen() {
  const [steps, setSteps] = useState<StepResult[]>([])
  const [status, setStatus] = useState<'idle' | 'running' | 'ok' | 'fail'>('idle')
  const [runKind, setRunKind] = useState<'fresh' | 'resumed' | null>(null)

  async function run() {
    setStatus('running')
    const results: StepResult[] = []
    const push = (s: StepResult) => results.push(s)
    let alice: GroupPersona | null = null
    let bob: GroupPersona | null = null
    let carol: GroupPersona | null = null
    let kind: 'fresh' | 'resumed' = 'fresh'
    try {
      alice = await openPersona('alice')
      bob = await openPersona('bob')
      carol = await openPersona('carol')
      push({
        label: '1. Open SQLCipher stores',
        detail: 'alice.group.db + bob.group.db + carol.group.db',
        ok: true,
      })

      const hasIds =
        (await alice.store.hasLocalIdentity()) &&
        (await bob.store.hasLocalIdentity()) &&
        (await carol.store.hasLocalIdentity())
      // Resumed = all three have identities AND alice's sender key for the
      // group's distribution id is on disk for both bob and carol. That means
      // a prior run completed the SKDM distribution step.
      const resumed =
        hasIds &&
        (await bob.store.loadSenderKey(alice.address, ALICE_DIST_ID)) !== null &&
        (await carol.store.loadSenderKey(alice.address, ALICE_DIST_ID)) !== null
      kind = resumed ? 'resumed' : 'fresh'
      setRunKind(kind)

      if (!resumed) {
        await ensureIdentity(alice)
        await ensureIdentity(bob)
        await ensureIdentity(carol)
        push({ label: '2. Initialize identities', detail: 'alice + bob + carol', ok: true })

        // Six 1:1 sessions: every ordered pair (sender -> receiver) needs the
        // sender to have a Session for the receiver before SKDM can ship.
        await establishOneToOne(
          alice,
          bob,
          PRE_KEY_IDS.bob.alice,
          SIGNED_PRE_KEY_IDS.bob,
          KYBER_PRE_KEY_IDS.bob,
        )
        await establishOneToOne(
          alice,
          carol,
          PRE_KEY_IDS.carol.alice,
          SIGNED_PRE_KEY_IDS.carol,
          KYBER_PRE_KEY_IDS.carol,
        )
        await establishOneToOne(
          bob,
          alice,
          PRE_KEY_IDS.alice.bob,
          SIGNED_PRE_KEY_IDS.alice,
          KYBER_PRE_KEY_IDS.alice,
        )
        await establishOneToOne(
          bob,
          carol,
          PRE_KEY_IDS.carol.bob,
          SIGNED_PRE_KEY_IDS.carol + 1,
          KYBER_PRE_KEY_IDS.carol + 2,
        )
        await establishOneToOne(
          carol,
          alice,
          PRE_KEY_IDS.alice.carol,
          SIGNED_PRE_KEY_IDS.alice + 1,
          KYBER_PRE_KEY_IDS.alice + 2,
        )
        await establishOneToOne(
          carol,
          bob,
          PRE_KEY_IDS.bob.carol,
          SIGNED_PRE_KEY_IDS.bob + 1,
          KYBER_PRE_KEY_IDS.bob + 2,
        )
        push({
          label: '3. Establish 6 pairwise 1:1 sessions',
          detail: `prefix=${PRE_KEY_ID_PREFIX} (alice<->bob, alice<->carol, bob<->carol)`,
          ok: true,
        })

        await shipSenderKey(alice, bob, ALICE_DIST_ID)
        await shipSenderKey(alice, carol, ALICE_DIST_ID)
        push({
          label: '4. Alice ships SKDM to bob and carol',
          detail: `distribution=${ALICE_DIST_ID}`,
          ok: true,
        })
      } else {
        push({
          label: '2. Resumed run',
          detail: 'identities + sender keys already on disk; skipping handshake',
          ok: true,
        })
      }

      // Alice group-encrypts; bob and carol decrypt.
      const aliceCipher = new GroupCipher(alice.store, alice.address)
      const aliceCiphertext = await alice.store.runExclusive(() =>
        aliceCipher.encrypt(ALICE_DIST_ID, utf8Encode('hello group')),
      )
      const bobAsAlice = new GroupCipher(bob.store, alice.address)
      const carolAsAlice = new GroupCipher(carol.store, alice.address)
      const bobGot = utf8Decode(
        await bob.store.runExclusive(() => bobAsAlice.decrypt(ALICE_DIST_ID, aliceCiphertext)),
      )
      const carolGot = utf8Decode(
        await carol.store.runExclusive(() => carolAsAlice.decrypt(ALICE_DIST_ID, aliceCiphertext)),
      )
      push({
        label: `${resumed ? '3' : '5'}. Alice group-encrypt "hello group"`,
        detail: `bob="${bobGot}" carol="${carolGot}" bytes=${aliceCiphertext.length}`,
        ok: bobGot === 'hello group' && carolGot === 'hello group',
      })

      if (!resumed) {
        // Bob also creates a distribution and ships it to alice + carol.
        await shipSenderKey(bob, alice, BOB_DIST_ID)
        await shipSenderKey(bob, carol, BOB_DIST_ID)
        push({
          label: '6. Bob ships SKDM to alice and carol',
          detail: `distribution=${BOB_DIST_ID}`,
          ok: true,
        })

        const bobCipher = new GroupCipher(bob.store, bob.address)
        const bobCiphertext = await bob.store.runExclusive(() =>
          bobCipher.encrypt(BOB_DIST_ID, utf8Encode('hi from bob')),
        )
        const aliceAsBob = new GroupCipher(alice.store, bob.address)
        const carolAsBob = new GroupCipher(carol.store, bob.address)
        const aliceGot = utf8Decode(
          await alice.store.runExclusive(() => aliceAsBob.decrypt(BOB_DIST_ID, bobCiphertext)),
        )
        const carolGotFromBob = utf8Decode(
          await carol.store.runExclusive(() => carolAsBob.decrypt(BOB_DIST_ID, bobCiphertext)),
        )
        push({
          label: '7. Bob group-encrypt "hi from bob"',
          detail: `alice="${aliceGot}" carol="${carolGotFromBob}" bytes=${bobCiphertext.length}`,
          ok: aliceGot === 'hi from bob' && carolGotFromBob === 'hi from bob',
        })
        push({
          label: '8. Restart the app to test persistence',
          detail: 'next run should report run=resumed',
          ok: true,
        })
      }

      const pass = results.every((r) => r.ok)
      console.log(
        '[GROUPS-SUMMARY]',
        JSON.stringify({
          status: pass ? 'ok' : 'fail',
          runKind: kind,
          steps: results.map((r) => ({ label: r.label, ok: r.ok, detail: r.detail })),
        }),
      )
      setSteps(results)
      setStatus(pass ? 'ok' : 'fail')
    } catch (e) {
      results.push({ label: 'error', detail: String(e), ok: false })
      console.log(
        '[GROUPS-SUMMARY]',
        JSON.stringify({
          status: 'fail',
          runKind: kind,
          steps: results.map((r) => ({ label: r.label, ok: r.ok, detail: r.detail })),
        }),
      )
      setSteps(results)
      setStatus('fail')
    } finally {
      await alice?.store.close().catch(() => {})
      await bob?.store.close().catch(() => {})
      await carol?.store.close().catch(() => {})
    }
  }

  async function wipe() {
    setStatus('running')
    const results: StepResult[] = []
    for (const name of ['alice', 'bob', 'carol'] as const) {
      try {
        const persona = await openPersona(name)
        await persona.store.wipe()
        results.push({
          label: `wiped ${name}`,
          detail: 'store + key deleted via SQLCipherProtocolStore.wipe()',
          ok: true,
        })
      } catch (openErr) {
        const forceDetail = await forceWipePersona(name)
        results.push({
          label: `force-wiped ${name}`,
          detail: `open() threw (${String(openErr)}); fell back to op-sqlite delete${
            forceDetail ? `; ${forceDetail}` : ''
          }`,
          ok: forceDetail === null,
        })
      }
    }
    setSteps(results)
    setRunKind(null)
    setStatus(results.every((r) => r.ok) ? 'idle' : 'fail')
  }

  useEffect(() => {
    run()
  }, [])

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Groups: SenderKey end-to-end</Text>
      <Text style={[styles.status, statusStyle(status)]}>
        Status: {status}
        {runKind ? ` (run=${runKind})` : ''}
      </Text>
      <Button title="Re-run" onPress={run} />
      <Button title="Wipe all stores" onPress={wipe} />
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
