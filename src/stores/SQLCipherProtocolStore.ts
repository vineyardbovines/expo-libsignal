import { IdentityKey, IdentityKeyPair } from '../core/IdentityKeyPair'
import { KyberPreKeyRecord } from '../core/KyberPreKeyRecord'
import { PreKeyRecord } from '../core/PreKeyRecord'
import type { ProtocolAddress } from '../core/ProtocolAddress'
import { SenderKeyRecord } from '../core/SenderKeyRecord'
import { SessionRecord } from '../core/SessionRecord'
import { SignedPreKeyRecord } from '../core/SignedPreKeyRecord'
import type {
  Direction,
  IdentityChange,
  IdentityKeyStore,
  KyberPreKeyStore,
  PreKeyStore,
  SenderKeyStore,
  SessionStore,
  SignedPreKeyStore,
} from '../core/stores'
import { InvalidKeyError, StoreError } from '../errors'
import { deleteDatabaseKey, resolveDatabaseKey } from './keys'
import { requireExpoSqlite } from './optionalRequire'
import { runMigrations } from './schema'
import type { SqlDatabase, SqlModule } from './sqlTypes'

export interface SQLCipherStoreOptions {
  /** Database file name. Default 'expo-libsignal.db'. */
  databaseName?: string
  /** Secure-store entry (and keychainService) for the database key. Default 'expo-libsignal.dbkey'. */
  keyAlias?: string
  /** Supplies the SQLCipher passphrase directly, bypassing secure-store. */
  keyProvider?: () => Promise<string>
  /** expo-secure-store keychainAccessible constant. Default WHEN_UNLOCKED_THIS_DEVICE_ONLY. */
  keychainAccessible?: number
}

