# Gifted-Chat Example Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `Chat` tab in the existing example app that mimics a real chat-app shell using `react-native-gifted-chat`, persona switcher + drill-in navigation, persisted messages, and a `Transport` interface with an in-memory implementation.

**Architecture:** New chat code lives under `example/src/chat/`. A `ChatStore` over its own SQLCipher database holds conversations and messages. A `Transport` interface decouples envelope shipping; an `InMemoryTransport` singleton brokers between three personas. A `useChatSession` hook composes `SignalClient` + `ChatStore` + `Transport` for one persona-conversation pair. Two new screens (`ChatHomeScreen`, `ChatConversationScreen`) render the shell.

**Tech Stack:** TypeScript + Jest, existing `expo-libsignal` + `SQLCipherProtocolStore`, expo-sqlite, `react-native-gifted-chat`, React Native.

**Spec:** `docs/superpowers/specs/2026-06-17-gifted-chat-example-design.md`.

---

## File Structure

New files:
- `example/src/chat/ChatStore.ts`
- `example/src/chat/chatSchema.ts`
- `example/src/chat/Transport.ts`
- `example/src/chat/InMemoryTransport.ts`
- `example/src/chat/useChatSession.ts`
- `example/src/screens/ChatHomeScreen.tsx`
- `example/src/screens/ChatConversationScreen.tsx`
- `example/src/chat/__tests__/ChatStore.test.ts`
- `example/src/chat/__tests__/InMemoryTransport.test.ts`

Modified files:
- `example/package.json` — add `react-native-gifted-chat`
- `example/App.tsx` — add `Chat` tab
- `example/SMOKE_TEST_LOG.md` — dated smoke entries
- `jest.config.js` (root) — already covers `example/src/**/__tests__/`, no change expected

The plan does not modify `src/` (the library).

---

## Task 1: Install react-native-gifted-chat and repair workspace link

**Why first:** The screens import from it, so the dep must resolve before any other task can typecheck.

**Files:**
- Modify: `example/package.json`
- Modify: `example/bun.lock`

- [ ] **Step 1: Install via expo**

Run from the repo root, NOT from `example/`:

```bash
cd /Users/spence/dev/expo-libsignal/example && npx expo install react-native-gifted-chat
```

Expected: installs `react-native-gifted-chat` at the latest version expo recommends for SDK 56.

- [ ] **Step 2: Repair the workspace symlink**

`expo install` runs bun install internally and clobbers the workspace link to `expo-libsignal` (memory note `example-workspace-install.md` covers this exact failure mode).

```bash
cd /Users/spence/dev/expo-libsignal/example/node_modules
mv expo-libsignal expo-libsignal.bak.task1
ln -sfn ../.. expo-libsignal
ls expo-libsignal/package.json  # should print a real path, not error
```

- [ ] **Step 3: Verify lockfile + workspace + dep**

Run from the repo root:

```bash
bun run test 2>&1 | tail -5
```

Expected: 67 tests pass. The existing tests should still resolve `expo-libsignal` cleanly via the symlink.

```bash
ls /Users/spence/dev/expo-libsignal/example/node_modules/react-native-gifted-chat/package.json
```

Expected: file exists.

- [ ] **Step 4: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add example/package.json example/bun.lock
git commit -m "chore(example): add react-native-gifted-chat"
```

---

## Task 2: Schema + ChatStore skeleton

**Why next:** ChatStore is consumed by every other component. Build it first, with tests.

**Files:**
- Create: `example/src/chat/chatSchema.ts`
- Create: `example/src/chat/ChatStore.ts`
- Create: `example/src/chat/__tests__/ChatStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `example/src/chat/__tests__/ChatStore.test.ts`:

```ts
import type { SqlDatabase, SqlParam, SqlRunResult } from 'expo-libsignal/src/stores/sqlTypes'
import { CHAT_MIGRATIONS, CHAT_SCHEMA_VERSION, runChatMigrations } from '../chatSchema'

function makeFakeDb() {
  const executed: string[] = []
  let version: number | null = null
  const db: SqlDatabase = {
    async execAsync(sql: string) {
      executed.push(sql)
    },
    async runAsync(sql: string, _params?: SqlParam[]): Promise<SqlRunResult> {
      executed.push(sql)
      if (sql.startsWith('INSERT INTO schema_meta')) {
        // The migration writes the new version through runAsync.
        // For the fake, capture the most recent version write.
        version = (version ?? 0) + 1
      }
      return { changes: 1, lastInsertRowId: 0 }
    },
    async getFirstAsync<T>(sql: string, _params?: SqlParam[]): Promise<T | null> {
      executed.push(sql)
      if (sql.startsWith('SELECT value FROM schema_meta')) {
        return version === null ? null : ({ value: String(version) } as unknown as T)
      }
      return null
    },
    async getAllAsync<T>(sql: string, _params?: SqlParam[]): Promise<T[]> {
      executed.push(sql)
      return []
    },
    async withTransactionAsync(task: () => Promise<void>) {
      await task()
    },
    async closeAsync() {},
  }
  return { db, executed, getVersion: () => version }
}

describe('chatSchema', () => {
  test('CHAT_MIGRATIONS has one batch per schema version', () => {
    expect(CHAT_MIGRATIONS).toHaveLength(CHAT_SCHEMA_VERSION)
    for (const batch of CHAT_MIGRATIONS) {
      expect(batch.length).toBeGreaterThan(0)
    }
  })

  test('v1 creates the conversations and messages tables', () => {
    const v1 = (CHAT_MIGRATIONS[0] ?? []).join('\n')
    expect(v1).toContain('CREATE TABLE conversations')
    expect(v1).toContain('CREATE TABLE messages')
    expect(v1).toContain('FOREIGN KEY')
  })

  test('runChatMigrations runs every batch on a fresh database', async () => {
    const { db, executed } = makeFakeDb()
    await runChatMigrations(db)
    for (const stmt of CHAT_MIGRATIONS.flat()) {
      expect(executed).toContain(stmt)
    }
  })

  test('runChatMigrations is a no-op at the current version', async () => {
    const { db, executed } = makeFakeDb()
    await runChatMigrations(db)
    executed.length = 0
    await runChatMigrations(db)
    for (const stmt of CHAT_MIGRATIONS.flat()) {
      expect(executed).not.toContain(stmt)
    }
  })
})
```

