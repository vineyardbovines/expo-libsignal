# expo-libsignal Phase 3 — Design Spec

**Status:** Approved
**Date:** 2026-06-12
**Author:** spence (with Claude)
**Phase:** 3 of 5 — default SQLCipher-backed stores
**Builds on:** Phase 2 (`phase-2-complete` tag): 1:1 messaging end-to-end on both platforms, five JS store interfaces, stateless native ops with the primitives-only record / positional-bytes boundary contract.

---

## 1. Goal

A production-ready, pluggable implementation of the five store interfaces backed by SQLCipher, so a consumer can persist Signal protocol state across app restarts without writing a store. Includes the database key management design, a real fix for the kyber prekey id lookup (Phase 2 gotcha 8), and an explicit decision on the native fast path.

## 2. Scope

### In

- `SQLCipherProtocolStore`: one class implementing all five store interfaces over a single op-sqlite database. Exposed via a new `expo-libsignal/stores` subpath entry.
- Database key management: random 32-byte key, hex-encoded, stored in expo-secure-store, with a `keyProvider` escape hatch.
- Kyber prekey id fix: `KyberPreKeyStore` interface gains `loadKyberPreKeys()` (matches upstream libsignal-java); `decryptPreKeySignalOp` accepts all kyber prekeys and returns the id that was actually used.
- Native module gains `generateRandomBytes(length)` (SecRandomCopyBytes / SecureRandom) for key generation.
- Schema v1 + forward-only migration machinery, versioned in `schema_meta`.
- Concurrency per locked decisions: WAL mode, serial execution via `runExclusive`.
- New error classes: `StoreError`, `SchemaTooNewError`.
- Example app: third tab ("Persistence") exercising the SQLCipher stores across app restarts, with a machine-readable `[SQLCIPHER-SUMMARY]` log line; smoke-test entries for both platforms.
- Example `InMemoryProtocolStore` updated for the interface change (drops the 1:1 kyber/signed id toy mapping).
- Native fast path: design and decision documented here (Section 10); implementation deferred.
- README: usage section for the default store, roadmap row flipped, breaking-change note for the `KyberPreKeyStore` interface.

### Out (deferred)

- Native fast path implementation (Section 10; revisit at Phase 4 or on measured need).
- Kyber base-key replay protection (`ReusedBaseKeyException` semantics). Requires feeding seen base keys into the decrypt op; lands with the fast path or a later op revision. Documented in SECURITY.md.
- `sender_keys` table and `SenderKeyStore` (Phase 4, added via migration v2).
- `SignalClient` facade, automatic prekey replenishment, export/import (Phase 5).
- Web.

## 3. Key Decisions

