import {
  IdentityKeyPair,
  SenderCertificate,
  ServerCertificate,
} from 'expo-libsignal'
import { useEffect, useRef, useState } from 'react'
import {
  Button,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SignalClient } from '../client/SignalClient'
import type { Address, Envelope, Received } from '../client/SignalClient'

type Persona = 'alice' | 'bob' | 'carol'
type Target = Persona | 'group'

interface ChatRow {
  who: Persona
  text: string
  kind: 'outgoing' | 'incoming' | 'system'
}

interface StepResult {
  label: string
  detail: string
  ok: boolean
}

const PERSONAS: Persona[] = ['alice', 'bob', 'carol']
const PEERS: Record<Persona, Persona[]> = {
  alice: ['bob', 'carol'],
  bob: ['alice', 'carol'],
  carol: ['alice', 'bob'],
}

// Android's SealedSessionCipher calls UUID.fromString() on both senderUuid
// (encrypt) and localUuid (decrypt), so the SignalClient.self.name must be a
// valid v4 UUID for sealed sender to work. We give each persona a fixed UUID
// and keep a uuid -> persona map for chat-history labelling. 1:1 routing in
// the demo uses these UUIDs end-to-end.
const PERSONA_UUIDS: Record<Persona, string> = {
  alice: 'a11ce000-0000-4000-8000-000000000001',
  bob: 'b0b00000-0000-4000-8000-000000000002',
  carol: 'ca201000-0000-4000-8000-000000000003',
}
const UUID_TO_PERSONA: Record<string, Persona> = {
  [PERSONA_UUIDS.alice]: 'alice',
  [PERSONA_UUIDS.bob]: 'bob',
  [PERSONA_UUIDS.carol]: 'carol',
}

const DISTRIBUTION_ID = '00000000-0000-4000-8000-0000000c0de1'

const addressOf = (p: Persona): Address => ({ name: PERSONA_UUIDS[p], deviceId: 1 })
const labelOf = (uuid: string): string => UUID_TO_PERSONA[uuid] ?? uuid

