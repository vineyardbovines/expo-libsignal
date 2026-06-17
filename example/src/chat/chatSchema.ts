import type { SqlDatabase } from '../../../src/stores/sqlTypes'

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
