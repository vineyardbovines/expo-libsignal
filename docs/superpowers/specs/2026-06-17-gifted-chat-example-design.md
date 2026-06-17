# Gifted-Chat Example Design

## Context

The library shipped its cryptographic surface and an opinionated `SignalClient`
facade demonstrated by `example/src/screens/SignalClientScreen.tsx`. That
screen exercises 1:1, sealed sender, and groups end to end with a split-view
debug UI. It validates correctness but does not look or feel like an app
someone would actually ship. The next step is a chat example that mimics a
real app shell, with a conversation list, drill-in chat view, persisted
message history, and a transport seam, so we can surface real integration
friction with the facade and decide what (if any) of the example layer is
worth lifting into the library.

## Goal

Ship a `Chat` tab in the existing example app that uses
`react-native-gifted-chat` for the conversation UI, a persona switcher for
testing both ends, persisted messages in SQLCipher, and a `Transport`
interface with an in-memory implementation. Cover 1:1 (with a per-conversation
sealed toggle), groups, and persistence across app restart.

## §1 Location and structure

The chat code lives under `example/src/chat/` and `example/src/screens/Chat*`.
A new `Chat` tab in `example/App.tsx` opens `ChatHomeScreen`. Drill-in
navigation is hand-rolled inside the Chat tab using a small `screen` state
(`'home' | { kind: 'conversation', id }`) rather than introducing React
Navigation for one tab.

Library code is not touched.

### Files

New files:

- `example/src/chat/ChatStore.ts`
- `example/src/chat/Transport.ts`
- `example/src/chat/InMemoryTransport.ts`
- `example/src/chat/useChatSession.ts`
- `example/src/screens/ChatHomeScreen.tsx`
- `example/src/screens/ChatConversationScreen.tsx`
- `example/src/chat/__tests__/ChatStore.test.ts`
- `example/src/chat/__tests__/InMemoryTransport.test.ts`

Modified files:

- `example/App.tsx` — add the `Chat` tab
- `example/SMOKE_TEST_LOG.md` — dated entry per platform after smoke
- `example/package.json` — add `react-native-gifted-chat`

## §2 Data flow

### Mount

For each of the three personas (alice, bob, carol):

1. Open `SignalClient` over `${persona}.chat-libsignal.db` for identity, sessions, sender keys.
2. Open `ChatStore` over `${persona}.chat.db` for conversations and messages.
3. Initialize identity if needed.
4. Mint the sealed-sender cert chain at the screen level (one trust root, one server, three sender certs). Reuse the pattern from `SignalClientScreen`.
5. Establish 1:1 sessions between every ordered pair (six `startSession` calls).
6. Pre-create three conversations per persona: two direct conversations (with each other persona) and one group conversation. Group `distributionId` is a fixed UUID known to all three.
7. Subscribe the persona's transport channel: `transport.subscribe(self, callback)`.

Group sender-key distribution happens at first group-send (lazy), not on mount.

### Send

Given an active persona, conversation, and text:

1. `useChatSession.send(text)` is called by the conversation screen.
2. The hook reads the conversation's `sealedDefault` and the conversation kind.
3. Direct conversation: `SignalClient.send(remote, text, { sealed })`. Group conversation: ensure SKDM has been distributed (`group(distId).welcome([peers])` if first send), then `group(distId).send(text)`.
4. The hook calls `chatStore.appendMessage(conversationId, outgoingRow)` with `status: 'sent'`.
5. For direct: `transport.send(remote, envelope)`. For group: `transport.send(peer, envelope)` for each peer (fan-out).

### Receive

1. The transport callback fires with an `Envelope`.
2. The persona's `SignalClient.receive(envelope)` returns `Received`.
3. The hook dispatches by `received.kind`:
   - `message`: find the direct conversation by `received.from`, append an `incoming` row.
   - `group-message`: find the group conversation by `distributionId`, append an `incoming` row with the sender label.
   - `group-welcome`: idempotent. Log a system message in the group conversation.
4. If a `ChatConversationScreen` is currently mounted for that conversation, the hook re-renders and gifted-chat updates.

### Sealed sender

Per-conversation flag stored as `conversations.sealed_default` (boolean). The conversation screen header has a toggle that calls `chatStore.setSealedDefault(id, sealed)`. The send path reads the current value at send time. Direct conversations honor the toggle; group conversations ignore it (group encryption does not use sealed sender envelopes in this demo).

### Persistence

- Identity, sessions, prekeys, sender keys: `SQLCipherProtocolStore` over `${persona}.chat-libsignal.db`.
- Conversations and messages: `ChatStore` over `${persona}.chat.db`.

Both use `expo-secure-store` for their SQLCipher key, with distinct aliases.

On app restart, the persona switcher mounts and re-opens both stores. The conversation list paints from the persisted `conversations` table. The conversation screen loads recent messages with `listMessages(conversationId)`.

## §3 Component shapes

### `ChatStore`

```ts
class ChatStore {
  static async open(opts: {
    databaseName: string
    keyAlias: string
  }): Promise<ChatStore>

  async listConversations(): Promise<Conversation[]>
  async getConversation(id: string): Promise<Conversation | null>
  async createConversation(opts: {
    id: string
    kind: 'direct' | 'group'
    title: string
    participants: Address[]
    distributionId?: string
    sealedDefault?: boolean
  }): Promise<Conversation>
  async setSealedDefault(id: string, sealed: boolean): Promise<void>

  async appendMessage(conversationId: string, msg: NewMessage): Promise<Message>
  async listMessages(conversationId: string, limit?: number): Promise<Message[]>

  async close(): Promise<void>
}

type Conversation = {
  id: string
  kind: 'direct' | 'group'
  title: string
  participants: Address[]
  distributionId: string | null
  sealedDefault: boolean
  lastMessagePreview: string | null
  lastMessageAt: number | null
  unreadCount: number
}

type NewMessage = {
  direction: 'outgoing' | 'incoming'
  from: Address
  text: string
  sentAt: number
  status?: 'sent' | 'delivered' | 'failed'
  sealed?: boolean
}

type Message = NewMessage & {
  id: string
  conversationId: string
}
```

