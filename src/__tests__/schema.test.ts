import { SchemaTooNewError } from '../errors'
import { MIGRATIONS, runMigrations, SCHEMA_VERSION } from '../stores/schema'
import type { SqlDatabase, SqlParam } from '../stores/sqlTypes'

function makeFakeDb(version: number | null) {
  const executed: string[] = []
  const db: SqlDatabase = {
    async execAsync(source: string): Promise<void> {
      executed.push(source)
    },
    async runAsync(source: string, _params?: SqlParam[]) {
      executed.push(source)
      return { changes: 1, lastInsertRowId: 0 }
    },
    async getFirstAsync<T>(source: string, _params?: SqlParam[]): Promise<T | null> {
      executed.push(source)
      if (source.startsWith('SELECT value FROM schema_meta')) {
        if (version === null) return null
        return { value: String(version) } as unknown as T
      }
      return null
    },
    async getAllAsync<T>(source: string, _params?: SqlParam[]): Promise<T[]> {
      executed.push(source)
      return []
    },
    async withTransactionAsync(task: () => Promise<void>): Promise<void> {
      await task()
    },
    async closeAsync(): Promise<void> {},
  }
  return { db, executed }
}

describe('schema', () => {
  test('one migration batch per schema version, all statements non-empty', () => {
    expect(MIGRATIONS).toHaveLength(SCHEMA_VERSION)
    for (const batch of MIGRATIONS) {
      expect(batch.length).toBeGreaterThan(0)
      for (const stmt of batch) {
        expect(typeof stmt).toBe('string')
        expect(stmt.trim().length).toBeGreaterThan(0)
      }
    }
  })

  test('v1 creates all five store tables', () => {
    const all = (MIGRATIONS[0] ?? []).join('\n')
    for (const table of [
      'local_identity',
      'trusted_identities',
      'sessions',
      'prekeys',
      'signed_prekeys',
      'kyber_prekeys',
    ]) {
      expect(all).toContain(`CREATE TABLE ${table}`)
    }
  })

  test('v2 creates the sender_keys table with a composite PK', () => {
    expect(SCHEMA_VERSION).toBe(2)
    const v2 = (MIGRATIONS[1] ?? []).join('\n')
    expect(v2).toContain('CREATE TABLE sender_keys')
    expect(v2).toContain('PRIMARY KEY (name, device_id, distribution_id)')
  })

  test('runMigrations runs every batch on a fresh database and stamps the version', async () => {
    const { db, executed } = makeFakeDb(null)
    await runMigrations(db)
    for (const stmt of MIGRATIONS.flat()) {
      expect(executed).toContain(stmt)
    }
    expect(executed.some((q) => q.includes('INSERT INTO schema_meta'))).toBe(true)
  })

  test('runMigrations is a no-op at the current version', async () => {
    const { db, executed } = makeFakeDb(SCHEMA_VERSION)
    await runMigrations(db)
    for (const stmt of MIGRATIONS.flat()) {
      expect(executed).not.toContain(stmt)
    }
  })

  test('runMigrations throws SchemaTooNewError on a newer database', async () => {
    const { db } = makeFakeDb(SCHEMA_VERSION + 1)
    await expect(runMigrations(db)).rejects.toBeInstanceOf(SchemaTooNewError)
  })
})
