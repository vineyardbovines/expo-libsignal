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
