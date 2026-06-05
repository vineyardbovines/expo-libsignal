import { useEffect, useState } from 'react'
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native'
import { IdentityKeyPair } from 'expo-libsignal'

const hex = (bytes: Uint8Array) =>
  Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')

export default function IdentityScreen() {
  const [status, setStatus] = useState<string>('idle')
  const [keyPairHex, setKeyPairHex] = useState<string>('')
  const [publicKeyHex, setPublicKeyHex] = useState<string>('')
  const [publicKeyBytes, setPublicKeyBytes] = useState<number>(0)
  const [serializedBytes, setSerializedBytes] = useState<number>(0)

  async function runSmokeTest() {
    setStatus('generating...')
    setKeyPairHex('')
    setPublicKeyHex('')
    try {
      const kp = await IdentityKeyPair.generate()
      const serialized = kp.serialize()
      const pub = kp.publicKey().serialize()
      setKeyPairHex(hex(serialized))
      setPublicKeyHex(hex(pub))
      setSerializedBytes(serialized.length)
      setPublicKeyBytes(pub.length)

      const restored = await IdentityKeyPair.deserialize(serialized)
      const restoredPub = restored.publicKey().serialize()
      if (hex(restoredPub) !== hex(pub)) {
        setStatus('FAIL: round-trip mismatch')
        return
      }
      setStatus('ok (round-trip verified)')
    } catch (e) {
      setStatus(`error: ${String(e)}`)
    }
  }

  useEffect(() => {
    runSmokeTest()
  }, [])

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>expo-libsignal smoke test</Text>
      <Text style={styles.status}>Status: {status}</Text>
      <Button title="Re-run" onPress={runSmokeTest} />

      <View style={styles.row}>
        <Text style={styles.label}>Serialized key pair:</Text>
        <Text style={styles.meta}>{serializedBytes || '?'} bytes</Text>
      </View>
      <Text style={styles.hex}>{keyPairHex || '(none)'}</Text>

      <View style={styles.row}>
        <Text style={styles.label}>Public identity key:</Text>
        <Text style={styles.meta}>{publicKeyBytes || '?'} bytes</Text>
      </View>
      <Text style={styles.hex}>{publicKeyHex || '(none)'}</Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 18, fontWeight: '600' },
  status: { fontSize: 14, fontFamily: 'Courier' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 },
  label: { fontSize: 12, fontWeight: '600' },
  meta: { fontSize: 12, fontFamily: 'Courier', color: '#666' },
  hex: { fontSize: 10, fontFamily: 'Courier' },
})
