import { useEffect, useState } from 'react'
import type { Envelope, Received, SignalClient } from '../client/SignalClient'
import type { ChatStore, Conversation, Message } from './ChatStore'
import type { Transport } from './Transport'

export interface ChatSessionContext {
  client: SignalClient
  store: ChatStore
  transport: Transport
}

export interface UseChatSessionResult {
  conversation: Conversation | null
  messages: Message[]
  sealed: boolean
  setSealed: (value: boolean) => Promise<void>
  send: (text: string) => Promise<void>
  refresh: () => Promise<void>
}

/**
 * Wires a SignalClient, ChatStore, and Transport for ONE persona's view of
 * ONE conversation. The transport subscription is owned by the persona-level
 * controller, not by this hook (the hook only reads from the store; incoming
 * messages get appended to the store by the controller and the hook re-reads).
 */
export function useChatSession(
  ctx: ChatSessionContext,
  self: { name: string; deviceId: number },
  conversationId: string | null,
): UseChatSessionResult {
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])

  async function refresh(): Promise<void> {
    if (conversationId === null) {
      setConversation(null)
      setMessages([])
      return
    }
    const conv = await ctx.store.getConversation(conversationId)
    setConversation(conv)
    if (conv === null) {
      setMessages([])
      return
    }
    setMessages(await ctx.store.listMessages(conversationId))
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  async function send(text: string): Promise<void> {
    if (conversation === null || conversationId === null) return
    const sealed = conversation.sealedDefault
    const sentAt = Date.now()
    if (conversation.kind === 'direct') {
      const peer = conversation.participants[0]
      if (peer === undefined) throw new Error('useChatSession: direct conversation has no peer')
      const env = await ctx.client.send(peer, text, { sealed })
      await ctx.store.appendMessage(conversationId, {
        direction: 'outgoing',
        from: self,
        text,
        sentAt,
        status: 'sent',
        sealed,
      })
      await ctx.transport.send(peer, env)
    } else {
      if (conversation.distributionId === null) {
        throw new Error('useChatSession: group conversation missing distributionId')
      }
      const group = ctx.client.group(conversation.distributionId)
      // Re-ship the SKDM to every peer on every group send. Idempotent on the
      // receiver side (libsignal stores by sender + distId); the SKDM has to be
      // re-sent in case a peer hasn't seen it yet. Not an optimization the demo
      // needs to skip.
      const peers = conversation.participants.filter(
        (p) => !(p.name === self.name && p.deviceId === self.deviceId),
      )
      const welcomes = await group.welcome(peers)
      for (const w of welcomes) await ctx.transport.send(w.to, w.envelope)
      const env = await group.send(text)
      await ctx.store.appendMessage(conversationId, {
        direction: 'outgoing',
        from: self,
        text,
        sentAt,
        status: 'sent',
        sealed: false,
      })
      for (const peer of peers) await ctx.transport.send(peer, env)
    }
    await refresh()
  }

  async function setSealed(value: boolean): Promise<void> {
    if (conversationId === null) return
    await ctx.store.setSealedDefault(conversationId, value)
    await refresh()
  }

  return {
    conversation,
    messages,
    sealed: conversation?.sealedDefault ?? false,
    setSealed,
    send,
    refresh,
  }
}

/**
 * Persona-level receive plumbing: subscribe the transport once and route
 * incoming envelopes into the store. Returns an unsubscribe function. Use this
 * from the screen-level controller, not from `useChatSession`.
 */
export async function attachReceiver(
  ctx: ChatSessionContext,
  self: { name: string; deviceId: number },
): Promise<() => void> {
  return ctx.transport.subscribe(self, (env: Envelope) => {
    void (async () => {
      try {
        const r: Received = await ctx.client.receive(env)
        const conversations = await ctx.store.listConversations()
        const target = pickConversationForReceived(conversations, r)
        if (target === null) return
        if (r.kind === 'message') {
          await ctx.store.appendMessage(target.id, {
            direction: 'incoming',
            from: r.from,
            text: r.plaintext,
            sentAt: Date.now(),
            sealed: r.sealed,
          })
        } else if (r.kind === 'group-message') {
          await ctx.store.appendMessage(target.id, {
            direction: 'incoming',
            from: r.from,
            text: r.plaintext,
            sentAt: Date.now(),
            sealed: false,
          })
        }
        // group-welcome: no-op for chat UI; the conversation already exists.
      } catch (e) {
        console.warn('[chat] receive error', e)
      }
    })()
  })
}

function pickConversationForReceived(
  conversations: Conversation[],
  r: Received,
): Conversation | null {
  if (r.kind === 'group-message' || r.kind === 'group-welcome') {
    return (
      conversations.find(
        (c) => c.kind === 'group' && c.distributionId === r.distributionId,
      ) ?? null
    )
  }
  // direct: in our PERSONA_UUIDS scheme, `r.from.name` is the sender's UUID
  // and direct conversations are pre-created with the peer's address as the
  // only participant. Match on that.
  return (
    conversations.find(
      (c) =>
        c.kind === 'direct' &&
        c.participants.some(
          (p) => p.name === r.from.name && p.deviceId === r.from.deviceId,
        ),
    ) ?? null
  )
}