// expo-sqlite returns BLOB columns as Uint8Array; defensively unwrap views/buffers
// from anyone who pre-processed the row.
function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  throw new StoreError(`expected a BLOB column value, got ${typeof value}`)
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// SQLCipher's PRAGMA key takes a string. We use single-quote doubling to be
// SQL-injection safe even though resolveDatabaseKey only returns hex.
function escapeSql(s: string): string {
  return s.replace(/'/g, "''")
}

/**
 * Default SQLCipher-backed implementation of all five store interfaces over
 * one expo-sqlite database. Stores are pluggable: this class is one
 * implementation of the interfaces, not a requirement.
 *
 * Concurrency: wrap each protocol operation (processPreKeyBundle, encrypt,
 * decryptPreKeySignal, decryptSignal) in runExclusive() so its store
 * reads/writes are atomic with respect to other operations on this store.
 * Do not open two stores on the same database file.
 */
export class SQLCipherProtocolStore
  implements
    SessionStore,
    IdentityKeyStore,
    PreKeyStore,
    SignedPreKeyStore,
    KyberPreKeyStore,
    SenderKeyStore
{
  private readonly db: SqlDatabase
  private readonly sqlite: SqlModule
  private readonly databaseName: string
  private readonly keyAlias: string
  private readonly usedKeyProvider: boolean
  private queue: Promise<unknown> = Promise.resolve()

  private constructor(
    db: SqlDatabase,
    sqlite: SqlModule,
    databaseName: string,
    keyAlias: string,
    usedKeyProvider: boolean,
  ) {
    this.db = db
    this.sqlite = sqlite
    this.databaseName = databaseName
    this.keyAlias = keyAlias
    this.usedKeyProvider = usedKeyProvider
  }

  static async open(options: SQLCipherStoreOptions = {}): Promise<SQLCipherProtocolStore> {
    const databaseName = options.databaseName ?? 'expo-libsignal.db'
    const keyAlias = options.keyAlias ?? 'expo-libsignal.dbkey'
    const key = await resolveDatabaseKey({
      keyAlias,
      keyProvider: options.keyProvider,
      keychainAccessible: options.keychainAccessible,
    })
    const SQLite = requireExpoSqlite()
    const db = await SQLite.openDatabaseAsync(databaseName)
    try {
      // PRAGMA key must be the first statement against the database. SQLCipher
      // derives the AES key from the passphrase via PBKDF2.
      await db.execAsync(`PRAGMA key = '${escapeSql(key)}'`)
      const cipher = await db.getFirstAsync<{ cipher_version: string | null }>(
        'PRAGMA cipher_version',
      )
      if (cipher === null || cipher.cipher_version === null) {
        throw new StoreError(
          'expo-sqlite was built without SQLCipher; the database would not be encrypted. ' +
            'Add { "useSQLCipher": true } to the expo-sqlite plugin in your app.json and rebuild.',
        )
      }
      try {
        await db.getFirstAsync('SELECT count(*) FROM sqlite_master')
      } catch (e) {
        throw new StoreError(`cannot read database (wrong key or corrupted file): ${String(e)}`)
      }
      await db.execAsync('PRAGMA journal_mode = WAL')
      await runMigrations(db)
    } catch (e) {
      await db.closeAsync()
      throw e
    }
    return new SQLCipherProtocolStore(
      db,
      SQLite,
      databaseName,
      keyAlias,
      options.keyProvider !== undefined,
    )
  }

  // Local identity bootstrap

  async hasLocalIdentity(): Promise<boolean> {
    const row = await this.db.getFirstAsync<{ '1': number }>(
      'SELECT 1 FROM local_identity WHERE id = 1',
    )
    return row !== null
  }

  async initializeLocalIdentity(identity: IdentityKeyPair, registrationId: number): Promise<void> {
    if (await this.hasLocalIdentity()) {
      throw new StoreError('local identity already initialized; wipe() the store to replace it')
    }
    await this.db.runAsync(
      'INSERT INTO local_identity (id, key_pair, registration_id) VALUES (1, ?, ?)',
      [identity.serialize(), registrationId],
    )
  }

  // IdentityKeyStore

  async getIdentityKeyPair(): Promise<IdentityKeyPair> {
    const row = await this.db.getFirstAsync<{ key_pair: unknown }>(
      'SELECT key_pair FROM local_identity WHERE id = 1',
    )
    if (row === null) {
      throw new StoreError('local identity not initialized; call initializeLocalIdentity() first')
    }
    return IdentityKeyPair.deserialize(toBytes(row.key_pair))
  }

  async getLocalRegistrationId(): Promise<number> {
    const row = await this.db.getFirstAsync<{ registration_id: number }>(
      'SELECT registration_id FROM local_identity WHERE id = 1',
    )
    if (row === null) {
      throw new StoreError('local identity not initialized; call initializeLocalIdentity() first')
    }
    return Number(row.registration_id)
  }

  async saveIdentity(address: ProtocolAddress, key: IdentityKey): Promise<IdentityChange> {
    const name = address.name()
    const deviceId = address.deviceId()
    const keyBytes = key.serialize()
    const now = Date.now()
    let change: IdentityChange = 'newOrUnchanged'
    await this.db.withTransactionAsync(async () => {
      const existing = await this.db.getFirstAsync<{ identity_key: unknown }>(
        'SELECT identity_key FROM trusted_identities WHERE name = ? AND device_id = ?',
        [name, deviceId],
      )
      if (existing !== null && !bytesEqual(toBytes(existing.identity_key), keyBytes)) {
        change = 'replacedExisting'
      }
      await this.db.runAsync(
        'INSERT INTO trusted_identities (name, device_id, identity_key, first_seen_at, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?) ' +
          'ON CONFLICT(name, device_id) DO UPDATE SET identity_key = excluded.identity_key, updated_at = excluded.updated_at',
        [name, deviceId, keyBytes, now, now],
      )
    })
    return change
  }

  // Trust-on-first-use, matching libsignal's in-memory stores: an unknown
  // identity is trusted; a known identity must match. Direction is ignored.
  async isTrustedIdentity(
    address: ProtocolAddress,
    key: IdentityKey,
    _direction: Direction,
  ): Promise<boolean> {
    const existing = await this.getIdentity(address)
    return existing === null || bytesEqual(existing.serialize(), key.serialize())
  }

  async getIdentity(address: ProtocolAddress): Promise<IdentityKey | null> {
    const row = await this.db.getFirstAsync<{ identity_key: unknown }>(
      'SELECT identity_key FROM trusted_identities WHERE name = ? AND device_id = ?',
      [address.name(), address.deviceId()],
    )
    if (row === null) return null
    return IdentityKey.deserialize(toBytes(row.identity_key))
  }

  // SessionStore

  async loadSession(address: ProtocolAddress): Promise<SessionRecord | null> {
    const row = await this.db.getFirstAsync<{ record: unknown }>(
      'SELECT record FROM sessions WHERE name = ? AND device_id = ?',
      [address.name(), address.deviceId()],
    )
    if (row === null) return null
    return SessionRecord.deserialize(toBytes(row.record))
  }

  async storeSession(address: ProtocolAddress, record: SessionRecord): Promise<void> {
    await this.db.runAsync(
      'INSERT INTO sessions (name, device_id, record, updated_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(name, device_id) DO UPDATE SET record = excluded.record, updated_at = excluded.updated_at',
      [address.name(), address.deviceId(), record.serialize(), Date.now()],
    )
  }

  // PreKeyStore

  async loadPreKey(id: number): Promise<PreKeyRecord> {
    const row = await this.db.getFirstAsync<{ record: unknown }>(
      'SELECT record FROM prekeys WHERE id = ?',
      [id],
    )
    if (row === null) throw new InvalidKeyError(`no prekey with id ${id}`)
    return PreKeyRecord.deserialize(toBytes(row.record))
  }

  async loadPreKeys(): Promise<PreKeyRecord[]> {
    const rows = await this.db.getAllAsync<{ record: unknown }>(
      'SELECT record FROM prekeys ORDER BY id',
    )
    return Promise.all(rows.map((row) => PreKeyRecord.deserialize(toBytes(row.record))))
  }

  async storePreKey(id: number, record: PreKeyRecord): Promise<void> {
    await this.db.runAsync(
      'INSERT INTO prekeys (id, record) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record',
      [id, record.serialize()],
    )
  }

  async removePreKey(id: number): Promise<void> {
    await this.db.runAsync('DELETE FROM prekeys WHERE id = ?', [id])
  }

  // SignedPreKeyStore

  async loadSignedPreKey(id: number): Promise<SignedPreKeyRecord> {
    const row = await this.db.getFirstAsync<{ record: unknown }>(
      'SELECT record FROM signed_prekeys WHERE id = ?',
      [id],
    )
    if (row === null) throw new InvalidKeyError(`no signed prekey with id ${id}`)
    return SignedPreKeyRecord.deserialize(toBytes(row.record))
  }

  async loadSignedPreKeys(): Promise<SignedPreKeyRecord[]> {
    const rows = await this.db.getAllAsync<{ record: unknown }>(
      'SELECT record FROM signed_prekeys ORDER BY id',
    )
    return Promise.all(rows.map((row) => SignedPreKeyRecord.deserialize(toBytes(row.record))))
  }

  async storeSignedPreKey(id: number, record: SignedPreKeyRecord): Promise<void> {
    await this.db.runAsync(
      'INSERT INTO signed_prekeys (id, record, created_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET record = excluded.record',
      [id, record.serialize(), Date.now()],
    )
  }

  // KyberPreKeyStore

  async loadKyberPreKey(id: number): Promise<KyberPreKeyRecord> {
    const row = await this.db.getFirstAsync<{ record: unknown }>(
      'SELECT record FROM kyber_prekeys WHERE id = ?',
      [id],
    )
    if (row === null) throw new InvalidKeyError(`no kyber prekey with id ${id}`)
    return KyberPreKeyRecord.deserialize(toBytes(row.record))
  }

  async loadKyberPreKeys(): Promise<KyberPreKeyRecord[]> {
    const rows = await this.db.getAllAsync<{ record: unknown }>(
      'SELECT record FROM kyber_prekeys ORDER BY id',
    )
    return Promise.all(rows.map((row) => KyberPreKeyRecord.deserialize(toBytes(row.record))))
  }

  async storeKyberPreKey(id: number, record: KyberPreKeyRecord): Promise<void> {
    await this.db.runAsync(
      'INSERT INTO kyber_prekeys (id, record, created_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET record = excluded.record',
      [id, record.serialize(), Date.now()],
    )
  }

  // Records the use; retention is the consumer's policy. Used records stay
  // loadable because late-arriving PreKeySignalMessages may reference them.
  async markKyberPreKeyUsed(id: number): Promise<void> {
    await this.db.runAsync('UPDATE kyber_prekeys SET used_at = ? WHERE id = ?', [Date.now(), id])
  }

  // SenderKeyStore

  async loadSenderKey(
    sender: ProtocolAddress,
    distributionId: string,
  ): Promise<SenderKeyRecord | null> {
    const row = await this.db.getFirstAsync<{ record: unknown }>(
      'SELECT record FROM sender_keys WHERE name = ? AND device_id = ? AND distribution_id = ?',
      [sender.name(), sender.deviceId(), distributionId],
    )
    if (row === null) return null
    return SenderKeyRecord.deserialize(toBytes(row.record))
  }

  async storeSenderKey(
    sender: ProtocolAddress,
    distributionId: string,
    record: SenderKeyRecord,
  ): Promise<void> {
    await this.db.runAsync(
      'INSERT INTO sender_keys (name, device_id, distribution_id, record, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT(name, device_id, distribution_id) DO UPDATE SET record = excluded.record, updated_at = excluded.updated_at',
      [sender.name(), sender.deviceId(), distributionId, record.serialize(), Date.now()],
    )
  }

  // Lifecycle and concurrency

  /** Serialize protocol operations against this store. */
  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async close(): Promise<void> {
    await this.db.closeAsync()
  }

  /** Delete the database file and (unless a keyProvider was used) the stored key. */
  async wipe(): Promise<void> {
    try {
      await this.db.closeAsync()
    } catch {
      // already closed
    }
    await this.sqlite.deleteDatabaseAsync(this.databaseName)
    if (!this.usedKeyProvider) {
      await deleteDatabaseKey(this.keyAlias)
    }
  }
}
