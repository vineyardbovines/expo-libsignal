import {
  IdentityKeyPair,
  SenderCertificate,
  ServerCertificate,
} from 'expo-libsignal'
import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { ChatStore, type Conversation } from '../chat/ChatStore'
import { inMemoryTransport } from '../chat/InMemoryTransport'
import { attachReceiver, type ChatSessionContext } from '../chat/useChatSession'
import { SignalClient } from '../client/SignalClient'
import ChatConversationScreen from './ChatConversationScreen'

type Persona = 'alice' | 'bob' | 'carol'
type Screen = 'home' | { kind: 'conversation'; id: string }

const PERSONAS: Persona[] = ['alice', 'bob', 'carol']
const PERSONA_UUIDS: Record<Persona, string> = {
  alice: 'a11ce000-0000-4000-8000-000000001111',
  bob: 'b0b00000-0000-4000-8000-000000002222',
  carol: 'ca201000-0000-4000-8000-000000003333',
}
const PEERS: Record<Persona, Persona[]> = {
  alice: ['bob', 'carol'],
  bob: ['alice', 'carol'],
  carol: ['alice', 'bob'],
}
const GROUP_DISTRIBUTION_ID = '00000000-0000-4000-8000-c0de00000001'

const addressOf = (p: Persona) => ({ name: PERSONA_UUIDS[p], deviceId: 1 })
const labelOf = (uuid: string): string =>
  PERSONAS.find((p) => PERSONA_UUIDS[p] === uuid) ?? uuid

type PersonaSession = {
  client: SignalClient
  store: ChatStore
  unsubscribe: () => void
}