| Decision | Choice |
|---|---|
| Store location | **JS-side**, over op-sqlite (JSI). Native ops stay stateless; the Phase 2 boundary contract is unchanged except for the kyber arg. |
| SQLite binding | `@op-engineering/op-sqlite` with SQLCipher, per the locked design decision. Optional peer dependency. |
| SQLCipher enablement | Consumer adds `"op-sqlite": { "sqlcipher": true }` to their app package.json (op-sqlite's build scripts read it from the app root; a library cannot ship it). We verify at runtime via `PRAGMA cipher_version` and throw `StoreError` if the build lacks SQLCipher. |
| Packaging | New subpath export `expo-libsignal/stores`. The main entry never references op-sqlite or expo-secure-store, so consumers with custom stores never resolve them (Metro resolves statically; a reachable require of an uninstalled package breaks the bundle). |
| DB key | 32 random bytes from the native module, hex-encoded (64 chars), stored via expo-secure-store, passed as op-sqlite `encryptionKey` (SQLCipher passphrase semantics; the KDF runs over a 256-bit-entropy string). |
| Key storage | `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY` (locked decision), `requireAuthentication: false`, `keychainService` = key alias. Both overridable in options. |
| Kyber id fix | Interface gains `loadKyberPreKeys()`; SessionCipher passes all kyber prekeys to the op as one length-prefixed blob; native seeds them all and a recording wrapper captures the id libsignal actually marks used. **Breaking change** to `KyberPreKeyStore` (0.x). |
| `kyberPreKeyId` result | Becomes nullable. A PreKeySignalMessage replayed against an existing session can decrypt without touching kyber prekeys; JS only calls `markKyberPreKeyUsed` when non-null. |
| `markKyberPreKeyUsed` semantics in default store | Sets `used_at`; records are retained (tiny, and late-arriving messages may reference them). Retention policy is the consumer's. |
| Concurrency | WAL via PRAGMA after open. `runExclusive(fn)` promise-queue mutex on the store; consumers wrap each protocol operation. Multi-statement store methods use `db.transaction`. |
| Migrations | Numbered SQL batches in TS, forward-only, `schema_meta.version`. Downgrade throws `SchemaTooNewError`. 0.x: schema may change without data migration paths; breaking releases say so. |
| Errors | `StoreError extends LibsignalError`, `SchemaTooNewError extends StoreError`. Missing prekey lookups keep throwing `InvalidKeyError`. |
| Trust model | Trust-on-first-use, matching libsignal's in-memory stores: unknown identity is trusted, matching identity is trusted, mismatch is untrusted. `direction` is accepted and ignored (upstream in-memory does the same). |
| One store class | A single `SQLCipherProtocolStore` implements all five interfaces. Splitting into five classes adds surface with no consumer benefit; the interfaces stay the pluggability seam. |

### Approaches considered

**A. JS-side stores over op-sqlite (chosen).** Matches the shipped Phase 2 architecture (JS owns canonical state, native ops are stateless), the locked op-sqlite decision, and pluggability falls out for free. Per-op cost is a few JSI sqlite calls plus the existing byte round-trips, which Phase 2 smoke runs showed are millisecond-scale for 1:1 traffic.

**B. Native-side stores now.** Swift/Kotlin implementations of libsignal's store protocols over a natively linked SQLCipher; ops do zero JS round-trips. Rejected for Phase 3: it needs our own SQLCipher native dependency (op-sqlite does not expose its bundled copy to other modules, and a second copy risks duplicate-symbol conflicts in apps that also use op-sqlite), two more store implementations to keep in parity, and a native migration runner. This is the fast path, designed for in Section 10 and deferred.

**C. expo-sqlite instead of op-sqlite.** Not relitigated; op-sqlite is a locked decision from the original design spec.

## 4. Architecture

```
┌────────────────────────────── JS ───────────────────────────────┐
│ SessionBuilder / SessionCipher        (unchanged orchestration)  │
│        │ five store interfaces                                   │
│        ▼                                                         │
│ SQLCipherProtocolStore  (expo-libsignal/stores)                  │
│   open() ─ key from expo-secure-store ─ op-sqlite open           │
│   PRAGMA cipher_version check ─ WAL ─ migrations                 │
│   interface methods = SQL over bytes-in/bytes-out tables         │
│   runExclusive() serializes protocol ops                         │
└───────────────┬───────────────────────────┬──────────────────────┘
                │ op-sqlite JSI             │ existing op boundary
                ▼                           ▼
        SQLCipher database          stateless libsignal ops
        (signal store file)         (kyber arg revised, Section 5)
```

Stores receive and return the existing wrapper classes (`SessionRecord`, `PreKeyRecord`, ...). Their canonical form is `serialize()` bytes; every table stores those bytes as BLOBs, so the schema is also readable by a future native fast path.

## 5. Kyber prekey id fix

Phase 2 gotcha 8: libsignal 0.94.4 does not expose the kyber prekey id on `PreKeySignalMessage`, and `SessionCipher.decryptPreKeySignal` currently loads the kyber prekey by `signedPreKeyId` as a placeholder. The fix has four parts.

### 5.1 Interface change (breaking, 0.x)

```ts
export interface KyberPreKeyStore {
  loadKyberPreKey(id: number): Promise<KyberPreKeyRecord>
  loadKyberPreKeys(): Promise<KyberPreKeyRecord[]>   // NEW, matches libsignal-java
  storeKyberPreKey(id: number, record: KyberPreKeyRecord): Promise<void>
  markKyberPreKeyUsed(id: number): Promise<void>
}
```

`loadKyberPreKeys()` is verified present on upstream `org.signal.libsignal.protocol.state.KyberPreKeyStore` (0.94.4 jar), so we are matching surface, not inventing it.

### 5.2 Boundary framing

`decryptPreKeySignalOp` is at the 8-argument ceiling, so the single `kyberPreKey` positional arg is replaced (not appended) by `kyberPreKeys`: all records concatenated into one `Uint8Array`, each prefixed with a big-endian u32 length. A pure-TS helper pair in `src/core/recordList.ts`:

```ts
export function encodeRecordList(records: Uint8Array[]): Uint8Array
export function decodeRecordList(blob: Uint8Array): Uint8Array[]  // for tests
```

Swift/Kotlin get matching decoders. Each `KyberPreKeyRecord` carries its own id, so ids need no separate framing. Kyber records are ~1.7 KB; even a generous on-device pool (a last-resort key plus a small rotation window) stays in the tens of KB per first-message decrypt. If a consumer maintains a large one-time kyber pool this is the known cost; it disappears when a future libsignal version exposes the id on the message (drop load-all, load by id).

### 5.3 Native: seed all, record the used id

Both ops currently seed one kyber record and echo its id back. New behavior:

- Deserialize and `storeKyberPreKey` every record in the blob.
- Wrap or subclass the per-call in-memory store so `markKyberPreKeyUsed(id, signedPreKeyId, baseKey)` records the id when libsignal calls it during PQ decrypt (signature verified on both platforms: Swift `DataStoreInMemory.swift:120` is `open func`, Java interface method on `KyberPreKeyStore`).
- Result field `kyberPreKeyId` becomes nullable: null when decrypt completed without consuming a kyber prekey (replay against an existing session).

### 5.4 SessionCipher + stores

`decryptPreKeySignal` calls `loadKyberPreKeys()`, frames them, and after the op calls `markKyberPreKeyUsed(result.kyberPreKeyId)` only when non-null. The placeholder comment block and the example store's 1:1 mapping are deleted. `nativeBoundary.test.ts` pins the new framing and nullability with identity assertions.

## 6. `SQLCipherProtocolStore` API

```ts
// expo-libsignal/stores
export interface SQLCipherStoreOptions {
  databaseName?: string        // default 'expo-libsignal.db'
  location?: string            // op-sqlite location passthrough
  keyAlias?: string            // secure-store key + keychainService; default 'expo-libsignal.dbkey'
  keyProvider?: () => Promise<string>   // overrides secure-store entirely (e.g. passphrase-derived)
  keychainAccessible?: SecureStore.KeychainAccessibilityConstant  // default WHEN_UNLOCKED_THIS_DEVICE_ONLY
}

export class SQLCipherProtocolStore
  implements SessionStore, IdentityKeyStore, PreKeyStore, SignedPreKeyStore, KyberPreKeyStore {

  static async open(options?: SQLCipherStoreOptions): Promise<SQLCipherProtocolStore>

  // identity bootstrap (local_identity row is required before protocol ops)
  hasLocalIdentity(): Promise<boolean>
  initializeLocalIdentity(identity: IdentityKeyPair, registrationId: number): Promise<void>

  // ...all five interface implementations...

  runExclusive<T>(fn: () => Promise<T>): Promise<T>
  close(): Promise<void>
  wipe(): Promise<void>   // drops the db file and the secure-store key
}
```

Behavior notes:

- `open()` lazily `require`s op-sqlite and expo-secure-store; a missing module throws `StoreError` with the install instruction. Open order: resolve key → `open({ name, location, encryptionKey })` → `PRAGMA cipher_version` (no row: `StoreError`, op-sqlite built without SQLCipher) → probe query (failure: `StoreError`, wrong key or corrupt file) → `PRAGMA journal_mode = WAL` → migrations.
- `getIdentityKeyPair` / `getLocalRegistrationId` throw `StoreError` until `initializeLocalIdentity` has run. Identity rotation is out of scope; `initializeLocalIdentity` on an already-initialized store throws `StoreError` (use `wipe()` first).
- `saveIdentity` upserts and returns `'replacedExisting'` when an existing, different key was overwritten (byte comparison of serialized keys), else `'newOrUnchanged'`; read-then-write runs inside `db.transaction`.
- `loadPreKey` / `loadSignedPreKey` / `loadKyberPreKey` throw `InvalidKeyError` for missing ids (the contract Phase 2 documented).
- `runExclusive` is a promise-chain mutex. Consumers wrap each protocol operation (`processPreKeyBundle`, `encrypt`, `decryptPreKeySignal`, `decryptSignal`) so a crypto op's read-op-write sequence is atomic with respect to other ops on the same store. The Phase 5 facade will do this automatically; until then it is a documented pattern, used by the example app.
- Two stores on the same database file is documented as "don't", same as the original design.

## 7. Key management

- First open under a `keyAlias`: native `generateRandomBytes(32)`, hex-encode, `SecureStore.setItemAsync(keyAlias, hex, { keychainService: keyAlias, keychainAccessible, requireAuthentication: false })`. Subsequent opens read it back.
- The hex string is passed as op-sqlite's `encryptionKey`, i.e. SQLCipher passphrase semantics: SQLCipher's KDF runs over a string carrying 256 bits of entropy. This costs one KDF per open (default SQLCipher 4 settings) and avoids raw-key PRAGMA quoting; switching to raw-key (`PRAGMA key = "x'..'"`) is a documented future optimization that must be coordinated with the fast path (Section 10).
- `WHEN_UNLOCKED_THIS_DEVICE_ONLY` is the locked default: no iCloud/device migration, unavailable before first unlock. Overridable (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` is the documented choice for apps that decrypt in background/NSE contexts).
- `requireAuthentication: false`: the DB key must be readable without a biometric prompt for background message processing. expo-secure-store on Android is Keystore-encrypted SharedPreferences; no StrongBox guarantee is documented, and we do not claim one.
- `keyProvider` bypasses secure-store for passphrase-derived keys (recovery flows). The provider's string is used as the passphrase verbatim; KDF choice is the consumer's.
- iOS keychain values survive app uninstall/reinstall while the database file does not; `open()` treats "key exists, file missing" as a fresh database (new file, same key), which is the natural outcome of the open flow and needs no special casing. The reverse (file exists, key lost) surfaces as the wrong-key `StoreError`.

## 8. Schema and migrations

Schema v1 (every record BLOB is the libsignal serialized form):

```sql
CREATE TABLE schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE local_identity (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  key_pair        BLOB    NOT NULL,
  registration_id INTEGER NOT NULL
);

CREATE TABLE trusted_identities (
  name          TEXT    NOT NULL,
  device_id     INTEGER NOT NULL,
  identity_key  BLOB    NOT NULL,
  first_seen_at INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (name, device_id)
);

CREATE TABLE sessions (
  name       TEXT    NOT NULL,
  device_id  INTEGER NOT NULL,
  record     BLOB    NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (name, device_id)
);

CREATE TABLE prekeys (
  id     INTEGER PRIMARY KEY,
  record BLOB NOT NULL
);

CREATE TABLE signed_prekeys (
  id         INTEGER PRIMARY KEY,
  record     BLOB    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE kyber_prekeys (
  id         INTEGER PRIMARY KEY,
  record     BLOB    NOT NULL,
  created_at INTEGER NOT NULL,
  used_at    INTEGER
);

CREATE INDEX sessions_updated_idx ON sessions(updated_at);
CREATE INDEX signed_prekeys_created_idx ON signed_prekeys(created_at);
```

Differences from the original design spec's draft schema: `sender_keys` and the sender-certificate columns wait for Phase 4 (migration v2), `is_last_resort` is dropped (nothing in the API surfaces it yet) in favor of `used_at`.

Migrations: `const MIGRATIONS: string[][]` in TS, index n holds the statements taking the schema from version n to n+1. On open: read `schema_meta.version` (0 for a fresh file), throw `SchemaTooNewError` if it exceeds the library's `SCHEMA_VERSION`, run pending batches inside a transaction, write the new version. Forward-only. During 0.x a release may replace migrations with a breaking reset; release notes must say so explicitly.

## 9. Concurrency

- WAL mode set once per open. No documented op-sqlite caveat for WAL with SQLCipher; the example app's restart cycle exercises reopen-after-WAL on both platforms.
- op-sqlite runs queries on a single dedicated thread per database, so individual statements never interleave. The unit that needs serialization is the protocol op (several reads, a native crypto call, several writes); `runExclusive` provides it per store instance, satisfying the "serial dispatch per client" locked decision at the layer that exists in Phase 3.

## 10. Native fast path: decision

**Decision: design now, defer implementation.** Phase 3 ships JS-side stores only.

What the fast path would be: Swift/Kotlin implementations of libsignal's store protocols over the same SQLCipher file, with ops taking a database handle instead of state bytes, eliminating all per-op byte round-trips and JS store calls.

Why deferred:

- Measured need is absent. Phase 2 smoke runs put full encrypt/decrypt round-trips at millisecond scale; 1:1 messaging does not justify the cost. The first real pressure point is group fan-out (Phase 4).
- Native SQLCipher linkage is the hard part: op-sqlite's bundled SQLCipher is not consumable by other native modules, so we would ship our own (CocoaPods SQLCipher pod, `net.zetetic` AAR) and risk duplicate-symbol/version conflicts inside apps that also build op-sqlite's copy.
- It doubles the store surface (two platforms) and needs a native migration runner kept in lockstep with the TS one.

What this design fixes now so the fast path can land later without breaking consumers:

1. The schema is the contract. All blobs are libsignal serialized forms, directly loadable by native code. Schema version lives in the database (`schema_meta`), not in either runtime.
2. Key delivery is specified (hex string, passphrase semantics). A native open must apply identical KDF semantics; any move to raw-key PRAGMAs happens in both paths at once, behind a schema/meta flag.
3. The pluggability seam is the five interfaces. A native-backed store variant ships as a drop-in alternative class; `SessionBuilder`/`SessionCipher` signatures do not change. A later optimization can also let ops detect a native-backed store and skip the JS round-trip internally.
4. Revisit trigger: Phase 4 (sender-key fan-out) or a measured perf problem; a pre-1.0 benchmark task compares the paths. Kyber base-key replay enforcement (Section 2 Out) is bundled into the fast-path revisit, since it needs persistent state visible at decrypt time.

## 11. Example app

New "Persistence" tab alongside Identity and Alice & Bob. Alice and Bob each get a `SQLCipherProtocolStore` (`alice.db` / `bob.db`, distinct key aliases). Flow on mount:

- **Fresh run** (no local identity or no session): initialize identities, Bob publishes a bundle, handshake, two round-trips. Bob's kyber setup stores a decoy kyber prekey (id 100) plus the bundle's real one (id 101), with signed prekey id 7; the test asserts the op reports used id 101, proving real id mapping (the Phase 2 toy mapping would have looked up id 7 and failed).
- **Resumed run** (identity and session found on open): no handshake; both directions encrypt/decrypt immediately with the persisted session, asserting the first message type is already `signal`.

Each run logs one machine-readable line: `[SQLCIPHER-SUMMARY] {"run":"fresh"|"resumed","pass":bool,"kyberUsedId":number|null,"steps":[...]}`. Headless verification greps Metro logs for it, same as `[ALICEBOB-SUMMARY]`. A "Wipe both stores" button resets to the fresh path. All protocol ops run inside `runExclusive`.

The smoke-test procedure per platform: launch (fresh summary), kill the app, relaunch (resumed summary), append both to `example/SMOKE_TEST_LOG.md`.

Example app changes: `"op-sqlite": { "sqlcipher": true }` plus the dependency in `example/package.json`, prebuild refresh, and the `InMemoryProtocolStore` interface update. op-sqlite needs no config plugin. The op-sqlite version is pinned to the newest release that builds against the example's RN 0.85 (16.2.1 first; fall back to the 15.2.x line if the build objects; no published compat table exists).

## 12. Testing

- `bun run typecheck && bun run lint && bun test` between tasks (no change).
- New jest coverage: `recordList` encode/decode round-trips (including empty list and single record), `nativeBoundary.test.ts` extended to pin the revised `decryptPreKeySignalOp` arg (framed blob identity, arg position) and nullable `kyberPreKeyId` handling, migration table integrity (versions contiguous, statements non-empty), and key-resolution logic with a mocked expo-secure-store (create-on-first-open, reuse, keyProvider bypass).
- SQL behavior is not unit tested against a fake; the example app on both platforms is the integration test, per the established model.
- Final verification: smoke runs on iOS simulator and Android emulator, both `[ALICEBOB-SUMMARY]` (regression) and `[SQLCIPHER-SUMMARY]` fresh + resumed, logged to `SMOKE_TEST_LOG.md`, then tag `phase-3-complete`.

## 13. Risks and open items

1. **op-sqlite version against RN 0.85.** 16.x dev-tests against RN 0.86; no compat statement exists for 0.85. Mitigation: pin and build early in the plan (it gates the example app work); 15.2.x is the fallback.
2. **Recording wrapper on Android.** Verified the Java interface signature; the plan must confirm `InMemorySignalProtocolStore`'s kyber methods are overridable (or compose a custom store) against the installed jar before writing the op.
3. **`markKyberPreKeyUsed` not called.** If libsignal's replay short-circuit path skips kyber entirely, `kyberPreKeyId` is null by design; the example app cannot easily force this path, so it is covered by the nullable contract and unit tests only.
4. **SQLCipher open failure modes.** Wrong key and not-a-database both surface as the probe-query `StoreError`; we do not distinguish them (SQLite does not let us).
5. **expo-secure-store value limits.** 64-char hex is far below any platform threshold.
6. **Phase 1/2 gotchas all still apply** (Metro stale bundles after `bun run build`, gnu-sed vs xcframework script, 8-arg ceiling, Android record constraints). The plan carries them as standing notes.

## 14. Next step

Hand off to `superpowers:writing-plans` for the implementation plan, modeled on the Phase 2 plan's grain. Suggested build order: boundary fix first (interface, framing, native ops, tests), then the store layer, then the example app, then on-device verification.