Run: `bun run test example/src/chat/__tests__/ChatStore.test.ts`
Expected: FAIL — `chatSchema` does not exist.

- [ ] **Step 2: Create `example/src/chat/chatSchema.ts`**

```ts
import type { SqlDatabase } from 'expo-libsignal/src/stores/sqlTypes'

export const CHAT_SCHEMA_VERSION = 1

export const CHAT_MIGRATIONS: string[][] = [
  // v0 -> v1
  [
    `CREATE TABLE conversations (
      id              TEXT    PRIMARY KEY,
      kind            TEXT    NOT NULL CHECK (kind IN ('direct', 'group')),
      title           TEXT    NOT NULL,
      participants    TEXT    NOT NULL,
      distribution_id TEXT,
      sealed_default  INTEGER NOT NULL DEFAULT 0,
      last_message_at INTEGER,
      unread_count    INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE messages (
      id              TEXT    PRIMARY KEY,
      conversation_id TEXT    NOT NULL,
      direction       TEXT    NOT NULL CHECK (direction IN ('outgoing', 'incoming')),
      from_name       TEXT    NOT NULL,
      from_device_id  INTEGER NOT NULL,
      text            TEXT    NOT NULL,
      sent_at         INTEGER NOT NULL,
      status          TEXT,
      sealed          INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX messages_conversation_idx ON messages(conversation_id, sent_at)`,
  ],
]

export async function runChatMigrations(db: SqlDatabase): Promise<void> {
  await db.execAsync(
    'CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  )
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM schema_meta WHERE key = 'version'",
  )
  const current = row === null ? 0 : Number(row.value)
  for (let v = current; v < CHAT_SCHEMA_VERSION; v++) {
    const batch = CHAT_MIGRATIONS[v] ?? []
    await db.withTransactionAsync(async () => {
      for (const stmt of batch) {
        await db.execAsync(stmt)
      }
      await db.runAsync(
        "INSERT INTO schema_meta (key, value) VALUES ('version', ?) " +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [String(v + 1)],
      )
    })
  }
}
```

- [ ] **Step 3: Run the test**

Run: `bun run test example/src/chat/__tests__/ChatStore.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Create `example/src/chat/ChatStore.ts` with open/close**

```ts
import type { SqlDatabase, SqlModule } from 'expo-libsignal/src/stores/sqlTypes'
import { runChatMigrations } from './chatSchema'

declare const require: (id: string) => unknown

type Address = { name: string; deviceId: number }

export type Conversation = {
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

export type NewMessage = {
  direction: 'outgoing' | 'incoming'
  from: Address
  text: string
  sentAt: number
  status?: 'sent' | 'delivered' | 'failed'
  sealed?: boolean
}

export type Message = NewMessage & {
  id: string
  conversationId: string
}

export interface ChatStoreOptions {
  databaseName: string
  keyAlias: string
  keyProvider?: () => Promise<string>
}

function requireExpoSqlite(): SqlModule {
  return require('expo-sqlite') as SqlModule
}

function requireSecureStore(): {
  getItemAsync(key: string, options?: Record<string, unknown>): Promise<string | null>
  setItemAsync(key: string, value: string, options?: Record<string, unknown>): Promise<void>
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: number
} {
  return require('expo-secure-store') as never
}

async function resolveKey(opts: ChatStoreOptions): Promise<string> {
  if (opts.keyProvider) return opts.keyProvider()
  const SecureStore = requireSecureStore()
  const existing = await SecureStore.getItemAsync(opts.keyAlias, {
    keychainService: opts.keyAlias,
  })
  if (existing !== null) return existing
  // Reuse the same CSPRNG path the library uses for its store keys.
  // ChatStore stays platform-agnostic by going through expo-libsignal's
  // generateRandomBytes -> hex helper.
  const { NativeModule } = require('expo-libsignal/src/ExpoLibsignalModule') as {
    NativeModule: { generateRandomBytes: (n: number) => Promise<Uint8Array> }
  }
  const bytes = await NativeModule.generateRandomBytes(32)
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  await SecureStore.setItemAsync(opts.keyAlias, hex, {
    keychainService: opts.keyAlias,
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: false,
  })
  return hex
}

export class ChatStore {
  private readonly db: SqlDatabase

  private constructor(db: SqlDatabase) {
    this.db = db
  }

  static async open(opts: ChatStoreOptions): Promise<ChatStore> {
    const SQLite = requireExpoSqlite()
    const key = await resolveKey(opts)
    const db = await SQLite.openDatabaseAsync(opts.databaseName)
    await db.execAsync(`PRAGMA key = '${key.replace(/'/g, "''")}'`)
    await db.execAsync('PRAGMA journal_mode = WAL')
    await runChatMigrations(db)
    return new ChatStore(db)
  }

  async close(): Promise<void> {
    await this.db.closeAsync()
  }
}
```

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add example/src/chat/chatSchema.ts example/src/chat/ChatStore.ts example/src/chat/__tests__/ChatStore.test.ts
git commit -m "feat(example): ChatStore skeleton + chat schema migrations"
```

---

## Task 3: ChatStore conversation methods

**Files:**
- Modify: `example/src/chat/ChatStore.ts`
- Modify: `example/src/chat/__tests__/ChatStore.test.ts`

- [ ] **Step 1: Append the failing tests**

Append to `example/src/chat/__tests__/ChatStore.test.ts`:

```ts
import { ChatStore } from '../ChatStore'

// In-memory fake SQL surface so ChatStore can be exercised without
// expo-sqlite. We mock the requireExpoSqlite/requireSecureStore paths.
jest.mock('expo-sqlite', () => {
  type Row = Record<string, unknown>
  const tables: Record<string, Row[]> = { conversations: [], messages: [] }
  let schemaVersion = 0

  function execAsync(sql: string) {
    return Promise.resolve()
  }
  function getFirstAsync<T>(sql: string, params: unknown[] = []) {
    if (sql.startsWith('SELECT value FROM schema_meta')) {
      return Promise.resolve(
        schemaVersion === 0 ? null : ({ value: String(schemaVersion) } as unknown as T),
      )
    }
    if (sql.startsWith('SELECT * FROM conversations WHERE id')) {
      const id = params[0] as string
      const row = tables.conversations.find((c) => c.id === id) as unknown as T | undefined
      return Promise.resolve(row ?? null)
    }
    return Promise.resolve(null)
  }
  function getAllAsync<T>(sql: string) {
    if (sql.startsWith('SELECT * FROM conversations')) {
      return Promise.resolve(tables.conversations.slice() as unknown as T[])
    }
    if (sql.startsWith('SELECT * FROM messages WHERE')) {
      return Promise.resolve(tables.messages.slice() as unknown as T[])
    }
    return Promise.resolve([] as T[])
  }
  function runAsync(sql: string, params: unknown[] = []) {
    if (sql.startsWith('INSERT INTO schema_meta')) {
      schemaVersion = Number(params[0])
    } else if (sql.startsWith('INSERT INTO conversations')) {
      const [id, kind, title, participants, distId, sealed] = params as [
        string,
        string,
        string,
        string,
        string | null,
        number,
      ]
      tables.conversations.push({
        id,
        kind,
        title,
        participants,
        distribution_id: distId,
        sealed_default: sealed,
        last_message_at: null,
        unread_count: 0,
      })
    } else if (sql.startsWith('UPDATE conversations SET sealed_default')) {
      const [sealed, id] = params as [number, string]
      const row = tables.conversations.find((c) => c.id === id)
      if (row) row.sealed_default = sealed
    }
    return Promise.resolve({ changes: 1, lastInsertRowId: 0 })
  }
  function withTransactionAsync(task: () => Promise<void>) {
    return task()
  }
  function closeAsync() {
    return Promise.resolve()
  }

  const db = { execAsync, getFirstAsync, getAllAsync, runAsync, withTransactionAsync, closeAsync }

  return {
    openDatabaseAsync: jest.fn(async () => db),
    deleteDatabaseAsync: jest.fn(async () => {}),
    __reset: () => {
      tables.conversations.length = 0
      tables.messages.length = 0
      schemaVersion = 0
    },
  }
})

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => 'cafef00d'.repeat(8)),
  setItemAsync: jest.fn(async () => {}),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
}))

jest.mock('expo-libsignal/src/ExpoLibsignalModule', () => ({
  NativeModule: {
    generateRandomBytes: jest.fn(async () => new Uint8Array(32)),
  },
}))

describe('ChatStore — conversations', () => {
  beforeEach(() => {
    const sqlite = jest.requireMock('expo-sqlite') as { __reset: () => void }
    sqlite.__reset()
    jest.clearAllMocks()
  })

  test('createConversation persists and returns the row', async () => {
    const store = await ChatStore.open({
      databaseName: 'a.chat.db',
      keyAlias: 'a.chat.key',
    })
    const conv = await store.createConversation({
      id: 'conv-1',
      kind: 'direct',
      title: 'bob',
      participants: [{ name: 'bob', deviceId: 1 }],
    })
    expect(conv.id).toBe('conv-1')
    expect(conv.title).toBe('bob')
    expect(conv.sealedDefault).toBe(false)
    const fetched = await store.getConversation('conv-1')
    expect(fetched?.id).toBe('conv-1')
  })

  test('listConversations returns all rows', async () => {
    const store = await ChatStore.open({
      databaseName: 'a.chat.db',
      keyAlias: 'a.chat.key',
    })
    await store.createConversation({
      id: 'c1', kind: 'direct', title: 'bob', participants: [{ name: 'bob', deviceId: 1 }],
    })
    await store.createConversation({
      id: 'c2', kind: 'direct', title: 'carol', participants: [{ name: 'carol', deviceId: 1 }],
    })
    const list = await store.listConversations()
    expect(list).toHaveLength(2)
    expect(list.map((c) => c.id).sort()).toEqual(['c1', 'c2'])
  })

  test('setSealedDefault round-trips', async () => {
    const store = await ChatStore.open({
      databaseName: 'a.chat.db',
      keyAlias: 'a.chat.key',
    })
    await store.createConversation({
      id: 'c1', kind: 'direct', title: 'bob', participants: [{ name: 'bob', deviceId: 1 }],
    })
    await store.setSealedDefault('c1', true)
    const fetched = await store.getConversation('c1')
    expect(fetched?.sealedDefault).toBe(true)
  })
})
```

Run: `bun run test example/src/chat/__tests__/ChatStore.test.ts`
Expected: FAIL — methods do not exist.

- [ ] **Step 2: Add methods to `example/src/chat/ChatStore.ts`**

Add inside the `ChatStore` class:

```ts
  private rowToConversation(row: Record<string, unknown>): Conversation {
    return {
      id: row.id as string,
      kind: row.kind as 'direct' | 'group',
      title: row.title as string,
      participants: JSON.parse(row.participants as string) as Address[],
      distributionId: (row.distribution_id as string | null) ?? null,
      sealedDefault: Number(row.sealed_default) === 1,
      lastMessagePreview: null,
      lastMessageAt: (row.last_message_at as number | null) ?? null,
      unreadCount: Number(row.unread_count ?? 0),
    }
  }

  async listConversations(): Promise<Conversation[]> {
    const rows = await this.db.getAllAsync<Record<string, unknown>>(
      'SELECT * FROM conversations ORDER BY COALESCE(last_message_at, 0) DESC',
    )
    return rows.map((r) => this.rowToConversation(r))
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const row = await this.db.getFirstAsync<Record<string, unknown>>(
      'SELECT * FROM conversations WHERE id = ?',
      [id],
    )
    return row === null ? null : this.rowToConversation(row)
  }

  async createConversation(opts: {
    id: string
    kind: 'direct' | 'group'
    title: string
    participants: Address[]
    distributionId?: string
    sealedDefault?: boolean
  }): Promise<Conversation> {
    await this.db.runAsync(
      'INSERT INTO conversations (id, kind, title, participants, distribution_id, sealed_default) ' +
        'VALUES (?, ?, ?, ?, ?, ?)',
      [
        opts.id,
        opts.kind,
        opts.title,
        JSON.stringify(opts.participants),
        opts.distributionId ?? null,
        opts.sealedDefault === true ? 1 : 0,
      ],
    )
    const fetched = await this.getConversation(opts.id)
    if (fetched === null) throw new Error('createConversation: insert succeeded but read failed')
    return fetched
  }

  async setSealedDefault(id: string, sealed: boolean): Promise<void> {
    await this.db.runAsync(
      'UPDATE conversations SET sealed_default = ? WHERE id = ?',
      [sealed ? 1 : 0, id],
    )
  }
```

- [ ] **Step 3: Run the tests**

Run: `bun run test example/src/chat/__tests__/ChatStore.test.ts`
Expected: PASS (7 tests total).

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add example/src/chat/ChatStore.ts example/src/chat/__tests__/ChatStore.test.ts
git commit -m "feat(example): ChatStore conversation methods"
```

---

## Task 4: ChatStore message methods

**Files:**
- Modify: `example/src/chat/ChatStore.ts`
- Modify: `example/src/chat/__tests__/ChatStore.test.ts`

- [ ] **Step 1: Extend the fake to handle messages**

In the `jest.mock('expo-sqlite', ...)` block, add to `runAsync`:

```ts
    } else if (sql.startsWith('INSERT INTO messages')) {
      const [id, conversationId, direction, fromName, fromDeviceId, text, sentAt, status, sealed] =
        params as [string, string, string, string, number, string, number, string | null, number]
      tables.messages.push({
        id,
        conversation_id: conversationId,
        direction,
        from_name: fromName,
        from_device_id: fromDeviceId,
        text,
        sent_at: sentAt,
        status,
        sealed,
      })
```

And in `getAllAsync`, replace the `SELECT * FROM messages WHERE` branch with:

```ts
    if (sql.startsWith('SELECT * FROM messages WHERE')) {
      const conversationId = (arguments[1] as unknown[])?.[0] as string
      const rows = tables.messages.filter((m) => m.conversation_id === conversationId)
      return Promise.resolve(
        rows
          .slice()
          .sort((a, b) => (a.sent_at as number) - (b.sent_at as number)) as unknown as T[],
      )
    }
```

(Note: `arguments[1]` is brittle but fine for a test fake; the test only uses one call shape.)

- [ ] **Step 2: Append the failing tests**

```ts
describe('ChatStore — messages', () => {
  beforeEach(() => {
    const sqlite = jest.requireMock('expo-sqlite') as { __reset: () => void }
    sqlite.__reset()
    jest.clearAllMocks()
  })

  test('appendMessage returns a row with a stable id and persists', async () => {
    const store = await ChatStore.open({
      databaseName: 'a.chat.db',
      keyAlias: 'a.chat.key',
    })
    await store.createConversation({
      id: 'c1', kind: 'direct', title: 'bob', participants: [{ name: 'bob', deviceId: 1 }],
    })
    const msg = await store.appendMessage('c1', {
      direction: 'outgoing',
      from: { name: 'alice', deviceId: 1 },
      text: 'hi bob',
      sentAt: 1_700_000_000_000,
      status: 'sent',
      sealed: false,
    })
    expect(msg.id).toBeDefined()
    expect(msg.text).toBe('hi bob')
    const all = await store.listMessages('c1')
    expect(all).toHaveLength(1)
    expect(all[0]?.text).toBe('hi bob')
  })

  test('listMessages returns messages in send-time order', async () => {
    const store = await ChatStore.open({
      databaseName: 'a.chat.db',
      keyAlias: 'a.chat.key',
    })
    await store.createConversation({
      id: 'c1', kind: 'direct', title: 'bob', participants: [{ name: 'bob', deviceId: 1 }],
    })
    await store.appendMessage('c1', {
      direction: 'outgoing', from: { name: 'alice', deviceId: 1 }, text: 'first', sentAt: 100,
    })
    await store.appendMessage('c1', {
      direction: 'incoming', from: { name: 'bob', deviceId: 1 }, text: 'second', sentAt: 200,
    })
    const rows = await store.listMessages('c1')
    expect(rows.map((m) => m.text)).toEqual(['first', 'second'])
  })
})
```

Run: `bun run test example/src/chat/__tests__/ChatStore.test.ts`
Expected: FAIL — `appendMessage` / `listMessages` not implemented.

- [ ] **Step 3: Add methods to ChatStore**

Add inside the class:

```ts
  private rowToMessage(row: Record<string, unknown>): Message {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      direction: row.direction as 'outgoing' | 'incoming',
      from: { name: row.from_name as string, deviceId: Number(row.from_device_id) },
      text: row.text as string,
      sentAt: Number(row.sent_at),
      status: (row.status as 'sent' | 'delivered' | 'failed' | undefined) ?? undefined,
      sealed: Number(row.sealed) === 1,
    }
  }

  async appendMessage(conversationId: string, msg: NewMessage): Promise<Message> {
    // ULID-ish id derived from sentAt + random suffix; replace if a real ULID
    // dependency lands later. Sortable by id mirrors sortable by sentAt.
    const id =
      msg.sentAt.toString(36).padStart(10, '0') +
      Math.floor(Math.random() * 0xffffffff)
        .toString(36)
        .padStart(6, '0')
    await this.db.runAsync(
      'INSERT INTO messages (id, conversation_id, direction, from_name, from_device_id, ' +
        'text, sent_at, status, sealed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        conversationId,
        msg.direction,
        msg.from.name,
        msg.from.deviceId,
        msg.text,
        msg.sentAt,
        msg.status ?? null,
        msg.sealed === true ? 1 : 0,
      ],
    )
    await this.db.runAsync(
      'UPDATE conversations SET last_message_at = ? WHERE id = ?',
      [msg.sentAt, conversationId],
    )
    return { ...msg, id, conversationId, sealed: msg.sealed === true }
  }

  async listMessages(conversationId: string, limit = 200): Promise<Message[]> {
    const rows = await this.db.getAllAsync<Record<string, unknown>>(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY sent_at ASC LIMIT ?',
      [conversationId, limit],
    )
    return rows.map((r) => this.rowToMessage(r))
  }
```

- [ ] **Step 4: Run the tests**

Run: `bun run test example/src/chat/__tests__/ChatStore.test.ts`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add example/src/chat/ChatStore.ts example/src/chat/__tests__/ChatStore.test.ts
git commit -m "feat(example): ChatStore message append + list"
```

---

## Task 5: Transport interface + InMemoryTransport

**Files:**
- Create: `example/src/chat/Transport.ts`
- Create: `example/src/chat/InMemoryTransport.ts`
- Create: `example/src/chat/__tests__/InMemoryTransport.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `example/src/chat/__tests__/InMemoryTransport.test.ts`:

```ts
import { InMemoryTransport } from '../InMemoryTransport'

function envelope(text: string) {
  // The Transport interface doesn't care about envelope shape; any object works
  // for these tests. Use a sentinel so we can compare identity.
  return { type: 'signal', from: { name: 'alice', deviceId: 1 }, bytes: new Uint8Array([0x1]), tag: text } as never
}

describe('InMemoryTransport', () => {
  test('subscribe + send delivers to the subscribed callback', async () => {
    const transport = new InMemoryTransport()
    const received: unknown[] = []
    transport.subscribe({ name: 'bob', deviceId: 1 }, (env) => received.push(env))
    await transport.send({ name: 'bob', deviceId: 1 }, envelope('a'))
    // queueMicrotask delivery; let it drain.
    await new Promise<void>((r) => queueMicrotask(r))
    expect(received).toHaveLength(1)
  })

  test('unsubscribe stops delivery', async () => {
    const transport = new InMemoryTransport()
    const received: unknown[] = []
    const unsub = transport.subscribe({ name: 'bob', deviceId: 1 }, (env) => received.push(env))
    unsub()
    await expect(
      transport.send({ name: 'bob', deviceId: 1 }, envelope('a')),
    ).rejects.toThrow(/no subscriber/)
    expect(received).toHaveLength(0)
  })

  test('send to unsubscribed address throws', async () => {
    const transport = new InMemoryTransport()
    await expect(
      transport.send({ name: 'nobody', deviceId: 1 }, envelope('a')),
    ).rejects.toThrow(/no subscriber/)
  })

  test('multiple subscribers on different addresses do not interfere', async () => {
    const transport = new InMemoryTransport()
    const bobReceived: unknown[] = []
    const carolReceived: unknown[] = []
    transport.subscribe({ name: 'bob', deviceId: 1 }, (env) => bobReceived.push(env))
    transport.subscribe({ name: 'carol', deviceId: 1 }, (env) => carolReceived.push(env))
    await transport.send({ name: 'bob', deviceId: 1 }, envelope('a'))
    await new Promise<void>((r) => queueMicrotask(r))
    expect(bobReceived).toHaveLength(1)
    expect(carolReceived).toHaveLength(0)
  })

  test('subscribing twice on the same address overwrites the previous handler', async () => {
    const transport = new InMemoryTransport()
    const first: unknown[] = []
    const second: unknown[] = []
    transport.subscribe({ name: 'bob', deviceId: 1 }, (env) => first.push(env))
    transport.subscribe({ name: 'bob', deviceId: 1 }, (env) => second.push(env))
    await transport.send({ name: 'bob', deviceId: 1 }, envelope('a'))
    await new Promise<void>((r) => queueMicrotask(r))
    expect(first).toHaveLength(0)
    expect(second).toHaveLength(1)
  })
})
```

Run: `bun run test example/src/chat/__tests__/InMemoryTransport.test.ts`
Expected: FAIL — `InMemoryTransport` does not exist.

- [ ] **Step 2: Create `example/src/chat/Transport.ts`**

```ts
import type { Envelope } from 'expo-libsignal/src/core/SealedSender'

export type Address = { name: string; deviceId: number }

export interface Transport {
  /** Ship an envelope addressed to `to`. Throws if no subscriber is registered. */
  send(to: Address, envelope: Envelope): Promise<void>
  /** Register a callback for envelopes addressed to `self`. Returns an unsubscribe fn. */
  subscribe(self: Address, onEnvelope: (envelope: Envelope) => void): () => void
}
```

Note: the `Envelope` import path matches the type alias exported from
`src/core/SealedSender.ts` via the package barrel. If your editor flags it, the
correct public import is from `'expo-libsignal'` (top-level export) once the
chat code is moved off the `expo-libsignal/src/...` deep imports. The example
already uses deep imports for `SqlDatabase` in Task 2 / 3.

- [ ] **Step 3: Create `example/src/chat/InMemoryTransport.ts`**

```ts
import type { Envelope } from 'expo-libsignal/src/core/SealedSender'
import type { Address, Transport } from './Transport'

function key(a: Address): string {
  return `${a.name}.${a.deviceId}`
}

/**
 * Singleton transport for the example app. The chat demo shares one instance
 * across alice/bob/carol so a `send` from one persona ends up in another's
 * `receive`. A real app would implement the Transport interface against its
 * own websocket / REST / push pipeline.
 */
export class InMemoryTransport implements Transport {
  private readonly subs = new Map<string, (envelope: Envelope) => void>()

  subscribe(self: Address, onEnvelope: (envelope: Envelope) => void): () => void {
    const k = key(self)
    this.subs.set(k, onEnvelope)
    return () => {
      if (this.subs.get(k) === onEnvelope) this.subs.delete(k)
    }
  }

  async send(to: Address, envelope: Envelope): Promise<void> {
    const cb = this.subs.get(key(to))
    if (cb === undefined) throw new Error(`InMemoryTransport: no subscriber for ${key(to)}`)
    queueMicrotask(() => cb(envelope))
  }
}

/** Shared instance used by the example screens. */
export const inMemoryTransport = new InMemoryTransport()
```

- [ ] **Step 4: Run the tests**

Run: `bun run test example/src/chat/__tests__/InMemoryTransport.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Full suite + typecheck**

Run: `bun run test && bun run typecheck`
Expected: all suites pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add example/src/chat/Transport.ts example/src/chat/InMemoryTransport.ts example/src/chat/__tests__/InMemoryTransport.test.ts
git commit -m "feat(example): Transport interface + InMemoryTransport"
```

---

## Task 6: useChatSession hook

**Why:** Composes `SignalClient` + `ChatStore` + `InMemoryTransport` for one persona-conversation pair. The screens consume the hook.

**Files:**
- Create: `example/src/chat/useChatSession.ts`

No unit tests for the hook itself — hooks compose three integration points and the smoke run exercises them. Tests for the underlying parts already cover the building blocks.

- [ ] **Step 1: Create `example/src/chat/useChatSession.ts`**

```ts
import type { SignalClient } from '../client/SignalClient'
import type { Envelope, Received } from '../client/SignalClient'
import { useEffect, useState } from 'react'
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

  async function refresh() {
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
      // First send needs to distribute the sender key to every peer. Idempotent
      // because welcome() can be called multiple times; receiver-side processing
      // is idempotent too (libsignal stores by sender + distId).
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
export async function attachReceiver(ctx: ChatSessionContext, self: { name: string; deviceId: number }): Promise<() => void> {
  return ctx.transport.subscribe(self, async (env: Envelope) => {
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
      // Surface as a system message in the most plausible conversation if we
      // have one to route to; otherwise drop. The screen layer will improve
      // this once we see what errors actually surface during smoke.
      console.warn('[chat] receive error', e)
    }
  })
}

function pickConversationForReceived(conversations: Conversation[], r: Received): Conversation | null {
  if (r.kind === 'group-message' || r.kind === 'group-welcome') {
    return conversations.find((c) => c.kind === 'group' && c.distributionId === r.distributionId) ?? null
  }
  // direct
  return conversations.find(
    (c) =>
      c.kind === 'direct' &&
      c.participants.some((p) => p.name === r.from.name && p.deviceId === r.from.deviceId),
  ) ?? null
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add example/src/chat/useChatSession.ts
git commit -m "feat(example): useChatSession hook and receive router"
```

---

## Task 7: ChatHomeScreen and ChatConversationScreen

**Files:**
- Create: `example/src/screens/ChatHomeScreen.tsx`
- Create: `example/src/screens/ChatConversationScreen.tsx`

These screens are paired; build them in one task. The drill-in navigation lives inside `ChatHomeScreen` via local state.

- [ ] **Step 1: Create `example/src/screens/ChatHomeScreen.tsx`**

```tsx
import {
  IdentityKeyPair,
  PublicKey,
  SenderCertificate,
  ServerCertificate,
} from 'expo-libsignal'
import { useEffect, useRef, useState } from 'react'
import { Button, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SignalClient } from '../client/SignalClient'
import { ChatStore, type Conversation } from '../chat/ChatStore'
import { inMemoryTransport } from '../chat/InMemoryTransport'
import { attachReceiver, type ChatSessionContext } from '../chat/useChatSession'
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

  async function mount() {
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

  async function refreshConversations(p: Persona) {
    const ctx = sessions.current[p]
    if (ctx === null) return
    setConversations(await ctx.store.listConversations())
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
  }, [])

  useEffect(() => {
    if (ready) void refreshConversations(persona)
  }, [persona, ready])

  async function runSmoke() {
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
      const aliceGroup = (await alice.store.listConversations()).find((c) => c.kind === 'group')
      if (aliceBob === undefined || bobAlice === undefined || aliceGroup === undefined) {
        throw new Error('expected conversations missing')
      }

      // alice → bob, then refresh and assert
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
        label: '1. alice → bob direct',
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
      const bobGroupId = (await bob.store.listConversations()).find((c) => c.kind === 'group')?.id
      const bobGroupInbox = bobGroupId === undefined ? [] : await bob.store.listMessages(bobGroupId)
      steps.push({
        label: '2. alice → group',
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
      console.log('[CHAT-SUMMARY]', JSON.stringify({ status: 'fail', error: String(e) }))
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
            <Text style={p === persona ? styles.personaTextActive : styles.personaText}>{p}</Text>
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        <Button title="Run smoke" onPress={runSmoke} disabled={!ready} />
      </View>
      <Text style={[styles.status, smokeStatus === 'ok' ? styles.statusOk : smokeStatus === 'fail' ? styles.statusFail : undefined]}>
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
  personaPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: '#eee' },
  personaPillActive: { backgroundColor: '#333' },
  personaText: { fontSize: 12, color: '#333' },
  personaTextActive: { fontSize: 12, color: '#fff', fontWeight: '600' },
  status: { fontSize: 11, color: '#666', paddingHorizontal: 8, paddingVertical: 4 },
  statusOk: { color: '#0a0' },
  statusFail: { color: '#a00' },
  row: { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ddd' },
  title: { fontSize: 15, fontWeight: '600' },
  preview: { fontSize: 12, color: '#666', marginTop: 2 },
})
```

- [ ] **Step 2: Create `example/src/screens/ChatConversationScreen.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import { GiftedChat, type IMessage } from 'react-native-gifted-chat'
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
  const [tick, setTick] = useState(0)

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
  }, [tick])

  const conversation = session.conversation
  const giftedMessages: IMessage[] = session.messages
    .slice()
    .reverse()
    .map((m) => ({
      _id: m.id,
      text: m.text,
      createdAt: new Date(m.sentAt),
      user: {
        _id: `${m.from.name}.${m.from.deviceId}`,
        name: m.from.name,
      },
    }))

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack}>
          <Text style={styles.back}>← Chats</Text>
        </Pressable>
        <Text style={styles.title}>{conversation?.title ?? '...'}</Text>
        {conversation?.kind === 'direct' ? (
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
      <GiftedChat
        messages={giftedMessages}
        onSend={async (newMessages) => {
          for (const m of newMessages) await session.send(m.text)
        }}
        user={{ _id: `${self.name}.${self.deviceId}`, name: self.name }}
      />
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
})
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck` and `cd example && npx tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add example/src/screens/ChatHomeScreen.tsx example/src/screens/ChatConversationScreen.tsx
git commit -m "feat(example): ChatHomeScreen + ChatConversationScreen with gifted-chat"
```

---

## Task 8: Wire the Chat tab into App.tsx

**Files:**
- Modify: `example/App.tsx`

- [ ] **Step 1: Edit `example/App.tsx`**

Replace the existing `Tab` union and tab list:

```ts
import ChatHomeScreen from './src/screens/ChatHomeScreen'

