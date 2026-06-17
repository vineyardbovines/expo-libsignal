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
}
