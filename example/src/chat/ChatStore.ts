import type { SqlDatabase, SqlModule } from '../../../src/stores/sqlTypes'
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
  const { NativeModule } = require('../../../src/ExpoLibsignalModule') as {
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

  private rowToMessage(row: Record<string, unknown>): Message {
    const status = row.status as 'sent' | 'delivered' | 'failed' | null | undefined
    const base: Message = {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      direction: row.direction as 'outgoing' | 'incoming',
      from: { name: row.from_name as string, deviceId: Number(row.from_device_id) },
      text: row.text as string,
      sentAt: Number(row.sent_at),
      sealed: Number(row.sealed) === 1,
    }
    if (status !== null && status !== undefined) base.status = status
    return base
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
}