type Tab =
  | 'identity'
  | 'aliceBob'
  | 'persistence'
  | 'groups'
  | 'sealedSender'
  | 'signalClient'
  | 'chat'
```

Add the tab button next to the existing ones:

```tsx
<TabButton current={tab} value="chat" label="Chat" onPress={setTab} />
```

Add the render case in `renderScreen`:

```tsx
    case 'chat':
      return <ChatHomeScreen />
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck && cd example && npx tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 3: Commit (pre-smoke)**

```bash
cd /Users/spence/dev/expo-libsignal
git add example/App.tsx
git commit -m "feat(example): Chat tab"
```

---

## Task 9: Smoke on both platforms + docs

### Step 1: iOS smoke

- Temporarily set the default tab in `App.tsx` to `'chat'`.
- Rebuild: `cd example && npx expo run:ios --port 8082 --device 5105FFD8-CC6E-443C-8791-99D70A8B900D` (CHECK WITH USER FIRST — binds a port).
- Wait for `Build Succeeded` and the app to launch. The Chat tab opens, conversations populate, tap "Run smoke".
- Tail `[CHAT-SUMMARY]` in the simulator log:

```bash
xcrun simctl spawn 5105FFD8-CC6E-443C-8791-99D70A8B900D log show --last 2m --predicate 'composedMessage CONTAINS "CHAT-SUMMARY"' --info | tail -3
```

