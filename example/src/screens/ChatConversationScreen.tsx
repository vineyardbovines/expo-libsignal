import { useEffect, useRef, useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import type { ChatSessionContext } from '../chat/useChatSession'
import { useChatSession } from '../chat/useChatSession'

export interface ChatConversationScreenProps {
  ctx: ChatSessionContext
  self: { name: string; deviceId: number }
  conversationId: string
  onBack: () => void
}

export default function ChatConversationScreen(props: ChatConversationScreenProps) {
  const { ctx, self, conversationId, onBack } = props
  const session = useChatSession(ctx, self, conversationId)
  const [composer, setComposer] = useState('')
  const [tick, setTick] = useState(0)
  const scrollRef = useRef<ScrollView | null>(null)

  // Re-poll every 500ms while mounted so incoming messages (delivered to the
  // store by the persona-level receiver) surface in the UI. A pubsub on the
  // store would be cleaner; the poll is fine for the demo and matches what a
  // real app would replace with an event-driven refresh.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 500)
    return () => clearInterval(id)
  }, [])
  useEffect(() => {
    void session.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true })
  }, [session.messages.length])

  async function onSend(): Promise<void> {
    const text = composer.trim()
    if (text.length === 0) return
    setComposer('')
    await session.send(text)
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack}>
          <Text style={styles.back}>← Chats</Text>
        </Pressable>
        <Text style={styles.title}>{session.conversation?.title ?? '...'}</Text>
        {session.conversation?.kind === 'direct' ? (
          <View style={styles.sealedRow}>
            <Text style={styles.sealedLabel}>sealed</Text>
            <Switch
              value={session.sealed}
              onValueChange={(v) => {
                void session.setSealed(v)
              }}
            />
          </View>
        ) : null}
      </View>
      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
      >
        {session.messages.map((m) => {
          const incoming = m.direction === 'incoming'
          return (
            <View
              key={m.id}
              style={[
                styles.bubbleRow,
                incoming ? styles.bubbleLeft : styles.bubbleRight,
              ]}
            >
              <View
                style={[
                  styles.bubble,
                  incoming ? styles.bubbleIncoming : styles.bubbleOutgoing,
                ]}
              >
                {session.conversation?.kind === 'group' && incoming ? (
                  <Text style={[styles.bubbleSender, styles.bubbleSenderIncoming]}>
                    {m.from.name}
                  </Text>
                ) : null}
                <Text
                  style={[styles.bubbleText, incoming && styles.bubbleTextIncoming]}
                >
                  {m.text}
                </Text>
                <Text
                  style={[styles.bubbleTime, incoming && styles.bubbleTimeIncoming]}
                >
                  {new Date(m.sentAt).toLocaleTimeString()}
                </Text>
              </View>
            </View>
          )
        })}
      </ScrollView>
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={composer}
          onChangeText={setComposer}
          placeholder="type a message..."
          onSubmitEditing={() => {
            void onSend()
          }}
        />
        <Pressable
          style={styles.sendButton}
          onPress={() => {
            void onSend()
          }}
        >
          <Text style={styles.sendButtonText}>Send</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#ddd',
    gap: 8,
  },
  back: { fontSize: 13, color: '#048' },
  title: { fontSize: 15, fontWeight: '600', flex: 1 },
  sealedRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sealedLabel: { fontSize: 12, color: '#666' },
  messages: { flex: 1, backgroundColor: '#fafafa' },
  messagesContent: { padding: 12, gap: 8 },
  bubbleRow: { flexDirection: 'row' },
  bubbleLeft: { justifyContent: 'flex-start' },
  bubbleRight: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '80%',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleOutgoing: { backgroundColor: '#048', borderBottomRightRadius: 2 },
  bubbleIncoming: { backgroundColor: '#e5e5ea', borderBottomLeftRadius: 2 },
  bubbleSender: { fontSize: 11, fontWeight: '600', color: '#ddd', marginBottom: 2 },
  bubbleSenderIncoming: { color: '#666' },
  bubbleText: { fontSize: 14, color: '#fff' },
  bubbleTextIncoming: { color: '#111' },
  bubbleTime: { fontSize: 10, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  bubbleTimeIncoming: { color: '#666' },
  composer: {
    flexDirection: 'row',
    padding: 8,
    borderTopWidth: 1,
    borderColor: '#ddd',
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  sendButton: {
    backgroundColor: '#048',
    borderRadius: 18,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  sendButtonText: { color: '#fff', fontWeight: '600' },
})