export default function ChatHomeScreen() {
  const [persona, setPersona] = useState<Persona>('alice')
  const [screen, setScreen] = useState<Screen>('home')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [ready, setReady] = useState(false)
  const [smokeStatus, setSmokeStatus] = useState<string>('idle')

  const sessions = useRef<Record<Persona, PersonaSession | null>>({
    alice: null,
    bob: null,
    carol: null,
  })

  async function refreshConversations(p: Persona): Promise<void> {
    const ctx = sessions.current[p]
    if (ctx === null) return
    setConversations(await ctx.store.listConversations())
  }

  async function mount(): Promise<void> {
    // Open clients and stores for all three personas. Each persona has its own
    // SQLCipher databases for both libsignal state and chat state.
    for (const p of PERSONAS) {
      const client = await SignalClient.open({
        databaseName: `${p}.chat-libsignal.db`,
        keyAlias: `${p}.chat-libsignal.dbkey`,
        self: addressOf(p),
      })
      await client.initializeIfNeeded({ registrationId: 5000 + PERSONAS.indexOf(p) })
      const store = await ChatStore.open({
        databaseName: `${p}.chat.db`,
        keyAlias: `${p}.chat.dbkey`,
      })
      const ctx: ChatSessionContext = { client, store, transport: inMemoryTransport }
      const unsubscribe = await attachReceiver(ctx, addressOf(p))
      sessions.current[p] = { client, store, unsubscribe }
    }

    // 1:1 sessions between every pair.
    let preKeyId = 5000
    for (const sender of PERSONAS) {
      for (const receiver of PEERS[sender]) {
        const sCtx = sessions.current[sender]
        const rCtx = sessions.current[receiver]
        if (sCtx === null || rCtx === null) continue
        const bundle = await rCtx.client.publishOneTimePreKey({
          preKeyId: preKeyId++,
          signedPreKeyId: 6000 + preKeyId,
          kyberPreKeyId: 7000 + preKeyId,
        })
        await sCtx.client.startSession(addressOf(receiver), bundle)
      }
    }

    // Sealed sender cert chain.
    const trustRoot = await IdentityKeyPair.generate()
    const serverIdentity = await IdentityKeyPair.generate()
    const serverCert = await ServerCertificate.generate({
      keyId: 1,
      serverKey: serverIdentity.publicKey().toPublicKey(),
      trustRoot,
    })
    for (const p of PERSONAS) {
      const ctx = sessions.current[p]
      if (ctx === null) continue
      const identity = await ctx.client.identityKey()
      const senderCert = await SenderCertificate.generate({
        senderUuid: PERSONA_UUIDS[p],
        senderDeviceId: 1,
        senderKey: identity.toPublicKey(),
        expiration: Date.now() + 10 * 60_000,
        serverCert,
        serverKey: serverIdentity.privateKey(),
      })
      ctx.client.configureSealedSender({
        trustRoot: trustRoot.publicKey().toPublicKey(),
        senderCert,
      })
    }

    // Pre-create three conversations per persona (two direct, one group).
    for (const p of PERSONAS) {
      const ctx = sessions.current[p]
      if (ctx === null) continue
      const existing = await ctx.store.listConversations()
      const existingIds = new Set(existing.map((c) => c.id))
      for (const peer of PEERS[p]) {
        const id = `direct-${PERSONA_UUIDS[peer]}`
        if (!existingIds.has(id)) {
          await ctx.store.createConversation({
            id,
            kind: 'direct',
            title: peer,
            participants: [addressOf(peer)],
          })
        }
      }
      const groupId = `group-${GROUP_DISTRIBUTION_ID}`
      if (!existingIds.has(groupId)) {
        await ctx.store.createConversation({
          id: groupId,
          kind: 'group',
          title: 'Group: alice, bob, carol',
          participants: PERSONAS.filter((q) => q !== p).map(addressOf),
          distributionId: GROUP_DISTRIBUTION_ID,
        })
      }
    }
    setReady(true)
    await refreshConversations(persona)
  }

  useEffect(() => {
    void mount()
    return () => {
      for (const p of PERSONAS) {
        const s = sessions.current[p]
        if (s !== null) {
          s.unsubscribe()
          void s.store.close().catch(() => {})
          void s.client.close().catch(() => {})
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (ready) void refreshConversations(persona)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona, ready])

  async function runSmoke(): Promise<void> {
    setSmokeStatus('running')
    const steps: { label: string; ok: boolean; detail: string }[] = []
    try {
      const alice = sessions.current.alice
      const bob = sessions.current.bob
      const carol = sessions.current.carol
      if (alice === null || bob === null || carol === null) throw new Error('not ready')

      const aliceBob = (await alice.store.listConversations()).find(
        (c) => c.kind === 'direct' && c.participants[0]?.name === PERSONA_UUIDS.bob,
      )
      const bobAlice = (await bob.store.listConversations()).find(
        (c) => c.kind === 'direct' && c.participants[0]?.name === PERSONA_UUIDS.alice,
      )
      const aliceGroup = (await alice.store.listConversations()).find(
        (c) => c.kind === 'group',
      )
      if (
        aliceBob === undefined ||
        bobAlice === undefined ||
        aliceGroup === undefined
      ) {
        throw new Error('expected conversations missing')
      }

      // alice -> bob, then refresh and assert
      const env = await alice.client.send(addressOf('bob'), 'hi bob')
      await alice.store.appendMessage(aliceBob.id, {
        direction: 'outgoing',
        from: addressOf('alice'),
        text: 'hi bob',
        sentAt: Date.now(),
        status: 'sent',
        sealed: false,
      })
      await inMemoryTransport.send(addressOf('bob'), env)
      await new Promise<void>((r) => setTimeout(r, 50))
      const bobInbox = await bob.store.listMessages(bobAlice.id)
      steps.push({
        label: '1. alice -> bob direct',
        ok: bobInbox.some((m) => m.text === 'hi bob' && m.direction === 'incoming'),
        detail: `bob inbox length=${bobInbox.length}`,
      })

      // group: alice creates SKDM and group message
      const group = alice.client.group(GROUP_DISTRIBUTION_ID)
      const welcomes = await group.welcome([addressOf('bob'), addressOf('carol')])
      for (const w of welcomes) await inMemoryTransport.send(w.to, w.envelope)
      await new Promise<void>((r) => setTimeout(r, 50))
      const groupEnv = await group.send('hello group')
      await alice.store.appendMessage(aliceGroup.id, {
        direction: 'outgoing',
        from: addressOf('alice'),
        text: 'hello group',
        sentAt: Date.now(),
        status: 'sent',
        sealed: false,
      })
      for (const peer of [addressOf('bob'), addressOf('carol')]) {
        await inMemoryTransport.send(peer, groupEnv)
      }
      await new Promise<void>((r) => setTimeout(r, 50))
      const bobGroupId = (await bob.store.listConversations()).find(
        (c) => c.kind === 'group',
      )?.id
      const bobGroupInbox =
        bobGroupId === undefined ? [] : await bob.store.listMessages(bobGroupId)
      steps.push({
        label: '2. alice -> group',
        ok: bobGroupInbox.some((m) => m.text === 'hello group'),
        detail: `bob group inbox length=${bobGroupInbox.length}`,
      })

      const pass = steps.every((s) => s.ok)
      console.log(
        '[CHAT-SUMMARY]',
        JSON.stringify({
          status: pass ? 'ok' : 'fail',
          steps,
        }),
      )
      setSmokeStatus(pass ? 'ok' : 'fail')
      await refreshConversations(persona)
    } catch (e) {
      console.log(
        '[CHAT-SUMMARY]',
        JSON.stringify({ status: 'fail', error: String(e) }),
      )
      setSmokeStatus('fail')
    }
  }

  if (screen !== 'home' && typeof screen === 'object') {
    const ctx = sessions.current[persona]
    if (ctx === null) return null
    return (
      <ChatConversationScreen
        ctx={{ client: ctx.client, store: ctx.store, transport: inMemoryTransport }}
        self={addressOf(persona)}
        conversationId={screen.id}
        onBack={() => setScreen('home')}
      />
    )
  }

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <Text style={styles.topLabel}>Persona:</Text>
        {PERSONAS.map((p) => (
          <Pressable
            key={p}
            onPress={() => setPersona(p)}
            style={[styles.personaPill, p === persona && styles.personaPillActive]}
          >
            <Text style={p === persona ? styles.personaTextActive : styles.personaText}>
              {p}
            </Text>
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        <Button title="Run smoke" onPress={runSmoke} disabled={!ready} />
      </View>
      <Text
        style={[
          styles.status,
          smokeStatus === 'ok'
            ? styles.statusOk
            : smokeStatus === 'fail'
              ? styles.statusFail
              : undefined,
        ]}
      >
        {ready ? `smoke: ${smokeStatus}` : 'opening stores...'}
      </Text>
      <ScrollView>
        {conversations.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => setScreen({ kind: 'conversation', id: c.id })}
            style={styles.row}
          >
            <Text style={styles.title}>
              {c.kind === 'group' ? c.title : labelOf(c.participants[0]?.name ?? '')}
            </Text>
            <Text style={styles.preview}>
              {c.lastMessagePreview ?? 'no messages yet'}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
    borderBottomWidth: 1,
    borderColor: '#ddd',
  },
  topLabel: { fontSize: 12, color: '#666' },
  personaPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#eee',
  },
  personaPillActive: { backgroundColor: '#333' },
  personaText: { fontSize: 12, color: '#333' },
  personaTextActive: { fontSize: 12, color: '#fff', fontWeight: '600' },
  status: { fontSize: 11, color: '#666', paddingHorizontal: 8, paddingVertical: 4 },
  statusOk: { color: '#0a0' },
  statusFail: { color: '#a00' },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
  },
  title: { fontSize: 15, fontWeight: '600' },
  preview: { fontSize: 12, color: '#666', marginTop: 2 },
})