Expected: `status="ok"` with both steps `ok: true`.

### Step 2: Android smoke

- `cd example && npx expo run:android` (CHECK WITH USER FIRST).
- App launches on the connected emulator. Tap "Run smoke".
- `adb logcat -d | grep CHAT-SUMMARY | tail -1`

Expected: `status="ok"`, both steps green.

### Step 3: Manual interactive smoke

While the app is running on either platform:

1. Drill into the `bob` conversation, type a message, send. Switch to `bob` persona via the picker. Drill into `alice`. The message should appear.
2. Toggle sealed on. Send another. Receiver shows the new message.
3. Drill into the group, send a message from `alice`. Switch to `bob` and `carol`; both should show it.

### Step 4: Revert temp default tab

Edit `App.tsx` to set `useState<Tab>('identity')` again.

### Step 5: Update `example/SMOKE_TEST_LOG.md`

Prepend a dated entry. Format match the SignalClient phase entry.

### Step 6: Final commit

```bash
git add example/App.tsx example/SMOKE_TEST_LOG.md
git commit -m "docs: gifted-chat example verified on both platforms"
```

---

## Self-Review Notes

**Spec coverage.** Task 1 ships the dep. Task 2-4 cover `ChatStore` (schema, conversations, messages). Task 5 covers Transport. Task 6 covers `useChatSession` + `attachReceiver`. Task 7 ships the two screens. Task 8 wires the tab. Task 9 covers smoke + docs.

**Pitfalls to watch for:**

- The `expo-libsignal/src/...` deep imports work via Metro and the live workspace symlink, but they bypass the package's `exports` map. The library's own jest config maps `expo-libsignal` to `src/index.ts`, but it doesn't map subpaths like `expo-libsignal/src/core/SealedSender`. For tests, prefer importing types from `'expo-libsignal'` (the public surface). For runtime code, deep imports are OK because Metro resolves them via node_modules / the symlink.
- The poll loop in `ChatConversationScreen` is a placeholder for a real pubsub. The smoke test doesn't depend on it. Real apps would replace it.
- `gifted-chat` expects messages in reverse-chronological order (newest first). We `.slice().reverse()` before passing.
- The persona-level receiver (`attachReceiver`) does not currently route `group-welcome` to a system row. The smoke test does not depend on that either; leave the comment and ship.
- The smoke step inserts directly into the store as if it were the hook's send path. That bypasses the hook's `send`, which is intentional: we want the smoke to verify the underlying composition independently of the React hook.

**Type consistency check passed.** `Address = { name: string; deviceId: number }` is the boundary type in `ChatStore`, `Transport`, and `useChatSession`. `Envelope` and `Received` come from the SignalClient facade. `Conversation` shape matches between store rows and hook outputs.
