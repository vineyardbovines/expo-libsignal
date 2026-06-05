import { type PreKeySignalMessage, SessionBuilder, SessionCipher, type SignalMessage } from 'expo-libsignal'
import { useEffect, useState } from 'react'
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native'
import { createPersona, type Persona, publishPreKeyBundle } from '../personas/createPersona'

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

export default function AliceBobScreen() {
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
      const bundle = await publishPreKeyBundle(bob, preKeyId, signedPreKeyId)
      push({
        label: '2. Bob publishes PreKeyBundle',
        detail: `preKeyId=${preKeyId} signedPreKeyId=${signedPreKeyId}`,
        ok: true,
      })

      const aliceBuilder = new SessionBuilder(
        { sessionStore: alice.stores, identityStore: alice.stores },
        bob.address,
        alice.address,
      )
      await aliceBuilder.processPreKeyBundle(bundle)
      push({ label: '3. Alice processPreKeyBundle', detail: 'session established', ok: true })

      const aliceCipher = new SessionCipher(
        {
          sessionStore: alice.stores,
          identityStore: alice.stores,
          preKeyStore: alice.stores,
          signedPreKeyStore: alice.stores,
          kyberPreKeyStore: alice.stores,
        },
        bob.address,
        alice.address,
      )
      const msg1 = await aliceCipher.encrypt(utf8Encode('hello bob'))
      const ok1 = msg1.type === 'preKeySignal'
      push({
        label: '4. Alice encrypts "hello bob"',
        detail: `type=${msg1.type} bytes=${msg1.serialize().length} hex=${shortHex(msg1.serialize())}`,
        ok: ok1,
      })
      if (!ok1) throw new Error('expected preKeySignal')

      const bobCipher = new SessionCipher(
        {
          sessionStore: bob.stores,
          identityStore: bob.stores,
          preKeyStore: bob.stores,
          signedPreKeyStore: bob.stores,
          kyberPreKeyStore: bob.stores,
        },
        alice.address,
        bob.address,
      )
      const recovered1 = await bobCipher.decryptPreKeySignal(msg1 as PreKeySignalMessage)
      const recoveredStr1 = utf8Decode(recovered1)
      push({
        label: '5. Bob decryptPreKeySignal',
        detail: `plaintext="${recoveredStr1}"`,
        ok: recoveredStr1 === 'hello bob',
      })
      if (recoveredStr1 !== 'hello bob') throw new Error('round-trip failed')

      const preKeyConsumed = !bob.stores.hasPreKey(preKeyId)
      push({
        label: '6. Bob consumed the one-time prekey',
        detail: `preKeyId=${preKeyId} present=${!preKeyConsumed}`,
        ok: preKeyConsumed,
      })
      const kyberMarked = bob.stores.isKyberPreKeyUsed(signedPreKeyId)
      push({
        label: '7. Bob marked the kyber prekey used',
        detail: `kyberPreKeyId=${signedPreKeyId} used=${kyberMarked}`,
        ok: kyberMarked,
      })

      const msg2 = await bobCipher.encrypt(utf8Encode('hi alice'))
      const ok2 = msg2.type === 'signal'
      push({
        label: '8. Bob encrypts "hi alice"',
        detail: `type=${msg2.type} bytes=${msg2.serialize().length} hex=${shortHex(msg2.serialize())}`,
        ok: ok2,
      })

      const recovered2 = await aliceCipher.decryptSignal(msg2 as SignalMessage)
      const recoveredStr2 = utf8Decode(recovered2)
      push({
        label: '9. Alice decryptSignal',
        detail: `plaintext="${recoveredStr2}"`,
        ok: recoveredStr2 === 'hi alice',
      })

      // Three more round-trips to exercise the ratchet
      for (let i = 0; i < 3; i++) {
        const a = await aliceCipher.encrypt(utf8Encode(`A${i}`))
        const ra = utf8Decode(await bobCipher.decryptSignal(a as SignalMessage))
        const b = await bobCipher.encrypt(utf8Encode(`B${i}`))
        const rb = utf8Decode(await aliceCipher.decryptSignal(b as SignalMessage))
        push({
          label: `10.${i}. Ratchet round-trip`,
          detail: `A->B="${ra}", B->A="${rb}"`,
          ok: ra === `A${i}` && rb === `B${i}`,
        })
      }

      setSteps(results)
      setStatus(results.every((r) => r.ok) ? 'ok' : 'fail')
    } catch (e) {
      results.push({ label: 'error', detail: String(e), ok: false })
      setSteps(results)
      setStatus('fail')
    }
  }

  useEffect(() => {
    run()
  }, [])

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Alice/Bob: X3DH + Double Ratchet</Text>
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
