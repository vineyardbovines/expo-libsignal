import { SchemaTooNewError } from '../errors'
import type { SqlDatabase } from './opSqliteTypes'

export const SCHEMA_VERSION = 2

// MIGRATIONS[n] takes the schema from version n to n + 1. Forward-only: a
// library downgrade against a newer database throws SchemaTooNewError.
// During 0.x a release may replace migrations outright; release notes say so.
// Every record BLOB is the libsignal serialized form, so a future native
// fast path can read these tables directly (design spec Section 10).
export const MIGRATIONS: string[][] = [
  // v0 -> v1
  [
    `CREATE TABLE local_identity (
      id              INTEGER PRIMARY KEY CHECK (id = 1),
      key_pair        BLOB    NOT NULL,
      registration_id INTEGER NOT NULL
    )`,
    `CREATE TABLE trusted_identities (
      name          TEXT    NOT NULL,
      device_id     INTEGER NOT NULL,
      identity_key  BLOB    NOT NULL,
      first_seen_at INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      PRIMARY KEY (name, device_id)
    )`,
    `CREATE TABLE sessions (
      name       TEXT    NOT NULL,
      device_id  INTEGER NOT NULL,
      record     BLOB    NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (name, device_id)
    )`,
    `CREATE TABLE prekeys (
      id     INTEGER PRIMARY KEY,
      record BLOB NOT NULL
    )`,
    `CREATE TABLE signed_prekeys (
      id         INTEGER PRIMARY KEY,
      record     BLOB    NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE kyber_prekeys (
      id         INTEGER PRIMARY KEY,
      record     BLOB    NOT NULL,
      created_at INTEGER NOT NULL,
      used_at    INTEGER
    )`,
    `CREATE INDEX sessions_updated_idx ON sessions(updated_at)`,
    `CREATE INDEX signed_prekeys_created_idx ON signed_prekeys(created_at)`,
  ],
  // v1 -> v2
  [
    `CREATE TABLE sender_keys (
      name            TEXT    NOT NULL,
      device_id       INTEGER NOT NULL,
      distribution_id TEXT    NOT NULL,
      record          BLOB    NOT NULL,
      updated_at      INTEGER NOT NULL,
      PRIMARY KEY (name, device_id, distribution_id)
    )`,
    `CREATE INDEX sender_keys_updated_idx ON sender_keys(updated_at)`,
  ],
]

export async function runMigrations(db: SqlDatabase): Promise<void> {
  await db.execute(
    'CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  )
  const res = await db.execute("SELECT value FROM schema_meta WHERE key = 'version'")
  const versionRow = res.rows[0]
  const current = versionRow === undefined ? 0 : Number(versionRow.value)
  if (current > SCHEMA_VERSION) {
    throw new SchemaTooNewError(
      `database schema is version ${current}, but this expo-libsignal supports up to ${SCHEMA_VERSION}; upgrade the library`,
    )
  }
  for (let v = current; v < SCHEMA_VERSION; v++) {
    const batch = MIGRATIONS[v] ?? []
    await db.transaction(async (tx) => {
      for (const stmt of batch) {
        await tx.execute(stmt)
      }
      await tx.execute(
        "INSERT INTO schema_meta (key, value) VALUES ('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [String(v + 1)],
      )
    })
  }
}