Schema (two tables, foreign-keyed):

```sql
CREATE TABLE conversations (
  id              TEXT    PRIMARY KEY,
  kind            TEXT    NOT NULL CHECK (kind IN ('direct', 'group')),
  title           TEXT    NOT NULL,
  participants    TEXT    NOT NULL,  -- JSON array of {name, deviceId}
  distribution_id TEXT,
  sealed_default  INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER,
  unread_count    INTEGER NOT NULL DEFAULT 0
)

CREATE TABLE messages (
  id              TEXT    PRIMARY KEY,
  conversation_id TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction       TEXT    NOT NULL CHECK (direction IN ('outgoing', 'incoming')),
  from_name       TEXT    NOT NULL,
  from_device_id  INTEGER NOT NULL,
  text            TEXT    NOT NULL,
  sent_at         INTEGER NOT NULL,
  status          TEXT,
  sealed          INTEGER NOT NULL DEFAULT 0
)

CREATE INDEX messages_conversation_idx ON messages(conversation_id, sent_at)
```

Forward-only schema migration, same pattern as `SQLCipherProtocolStore`.

### `Transport`

```ts
interface Transport {
  send(to: Address, envelope: Envelope): Promise<void>
  subscribe(self: Address, onEnvelope: (envelope: Envelope) => void): () => void
}
```

### `InMemoryTransport`

Singleton shared by all personas in the example. Subscriptions keyed by `${name}.${deviceId}`. `send` looks up the subscriber and dispatches inside `queueMicrotask` so the sender's local `appendMessage` lands first. Throws if no subscriber is registered for `to`.

### `useChatSession(personaName, conversationId)`

React hook that wires `SignalClient` + `ChatStore` + `Transport` for one persona and one conversation. Returns:

- `messages: Message[]` paginated from `ChatStore.listMessages`, refreshed when new rows arrive
- `send(text: string): Promise<void>` orchestrates the data flow from §2
- `sealedToggle: { value: boolean; set: (v: boolean) => void }`
- `participants: Address[]`

The hook owns the `transport.subscribe` lifecycle (subscribes on mount, unsubscribes on unmount).

## §4 UI shape

### Chat tab top bar

A dropdown or segmented control picks the active persona (alice / bob / carol). A "Run smoke" button next to the switcher runs the scripted scenario described below.

### `ChatHomeScreen`

Conversation list for the active persona. Each row shows:

- Avatar dot
- Title (`bob`, `carol`, or `Group · alice, bob, carol`)
- Last message preview, or empty state
- Relative timestamp
- Unread badge if non-zero

Tap a row to drill into `ChatConversationScreen`.

### `ChatConversationScreen`

Header: back button, conversation title, sealed-sender toggle (for direct conversations only).

Body: `react-native-gifted-chat` `<GiftedChat>` component, fed from `messages` and `send` from the hook. Group conversations show the sender's name above incoming bubbles; direct conversations rely on bubble alignment.

System messages (errors, group welcome notices) render as centered grey rows via gifted-chat's `renderSystemMessage`.

### Smoke verification

The "Run smoke" button runs a scripted scenario for the active persona's perspective:

1. alice sends "hi bob" to bob's direct conversation
2. bob receives, replies "hi alice"
3. alice receives
4. alice creates the group by sending "hello group" (first send triggers SKDM distribution)
5. bob and carol receive welcomes and the group message
6. alice toggles sealed sender on the alice-bob conversation, sends "hi sealed", bob receives

The button emits `[CHAT-SUMMARY]` JSON for log grep, matching the pattern from `[SIGNALCLIENT-SUMMARY]`.

## §5 Errors, testing, lift candidates, out of scope

### Errors

All `LibsignalError` subclasses surface as system messages in the conversation. Transport errors get the same treatment. No new error types.

### Testing

Unit tests in `example/src/chat/__tests__/`:

- `ChatStore.test.ts`: conversation create + list, message append + list, sealed default round-trip, schema migration runs cleanly on a fresh database.
- `InMemoryTransport.test.ts`: subscribe + dispatch + unsubscribe lifecycle, multiple subscribers, send to unsubscribed throws, queueMicrotask ordering.

Integration: the smoke button on `ChatHomeScreen`, verified on iOS Simulator and Android emulator with `[CHAT-SUMMARY]` JSON. Dated entries in `example/SMOKE_TEST_LOG.md`.

### Library lift candidates

Revisit after the demo ships:

- `Transport` interface. Stable shape that real apps converge on. Probably worth lifting.
- Optional outbox pattern (queue unsent envelopes when transport is down). Lift if it falls out of the demo naturally.

Not expected to lift:

- `ChatStore` itself. Messages and conversations are app domain.
- The gifted-chat integration.
- Group conversation membership tracking.

### Out of scope

- Read receipts, typing indicators, delivery state beyond `sent` / `failed`.
- Group membership add and remove (group is fixed at three personas).
- Attachments and media messages.
- Push notifications and background message handling.
- Device linking (Option 2 from prior planning).
