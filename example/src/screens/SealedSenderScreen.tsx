import {
  IdentityKeyPair,
  SealedSender,
  SenderCertificate,
  ServerCertificate,
  SessionBuilder,
} from 'expo-libsignal'
import { useEffect, useState } from 'react'
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native'
import { createPersona, publishPreKeyBundle } from '../personas/createPersona'

interface StepResult {
  label: string
  detail: string
  ok: boolean
}

const utf8Encode = (s: string) => new TextEncoder().encode(s)
const utf8Decode = (b: Uint8Array) => new TextDecoder().decode(b)
const shortHex = (b: Uint8Array, n = 8) =>
  Array.from(b.slice(0, n))
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')

// Bob's local UUID is arbitrary in this smoke; sealed sender only verifies the
// sender side of the envelope. Use a fixed v4-shaped string so logs are stable.
const BOB_LOCAL_UUID = 'bob00000-0000-4000-8000-000000000000'

export default function SealedSenderScreen() {
  const [steps, setSteps] = useState<StepResult[]>([])
  const [status, setStatus] = useState<'idle' | 'running' | 'ok' | 'fail'>('idle')

  async function run() {
    setStatus('running')
    const results: StepResult[] = []
    const push = (s: StepResult) => results.push(s)
    try {
      const alice = await createPersona('alice')
      const bob = await createPersona('bob')
      push({ label: '1. Personas', detail: 'alice + bob created', ok: true })

      const preKeyId = 100
      const signedPreKeyId = 200
      const kyberPreKeyId = 300
      const bundle = await publishPreKeyBundle(bob, preKeyId, signedPreKeyId, kyberPreKeyId)
      push({
        label: '2. Bob publishes PreKeyBundle',
        detail: `preKeyId=${preKeyId} signedPreKeyId=${signedPreKeyId} kyberPreKeyId=${kyberPreKeyId}`,
        ok: true,
      })

      const aliceBuilder = new SessionBuilder(
        { sessionStore: alice.stores, identityStore: alice.stores },
        bob.address,
        alice.address,
      )
      await aliceBuilder.processPreKeyBundle(bundle)
      push({
        label: '3. Alice processPreKeyBundle (alice -> bob session)',
        detail: 'session established',
        ok: true,
      })

      const trustRoot = await IdentityKeyPair.generate()
      push({
        label: '4. Mint trust-root identity',
        detail: `trustRootPubBytes=${trustRoot.publicKey().serialize().length}`,
        ok: true,
      })

      const serverIdentity = await IdentityKeyPair.generate()
      const serverCert = await ServerCertificate.generate({
        keyId: 1,
        serverKey: serverIdentity.publicKey().toPublicKey(),
        trustRoot,
      })
      push({
        label: '5. Server cert under trust root',
        detail: `keyId=${serverCert.keyId()} bytes=${serverCert.serialize().length}`,
        ok: true,
      })

      const senderUuid = crypto.randomUUID().toLowerCase()
      const expiration = Date.now() + 60_000
      const senderCert = await SenderCertificate.generate({
        senderUuid,
        senderDeviceId: 1,
        senderKey: alice.identity.publicKey().toPublicKey(),
        expiration,
        serverCert,
        serverKey: serverIdentity.privateKey(),
      })
      push({
        label: '6. Sender cert for alice',
        detail: `senderUuid=${senderCert.senderUuid()} deviceId=${senderCert.senderDeviceId()} expiresIn=${expiration - Date.now()}ms`,
        ok: senderCert.senderUuid() === senderUuid,
      })

      const ciphertext = await SealedSender.encrypt({
        destination: bob.address,
        senderCert,
        message: utf8Encode('hello sealed'),
        sessionStore: alice.stores,
        identityStore: alice.stores,
      })
      push({
        label: '7. Alice sealed-encrypt to bob',
        detail: `bytes=${ciphertext.length} hex=${shortHex(ciphertext)}`,
        ok: ciphertext.length > 0,
      })

      const decrypted = await SealedSender.decryptMessage({
        ciphertext,
        trustRoot: trustRoot.publicKey().toPublicKey(),
        timestamp: Date.now(),
        localUuid: BOB_LOCAL_UUID,
        localDeviceId: bob.address.deviceId(),
        stores: {
          sessionStore: bob.stores,
          identityStore: bob.stores,
          preKeyStore: bob.stores,
          signedPreKeyStore: bob.stores,
          kyberPreKeyStore: bob.stores,
        },
      })
      const plaintext = utf8Decode(decrypted.message)
      const plaintextOk = plaintext === 'hello sealed'
      const senderOk = decrypted.senderUuid === senderUuid
      push({
        label: '8. Bob sealed-decrypt',
        detail: `plaintext="${plaintext}" senderUuid=${decrypted.senderUuid} senderDeviceId=${decrypted.senderDeviceId}`,
        ok: plaintextOk && senderOk,
      })
      push({
        label: '9. Recovered sender matches issued cert',
        detail: `issued=${senderUuid} recovered=${decrypted.senderUuid}`,
        ok: senderOk,
      })

      const pass = results.every((r) => r.ok)
      console.log(
        '[SEALED-SUMMARY]',
        JSON.stringify({
          status: pass ? 'ok' : 'fail',
          steps: results.map((r) => ({ label: r.label, ok: r.ok, detail: r.detail })),
        }),
      )
      setSteps(results)
      setStatus(pass ? 'ok' : 'fail')
    } catch (e) {
      results.push({ label: 'error', detail: String(e), ok: false })
      console.log(
        '[SEALED-SUMMARY]',
        JSON.stringify({
          status: 'fail',
          steps: results.map((r) => ({ label: r.label, ok: r.ok, detail: r.detail })),
        }),
      )
      setSteps(results)
      setStatus('fail')
    }
  }

  useEffect(() => {
    run()
  }, [])

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Sealed Sender: cert chain + envelope</Text>
      <Text style={[styles.status, statusStyle(status)]}>Status: {status}</Text>
      <Button title="Re-run" onPress={run} />
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
