import { SchemaTooNewError } from '../errors'
import type { SqlDatabase, SqlQueryResult, SqlScalar } from '../stores/opSqliteTypes'
import { MIGRATIONS, runMigrations, SCHEMA_VERSION } from '../stores/schema'

function makeFakeDb(version: number | null) {
  const executed: string[] = []
  const db: SqlDatabase = {
    async execute(query: string, _params?: SqlScalar[]): Promise<SqlQueryResult> {
      executed.push(query)
      if (query.startsWith('SELECT value FROM schema_meta')) {
        return { rows: version === null ? [] : [{ value: String(version) }] }
      }
      return { rows: [] }
    },
    async transaction(fn) {
      await fn({ execute: (q, p) => db.execute(q, p) })
    },
    close() {},
    delete() {},
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