export default function SignalClientScreen() {
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState<'idle' | 'running' | 'ok' | 'fail'>('idle')
  const [rows, setRows] = useState<ChatRow[]>([])
  const [composer, setComposer] = useState<Record<Persona, string>>({
    alice: '',
    bob: '',
    carol: '',
  })
  const [target, setTarget] = useState<Record<Persona, Target>>({
    alice: 'bob',
    bob: 'alice',
    carol: 'alice',
  })
  const [sealed, setSealed] = useState(false)
  const [groupStarted, setGroupStarted] = useState(false)

  const clients = useRef<Record<Persona, SignalClient | null>>({
    alice: null,
    bob: null,
    carol: null,
  })

  function appendRow(row: ChatRow) {
    setRows((prev) => [...prev, row])
  }

  async function ship(env: Envelope, to: Address | 'group'): Promise<void> {
    if (to === 'group') {
      // Group envelope: fan out to every other persona. The envelope `from`
      // carries the sender's UUID; map back to persona for routing.
      const senderUuid = env.type === 'group' ? env.from.name : ''
      const senderPersona = UUID_TO_PERSONA[senderUuid]
      await Promise.all(
        PERSONAS.filter((p) => p !== senderPersona).map((p) =>
          clients.current[p]!
            .receive(env)
            .then((r) => recordReceive(p, r))
            .catch((e) => appendRow({ who: p, text: `error: ${String(e)}`, kind: 'system' })),
        ),
      )
    } else {
      const dest = UUID_TO_PERSONA[to.name]
      if (dest === undefined) {
        appendRow({ who: 'alice', text: `ship: unknown dest ${to.name}`, kind: 'system' })
        return
      }
      await clients.current[dest]!
        .receive(env)
        .then((r) => recordReceive(dest, r))
        .catch((e) => appendRow({ who: dest, text: `error: ${String(e)}`, kind: 'system' }))
    }
  }

  function recordReceive(who: Persona, r: Received) {
    if (r.kind === 'message') {
      appendRow({
        who,
        text: `${labelOf(r.from.name)} → you${r.sealed ? ' (sealed)' : ''}: ${r.plaintext}`,
        kind: 'incoming',
      })
    } else if (r.kind === 'group-message') {
      appendRow({
        who,
        text: `${labelOf(r.from.name)} → group: ${r.plaintext}`,
        kind: 'incoming',
      })
    } else if (r.kind === 'group-welcome') {
      appendRow({ who, text: `joined group from ${labelOf(r.from.name)}`, kind: 'system' })
    }
  }

  async function mount() {
    const steps: StepResult[] = []
    setStatus('running')
    try {
      // 1. Open three clients
      for (const p of PERSONAS) {
        clients.current[p] = await SignalClient.open({
          databaseName: `${p}.client.db`,
          keyAlias: `expo-libsignal-example.${p}.client.dbkey`,
          self: addressOf(p),
        })
        await clients.current[p]!.initializeIfNeeded({
          registrationId: 1000 + PERSONAS.indexOf(p),
        })
      }
      steps.push({ label: '1. Open clients + identities', detail: 'alice + bob + carol', ok: true })

      // 2. Six startSession calls — every ordered pair
      let preKeyId = 100
      for (const sender of PERSONAS) {
        for (const receiver of PEERS[sender]) {
          const bundle = await clients.current[receiver]!.publishOneTimePreKey({
            preKeyId: preKeyId++,
            signedPreKeyId: 200 + preKeyId,
            kyberPreKeyId: 300 + preKeyId,
          })
          await clients.current[sender]!.startSession(addressOf(receiver), bundle)
        }
      }
      steps.push({ label: '2. Six pairwise sessions', detail: 'startSession ×6', ok: true })

      // 3. Mint sealed-sender cert chain. Each persona's sender cert uses the
      // persona's fixed UUID (see PERSONA_UUIDS) so Android's UUID.fromString
      // accepts it.
      const trustRoot = await IdentityKeyPair.generate()
      const serverIdentity = await IdentityKeyPair.generate()
      const serverCert = await ServerCertificate.generate({
        keyId: 1,
        serverKey: serverIdentity.publicKey().toPublicKey(),
        trustRoot,
      })
      for (const p of PERSONAS) {
        const senderIdentity = await clients.current[p]!.identityKey()
        const senderCert = await SenderCertificate.generate({
          senderUuid: PERSONA_UUIDS[p],
          senderDeviceId: 1,
          senderKey: senderIdentity.toPublicKey(),
          expiration: Date.now() + 5 * 60_000,
          serverCert,
          serverKey: serverIdentity.privateKey(),
        })
        clients.current[p]!.configureSealedSender({
          trustRoot: trustRoot.publicKey().toPublicKey(),
          senderCert,
        })
      }
      steps.push({
        label: '3. Sealed sender cert chain',
        detail: 'trust-root + 3 sender certs',
        ok: true,
      })
      setReady(true)

      // Scripted smoke
      // 4. alice -> bob plain
      await ship(await clients.current.alice!.send(addressOf('bob'), 'hi bob'), addressOf('bob'))
      appendRow({ who: 'alice', text: 'you → bob: hi bob', kind: 'outgoing' })

      // 5. alice -> bob sealed
      await ship(
        await clients.current.alice!.send(addressOf('bob'), 'hi bob (sealed)', { sealed: true }),
        addressOf('bob'),
      )
      appendRow({ who: 'alice', text: 'you → bob (sealed): hi bob (sealed)', kind: 'outgoing' })

      // 6. bob -> alice plain
      await ship(
        await clients.current.bob!.send(addressOf('alice'), 'hi alice'),
        addressOf('alice'),
      )
      appendRow({ who: 'bob', text: 'you → alice: hi alice', kind: 'outgoing' })

      // 7. Start group — every persona that will SEND in the group needs to
      // distribute their own sender key. Alice does it first, then bob, then
      // carol. Ship each welcome to its recipient and wait for the receive
      // before moving on so welcomes can't race with later group sends.
      for (const sender of PERSONAS) {
        const peers = PEERS[sender].map(addressOf)
        const welcomes = await clients.current[sender]!.group(DISTRIBUTION_ID).welcome(peers)
        for (const w of welcomes) await ship(w.envelope, w.to)
      }
      setGroupStarted(true)
      appendRow({
        who: 'alice',
        text: 'started group (alice, bob, carol all distributed sender keys)',
        kind: 'system',
      })

      // 8. alice -> group
      await ship(
        await clients.current.alice!.group(DISTRIBUTION_ID).send('hello group'),
        'group',
      )
      appendRow({ who: 'alice', text: 'you → group: hello group', kind: 'outgoing' })

      steps.push({ label: '4. Scripted sends ok', detail: 'plain + sealed + group', ok: true })

      const pass = steps.every((s) => s.ok)
      console.log(
        '[SIGNALCLIENT-SUMMARY]',
        JSON.stringify({
          status: pass ? 'ok' : 'fail',
          steps: steps.map((s) => ({ label: s.label, ok: s.ok, detail: s.detail })),
        }),
      )
      setStatus(pass ? 'ok' : 'fail')
    } catch (e) {
      steps.push({ label: 'error', detail: String(e), ok: false })
      console.log(
        '[SIGNALCLIENT-SUMMARY]',
        JSON.stringify({
          status: 'fail',
          steps: steps.map((s) => ({ label: s.label, ok: s.ok, detail: s.detail })),
        }),
      )
      setStatus('fail')
    }
  }

  async function unmount() {
    for (const p of PERSONAS) await clients.current[p]?.close().catch(() => {})
  }

  useEffect(() => {
    mount()
    return () => {
      unmount()
    }
  }, [])

  async function manualSend(p: Persona) {
    const text = composer[p]
    if (text.length === 0) return
    setComposer((c) => ({ ...c, [p]: '' }))
    const t = target[p]
    try {
      if (t === 'group') {
        if (!groupStarted) return
        const env = await clients.current[p]!.group(DISTRIBUTION_ID).send(text)
        ship(env, 'group')
        appendRow({ who: p, text: `you → group: ${text}`, kind: 'outgoing' })
      } else {
        const env = await clients.current[p]!.send(addressOf(t), text, { sealed })
        ship(env, addressOf(t))
        appendRow({
          who: p,
          text: `you → ${t}${sealed ? ' (sealed)' : ''}: ${text}`,
          kind: 'outgoing',
        })
      }
    } catch (e) {
      appendRow({ who: p, text: `error: ${String(e)}`, kind: 'system' })
    }
  }

  return (
    <View style={styles.root}>
      <Text style={[styles.status, statusStyle(status)]}>
        Status: {status} {ready ? '' : '(initializing)'}
      </Text>
      <View style={styles.toolbar}>
        <Text style={styles.toolbarLabel}>sealed</Text>
        <Switch value={sealed} onValueChange={setSealed} />
      </View>
      {PERSONAS.map((p) => (
        <View key={p} style={styles.panel}>
          <Text style={styles.panelHeader}>{p}</Text>
          <ScrollView style={styles.history} contentContainerStyle={styles.historyContent}>
            {rows
              .filter((r) => r.who === p)
              .map((r, i) => (
                <Text key={i} style={[styles.row, rowStyle(r.kind)]}>
                  {r.kind === 'outgoing' ? '↑ ' : r.kind === 'incoming' ? '↓ ' : '· '}
                  {r.text}
                </Text>
              ))}
          </ScrollView>
          <View style={styles.targetRow}>
            {PEERS[p].map((peer) => (
              <Button
                key={peer}
                title={`-> ${peer}`}
                onPress={() => setTarget((t) => ({ ...t, [p]: peer }))}
              />
            ))}
            <Button
              title="-> group"
              onPress={() => setTarget((t) => ({ ...t, [p]: 'group' }))}
              disabled={!groupStarted}
            />
          </View>
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={composer[p]}
              onChangeText={(t) => setComposer((c) => ({ ...c, [p]: t }))}
              placeholder={`as ${p}, -> ${target[p]}`}
            />
            <Button title="Send" onPress={() => manualSend(p)} disabled={!ready} />
          </View>
        </View>
      ))}
    </View>
  )
}

function statusStyle(s: string) {
  if (s === 'ok') return { color: '#0a0' }
  if (s === 'fail') return { color: '#a00' }
  return { color: '#666' }
}
function rowStyle(kind: ChatRow['kind']) {
  if (kind === 'outgoing') return { color: '#048' }
  if (kind === 'incoming') return { color: '#040' }
  return { color: '#666' }
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff', padding: 8 },
  status: { fontSize: 12, fontFamily: 'Courier', marginBottom: 4 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  toolbarLabel: { fontSize: 12 },
  panel: { flex: 1, borderTopWidth: 1, borderColor: '#ddd', paddingVertical: 4 },
  panelHeader: { fontSize: 13, fontWeight: '600', marginBottom: 2 },
  history: { flex: 1, backgroundColor: '#fafafa' },
  historyContent: { padding: 6 },
  row: { fontSize: 11, fontFamily: 'Courier', paddingVertical: 1 },
  targetRow: { flexDirection: 'row', gap: 4, marginVertical: 2 },
  composer: { flexDirection: 'row', gap: 4 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', padding: 6, fontSize: 12 },
})
