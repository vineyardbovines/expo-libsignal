import type { SqlDatabase, SqlParam, SqlRunResult } from '../../../../src/stores/sqlTypes'
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

import { ChatStore } from '../ChatStore'

// In-memory fake SQL surface so ChatStore can be exercised without
// expo-sqlite. `virtual: true` keeps this working under root-only
// `bun install --frozen-lockfile` (CI): example/node_modules/ is empty,
// so jest-resolve cannot find the real expo-sqlite to back the mock.
jest.mock('expo-sqlite', () => {
  type Row = Record<string, unknown>
  const conversations: Row[] = []
  const messages: Row[] = []
  let schemaVersion = 0

  function execAsync(_sql: string) {
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
      const row = conversations.find((c) => c.id === id) as unknown as T | undefined
      return Promise.resolve(row ?? null)
    }
    return Promise.resolve(null)
  }
  function getAllAsync<T>(sql: string, params: unknown[] = []) {
    if (sql.startsWith('SELECT * FROM conversations')) {
      return Promise.resolve(conversations.slice() as unknown as T[])
    }
    if (sql.startsWith('SELECT * FROM messages WHERE')) {
      const conversationId = params[0] as string
      const rows = messages.filter((m) => m.conversation_id === conversationId)
      return Promise.resolve(
        rows
          .slice()
          .sort((a, b) => (a.sent_at as number) - (b.sent_at as number)) as unknown as T[],
      )
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
      conversations.push({
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
      const row = conversations.find((c) => c.id === id)
      if (row) row.sealed_default = sealed
    } else if (sql.startsWith('UPDATE conversations SET last_message_at')) {
      const [lastMessageAt, id] = params as [number, string]
      const row = conversations.find((c) => c.id === id)
      if (row) row.last_message_at = lastMessageAt
    } else if (sql.startsWith('INSERT INTO messages')) {
      const [id, conversationId, direction, fromName, fromDeviceId, text, sentAt, status, sealed] =
        params as [string, string, string, string, number, string, number, string | null, number]
      messages.push({
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
      conversations.length = 0
      messages.length = 0
      schemaVersion = 0
    },
  }
}, { virtual: true })

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => 'cafef00d'.repeat(8)),
  setItemAsync: jest.fn(async () => {}),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
}), { virtual: true })

jest.mock('../../../../src/ExpoLibsignalModule', () => ({
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
