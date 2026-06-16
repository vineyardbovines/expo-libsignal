# expo-libsignal — Design Spec

**Status:** Draft for review
**Date:** 2026-06-05
**Author:** spence (with Claude)
**Parent project:** cvc-social (E2EE chat feature — design deferred until this library has a stable surface)

---

## 1. Context & Motivation

### Why this library exists

cvc-social needs end-to-end encrypted chat. The crypto layer requires Double Ratchet (forward secrecy) plus a group session protocol. The two practical options for that crypto in the React Native ecosystem are:

- **`signalapp/libsignal`** (Rust core, official) — AGPL-3.0
- **`matrix-org/vodozemac`** (Rust impl of Olm + Megolm) — Apache-2.0

We surveyed the existing RN bindings on 2026-06-04. No production-quality wrapper exists for either:

| Repo | Stars | Last push | License | Status |
|---|---|---|---|---|
| `signalapp/libsignal` (upstream) | 5,800 | active | AGPL-3.0 | Maintained |
| `p-num/react-native-libsignal-client` | 4 | Dec 2025 | unclear | Personal side project |
| `gooltu/expo-libsignal` | 0 | Apr 2026 | none | No license, unusable |
| `privacyresearchgroup/libsignal-protocol-typescript` | 113 | Jul 2023 | GPL-3.0 | Abandoned |

The ecosystem gap is real. Building this library serves two purposes simultaneously:

1. **Foundation for cvc-social's E2EE chat feature** (immediate need)
2. **A canonical, well-maintained Expo wrapper around libsignal** for the broader RN community (public contribution)

cvc-social will be the first production consumer; the library is designed to be **generally useful**, not cvc-social-specific.

### Licensing decision

cvc-social will be released under **AGPL-3.0** at App Store launch, matching Signal's and Session's approach. We accept the copyleft tradeoff because:

- cvc-social's moat is brand, network effects, hosted Convex deployment, and partnerships — not source code.
- The "open social" trend (Mastodon, Bluesky, Threads-on-ActivityPub) is real and accelerating; positioning as an open-source social app is an advantage.
- Internal/private development is unaffected — AGPL §6 only triggers on conveyance (App Store release or external TestFlight) or §13 (running a modified version as a public network service).
- Convex backend functions stay closed-source — they don't contain or link libsignal, only store ciphertext.

This library inherits AGPL from libsignal upstream. Non-negotiable.

### Scope decision

The full E2EE chat feature decomposes into multiple sub-projects. This spec covers **only** the library. cvc-social's chat feature (Convex schema, UI, NSE/FCM decryption code, QR pairing protocol, passphrase recovery flow) is a separate spec written after this library has a stable surface.

---

## 2. Decisions Locked

| Decision | Choice |
|---|---|
| Library name | `expo-libsignal` |
| Repo | New public GitHub repo, AGPL-3.0 |
| npm package | `expo-libsignal` |
| API shape | **Layered** — thin core mirrors libsignal + ergonomic `SignalClient` facade |
| Default store backend | **SQLCipher** via op-sqlite; pluggable |
| Platforms v1 | iOS (new arch) + Android (new arch). No old arch, no web. |
| Min Expo SDK | **55** |
| Min iOS | 14.0 |
| Min Android | API 24 |
| Core crypto | X3DH, Double Ratchet, Sender Keys, post-quantum (SPQR/Kyber) |
| Optional features v1 | **Sealed Sender** + **Provisioning protocol primitives**. No backup primitives in v1. |
| libsignal artifacts | **Vendor Signal's prebuilt** XCFramework (SPM) and Maven AAR. No Rust toolchain in our CI. |
| Versioning | Independent semver. 0.x = breaking allowed. 1.0 gated on real production usage. |
| Release tooling | changesets + GitHub Actions tag-based publish with npm provenance |
| Concurrency model | Serial dispatch queue per SignalClient instance; WAL-mode SQLCipher |
| Object lifecycle | JSI HostObjects via Expo SDK `SharedObject` — GC-managed |
| Threading | All native methods async by default |

---

## 3. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  Consumer Expo / React Native app                                │
│                                                                  │
│  import { SignalClient, core, errors } from 'expo-libsignal'     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ TypeScript layer                                           │  │
│  │  - core/    thin wrapper, mirrors libsignal upstream       │  │
│  │  - facade/  SignalClient — bundles stores, high-level API  │  │
│  │  - errors/  typed error class hierarchy                    │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          │ JSI SharedObject bridge               │
│                          ▼                                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Native layer (Swift / Kotlin via Expo Modules API)         │  │
│  │  - Bindings to libsignal (Rust core, vendored)             │  │
│  │  - Default SQLCipher-backed store impls (5 stores)         │  │
│  │  - Serial dispatch queue per database                      │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ libsignal (Rust, AGPL-3.0)                                 │  │
│  │  Vendored as:                                              │  │
│  │   - iOS:     LibSignalClient.xcframework via SPM           │  │
│  │   - Android: org.signal:libsignal-android from Maven       │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Encrypted state                                            │  │
│  │   SQLCipher database (signal.db) — key in expo-secure-store│  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

**Repo layout:**

```
expo-libsignal/
├── src/                       # TypeScript public API
│   ├── core/                  # thin wrapper — mirrors libsignal
│   ├── facade/                # SignalClient + default stores
│   ├── errors.ts
│   └── index.ts
├── ios/                       # Swift bindings via Expo Modules API
├── android/                   # Kotlin bindings via Expo Modules API
├── plugin/                    # Expo config plugin
│   └── src/
├── expo-module.config.json
├── example/                   # Three-persona playground app
├── .github/workflows/
├── SECURITY.md
├── LICENSE                    # AGPL-3.0
└── README.md
```

**Critical build choice:** we depend on Signal's pre-built artifacts (`LibSignalClient.xcframework` via Swift Package Manager, `org.signal:libsignal-android` via Maven). No Rust toolchain needed in our CI. Updates become single-line version bumps.

---

## 4. Native Module Surface (JS ↔ Native Boundary)

### Object lifecycle: JSI HostObjects via `SharedObject`

libsignal's API is built around stateful native objects (`IdentityKeyPair`, `SessionRecord`, etc.). We wrap each as an Expo `SharedObject` (introduced in SDK 53, stable by SDK 55). When the JS reference is collected, a finalizer drops the underlying Rust handle. No manual `close()` / `destroy()` required.

### Threading: async by default

All native methods return `Promise`. Native side dispatches to a per-database serial dispatch queue, so crypto operations are atomic across multiple store reads/writes. JS thread is never blocked. The few genuinely instant operations (e.g., `IdentityKeyPair.serialize()`) stay synchronous via JSI.

### Store callbacks: native-fast by default, JS-pluggable

Default SQLCipher stores live entirely in native code (Swift/Kotlin → SQLCipher). Zero JS bridge crossings during encrypt/decrypt — a single message decrypt touches 5–10 store rows; doing that across the bridge would be unacceptably slow.

For pluggable stores, the consumer implements a JS class:

```ts
class MyCustomSessionStore implements SessionStore {
  async load(address: ProtocolAddress): Promise<SessionRecord | null> { /* ... */ }
  async save(address: ProtocolAddress, record: SessionRecord): Promise<void> { /* ... */ }
}
const client = await SignalClient.create({ sessionStore: new MyCustomSessionStore() })
```

When custom stores are wired in, native crosses the bridge to JS for each store op — ~10–100× slower than the native path but flexible. Documented as a power-user feature.

### Error mapping

libsignal's Rust error variants map to a typed JS error class hierarchy:

```ts
class LibsignalError extends Error {}
class UntrustedIdentityError extends LibsignalError {}
class InvalidMessageError extends LibsignalError {}
class SessionNotFoundError extends LibsignalError {}
class InvalidKeyError extends LibsignalError {}
class DuplicateMessageError extends LibsignalError {}
// ... (one class per libsignal error variant)
```

Consumers can branch on type without parsing strings.

### Memory model

```
JS heap                          Rust heap
─────────                        ──────────
SessionRecord (SharedObject) ──→ Arc<SessionRecord>
IdentityKeyPair (SharedObject) ─→ Arc<IdentityKeyPair>
PreKeyBundle (SharedObject) ───→ Arc<PreKeyBundle>
        │
        │ GC + finalizer
        ▼
Rust handle released
```

---

## 5. TypeScript API: Thin Core (`core/`)

Mirrors libsignal upstream faithfully. One-to-one type mapping with Java/Swift class names. Power users live here.

### Identity

```ts
class IdentityKeyPair {
  static generate(): Promise<IdentityKeyPair>
  static deserialize(bytes: Uint8Array): Promise<IdentityKeyPair>
  publicKey(): IdentityKey
  privateKey(): PrivateKey
  serialize(): Uint8Array
}
class IdentityKey {}
class PrivateKey {}
```

### Addressing

```ts
class ProtocolAddress {
  constructor(name: string, deviceId: number)
  name(): string
  deviceId(): number
}
```

### PreKeys

```ts
class PreKeyRecord { /* id, publicKey, serialize */ }
class SignedPreKeyRecord { /* id, signature, serialize */ }
class KyberPreKeyRecord { /* post-quantum */ }

class PreKeyBundle {
  constructor(opts: {
    registrationId: number
    deviceId: number
    preKeyId?: number
    preKeyPublic?: PublicKey
    signedPreKeyId: number
    signedPreKeyPublic: PublicKey
    signedPreKeySignature: Uint8Array
    identityKey: IdentityKey
    kyberPreKeyId?: number
    kyberPreKeyPublic?: KyberPublicKey
    kyberPreKeySignature?: Uint8Array
  })
}
```

### Sessions (1:1)

```ts
class SessionBuilder {
  constructor(
    sessionStore: SessionStore,
    preKeyStore: PreKeyStore,
    signedPreKeyStore: SignedPreKeyStore,
    kyberPreKeyStore: KyberPreKeyStore,
    identityStore: IdentityKeyStore,
    remote: ProtocolAddress,
  )
  processPreKeyBundle(bundle: PreKeyBundle): Promise<void>
}

class SessionCipher {
  constructor(/* same store params + remote */)
  encrypt(plaintext: Uint8Array): Promise<CiphertextMessage>
  decryptPreKeySignal(message: PreKeySignalMessage): Promise<Uint8Array>
  decryptSignal(message: SignalMessage): Promise<Uint8Array>
}

type CiphertextMessage = PreKeySignalMessage | SignalMessage
```

### Sender keys (groups)

```ts
class GroupSessionBuilder {
  constructor(senderKeyStore: SenderKeyStore)
  createSenderKeyDistributionMessage(sender: ProtocolAddress, distributionId: Uuid): Promise<SenderKeyDistributionMessage>
  processSenderKeyDistributionMessage(sender: ProtocolAddress, message: SenderKeyDistributionMessage): Promise<void>
}

class GroupCipher {
  constructor(senderKeyStore: SenderKeyStore, sender: ProtocolAddress)
  encrypt(distributionId: Uuid, plaintext: Uint8Array): Promise<Uint8Array>
  decrypt(ciphertext: Uint8Array): Promise<Uint8Array>
}
```

### Sealed Sender

```ts
class SenderCertificate { /* deserialize, validate, expiry */ }
class ServerCertificate {}

namespace SealedSender {
  function encrypt(opts: {
    destination: ProtocolAddress
    senderCert: SenderCertificate
    message: Uint8Array
    sessionStore: SessionStore
    identityStore: IdentityKeyStore
  }): Promise<Uint8Array>

  function decryptMessage(opts: {
    ciphertext: Uint8Array
    trustRoot: PublicKey
    timestamp: number
    localE164?: string
    localUuid: string
    localDeviceId: number
    stores: { /* all four */ }
  }): Promise<DecryptionResult>
}
```

### Provisioning

```ts
class ProvisioningCipher {
  constructor(theirPublicKey: PublicKey, ourKeyPair?: IdentityKeyPair)
  encrypt(message: ProvisioningMessage): Promise<Uint8Array>
  decrypt(ciphertext: Uint8Array): Promise<ProvisioningMessage>
}
```

### Store interfaces

```ts
interface SessionStore {
  loadSession(address: ProtocolAddress): Promise<SessionRecord | null>
  storeSession(address: ProtocolAddress, record: SessionRecord): Promise<void>
}
interface IdentityKeyStore {
  getIdentityKeyPair(): Promise<IdentityKeyPair>
  getLocalRegistrationId(): Promise<number>
  saveIdentity(address: ProtocolAddress, key: IdentityKey): Promise<boolean>
  isTrustedIdentity(address: ProtocolAddress, key: IdentityKey, direction: Direction): Promise<boolean>
  getIdentity(address: ProtocolAddress): Promise<IdentityKey | null>
}
interface PreKeyStore { /* loadPreKey, storePreKey, removePreKey */ }
interface SignedPreKeyStore { /* loadSignedPreKey, storeSignedPreKey */ }
interface KyberPreKeyStore { /* same shape as signed */ }
interface SenderKeyStore { /* loadSenderKey, storeSenderKey */ }
```

---

## 6. TypeScript API: Ergonomic Facade (`facade/`)

The `SignalClient` class is what 95% of consumers use. Bundles all five stores internally, exposes a small high-level API.

### Open / wipe

```ts
const signal = await SignalClient.open({
  databasePath: FileSystem.documentDirectory + 'signal.db',
  keyAlias: 'com.cvc.signal',
})
await signal.hasIdentity()
await signal.generateIdentity()
await signal.wipe()
```

### PreKey lifecycle

```ts
const bundle = await signal.publishablePreKeyBundle({ oneTimeCount: 100 })
const replenished = await signal.replenishOneTimePreKeys(100)
const rotated = await signal.rotateSignedPreKey()
```

### 1:1 messaging

```ts
const recipient = new ProtocolAddress('user_abc', 1)
const ciphertext = await signal.encryptTo(recipient, plaintext, { preKeyBundle })
const plaintext = await signal.decryptFrom(senderAddress, ciphertext)
```

### Group messaging

```ts
const distributionId = crypto.randomUUID()
const distMsg = await signal.createGroupDistribution(distributionId)
await signal.processGroupDistribution(senderAddress, distMsg)
const ciphertext = await signal.encryptToGroup(distributionId, plaintext)
const plaintext = await signal.decryptFromGroup(senderAddress, ciphertext)
```

### Sealed Sender

```ts
await signal.setSenderCertificate(SenderCertificate.deserialize(cert))
const sealed = await signal.encryptSealedTo(recipient, plaintext)
const { sender, plaintext } = await signal.decryptSealed(sealedCiphertext, {
  trustRoot: SERVER_PUBLIC_KEY,
  timestamp: Date.now(),
})
```

### Provisioning primitives

```ts
const provisioningKey = await signal.generateProvisioningKey()
const provBundle = await signal.prepareProvisioningBundle({ theirPublicKey: scannedPublicKey })
await signal.acceptProvisioning(provisioningKey, encryptedBundle)
```

### Inspection

```ts
const remoteIdentity = await signal.getRemoteIdentity(address)
const fingerprint = await signal.computeFingerprint(localAddress, remoteAddress)
// fingerprint: { numeric: string, qrCodeData: Uint8Array }
```

### Export/import for recovery

```ts
const blob = await signal.exportIdentity(passphrase)  // Argon2id-wrapped
await signal.importIdentity(blob, passphrase)         // restore into fresh DB
```

Sessions and message history do not come along — caller mints fresh prekeys after import.

### Escape hatch

```ts
const stores = signal.stores()
const cipher = new core.SessionCipher(stores.session, stores.preKey, /* ... */, address)
```

### What the facade explicitly does NOT do

- Network calls. It doesn't know what Convex is.
- Conversation/group membership tracking.
- Message ordering, retries, offline queue.
- Push notification decryption.
- Backup/restore policy (only the encryption primitive).

---

## 7. Default Store Layer (SQLCipher)

### Dependencies

- `op-sqlite` (with SQLCipher build flag)
- `expo-secure-store` (peer dependency)
- libsignal's native serialization for record blobs

### Schema

```sql
CREATE TABLE schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE local_identity (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  key_pair                 BLOB NOT NULL,
  registration_id          INTEGER NOT NULL,
  sender_certificate       BLOB,
  sender_certificate_exp   INTEGER
);

CREATE TABLE trusted_identities (
  name           TEXT    NOT NULL,
  device_id      INTEGER NOT NULL,
  identity_key   BLOB    NOT NULL,
  first_seen_at  INTEGER NOT NULL,
  PRIMARY KEY (name, device_id)
);

CREATE TABLE sessions (
  name        TEXT    NOT NULL,
  device_id   INTEGER NOT NULL,
  record      BLOB    NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (name, device_id)
);

CREATE TABLE prekeys (
  id      INTEGER PRIMARY KEY,
  record  BLOB    NOT NULL
);

CREATE TABLE signed_prekeys (
  id          INTEGER PRIMARY KEY,
  record      BLOB    NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE kyber_prekeys (
  id              INTEGER PRIMARY KEY,
  record          BLOB    NOT NULL,
  created_at      INTEGER NOT NULL,
  is_last_resort  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sender_keys (
  sender_name       TEXT    NOT NULL,
  sender_device_id  INTEGER NOT NULL,
  distribution_id   TEXT    NOT NULL,
  record            BLOB    NOT NULL,
  PRIMARY KEY (sender_name, sender_device_id, distribution_id)
);

CREATE INDEX sessions_updated_idx ON sessions(updated_at);
CREATE INDEX signed_prekeys_created_idx ON signed_prekeys(created_at);
```

### Encryption-at-rest key

- 32 bytes from libsignal's CSPRNG on first open
- Stored in Keychain/Keystore via `expo-secure-store`
- iOS accessibility: `WhenUnlockedThisDeviceOnly` (no iCloud backup, no device migration)
- Android equivalent: `setUserAuthenticationRequired(false)` + `setIsStrongBoxBacked(true)` where available

### Open flow (pseudocode)

```
fun open(databasePath, keyAlias):
  dbKey = SecureStore.get(keyAlias)
  if dbKey is null:
    dbKey = libsignal.randomBytes(32)
    SecureStore.set(keyAlias, dbKey, accessibility = WhenUnlockedThisDeviceOnly)
  db = OpSQLite.open(databasePath)
  db.exec(PRAGMA key = ...)
  db.exec(PRAGMA journal_mode = WAL)
  runMigrations(db)
  return SignalClient(db)
```

### Concurrency

- **WAL mode** — concurrent readers, serialized writers
- **Serial dispatch queue per SignalClient instance** — guarantees atomicity across multi-store reads/writes within a single crypto op
- Opening two `SignalClient`s on the same database is undefined behavior; documented as "don't"

### Migrations

- Numbered SQL files in `ios/migrations/` and `android/migrations/`
- On open, run any pending migrations in order; update `schema_meta.version`
- **Forward-only**. Library downgrade against an upgraded DB throws `SchemaTooNewError`

### Customization escape hatches

```ts
const signal = await SignalClient.open({
  databasePath: '...',
  keyAlias: '...',
  keyProvider: async () => deriveKeyFromPassphrase(userPassphrase),  // optional
  customMigrations: [/* SQL strings */],                              // optional
})
```

`keyProvider` is the hook a passphrase-based recovery flow uses without us baking opinions about KDFs into the default.

---

## 8. Expo Config Plugin

### Consumer usage

```ts
// app.config.ts
export default {
  expo: {
    plugins: [
      ['expo-libsignal', {
        appGroup: 'group.com.cvc.social.signal',
        keychainAccessGroup: 'com.cvc.social.signal',
        enableSqlcipher: true,                          // default true
        generateNotificationServiceExtension: false,    // opt-in NSE scaffold
      }],
    ],
  },
}
```

All config keys are optional; defaults derive from the consumer's bundle identifier.

### What it does at prebuild

**iOS:**
- Add App Group entitlement (`com.apple.security.application-groups`)
- Add Keychain access group entitlement
- Add Push Notifications capability (no-op if present)
- Set `IPHONEOS_DEPLOYMENT_TARGET ≥ 14.0`
- Podfile post-install: enable SQLCipher in op-sqlite (`SQLITE_HAS_CODEC=1`)
- Register `LibSignalClient.xcframework` via SPM (via the module's podspec)
- Generate NSE target template (opt-in)

**Android:**
- Set `minSdkVersion ≥ 24`
- Add proguard rules for `org.signal.libsignal.protocol.*`
- Inject build.gradle dependency on `org.signal:libsignal-android`
- Wire SQLCipher build flag for op-sqlite
- Add `WAKE_LOCK` and `FOREGROUND_SERVICE` permissions (opt-in)

### Validation at prebuild

- App Group identifier matches `group.*` pattern
- Bundle ID is set
- `expo-secure-store` is in dependencies
- Min iOS/Android versions are achievable

Errors thrown with actionable messages, not silent failures.

### Out of scope for v1

- Auto-generating APNs certificates
- Code signing setup (EAS handles this)
- Background fetch capability (opt-in later if needed)

---

## 9. Example App

### Shape: single-app, three-persona playground

`example/` runs three simulated identities (Alice, Bob, Carol) in one process, each with its own SignalClient instance backed by a separate SQLCipher database. Ciphertext gets passed between them via in-memory function calls. No backend.

### Screens

| Screen | Demonstrates |
|---|---|
| Identities | `generateIdentity`, `hasIdentity`, `wipe`, fingerprints, `publishablePreKeyBundle` |
| One-to-one | First-message prekey flow, ongoing exchange, signed prekey rotation |
| Group | Sender key distribution to multiple recipients, group encrypt/decrypt, member rotation |
| Sealed Sender | Toggle sealed mode, mock cert issuance |
| Pairing | QR provisioning between simulated "phone" and "iPad" |
| Debug | SQLCipher inspector (decrypted), session state viewer |

### What the example app is NOT

- Not a chat UI competitor — no real-time, no animations, no notifications
- Not a Convex example — relay is in-memory
- Not a reference for production patterns (three identities in one process is pedagogical only)

### CI usage

Every PR builds the example app for iOS + Android via local EAS. The build succeeding is the signal that the library still compiles in a real Expo project.

### Manual test checklist (`example/MANUAL_TESTS.md`)

Pre-release checklist of flows to manually verify. Automated E2E (Detox/Maestro) deferred to v2.

---

## 10. CI, Release, Testing

### Testing layers

1. **TypeScript unit tests** (Jest + jest-expo) — type contracts, error hierarchy, serialization. Mocked native. Fast.
2. **Native test vectors** (XCTest + JUnit) — replay libsignal's official test vectors through our bindings; assert byte-equal outputs.
3. **Integration via example app build** — EAS local build for iOS + Android in CI.

### Workflows

- `ci.yml` — every PR + main: typecheck, lint (biome), unit tests, native tests, example app builds
- `release.yml` — tag push: re-run CI, publish to npm with provenance, GitHub release
- `security.yml` — weekly: `npm audit`, Dependabot triage, libsignal upstream advisory check
- `codeql.yml` — weekly static analysis for TS/Swift/Kotlin

### Release flow (changesets)

```
PR with changeset → merge to main → auto "Version Packages" PR opens →
maintainer merges → tag pushed → release.yml publishes
```

### Versioning policy

- **0.x** — every release may break API. Compatibility table in README.
- **1.0** gated on: (a) cvc-social shipped using it, (b) at least one external production consumer, (c) full API review pass.
- libsignal upstream pinned with exact version; bumped in dedicated PRs with manual review of upstream release notes.

### Security disclosure

`SECURITY.md`:
- Report via GitHub Security Advisories or `security@<domain>`
- Ack within 72h, critical patches within 7 days
- Coordinated disclosure preferred
- libsignal core vulnerabilities → Signal's security policy

### Supply chain hardening

- npm provenance attestations on every release
- Pinned exact versions for security-critical deps
- Dependabot enabled; auto-merge OFF for sensitive deps
- Branch protection on main: PR review + CI + signed commits
- Code owners file for native bindings, store schema, plugin, release workflow

### Deferred to pre-1.0

- Detox/Maestro E2E flows
- Performance regression benchmarks
- Native binding fuzz testing
- Cross-version session migration tests

---

## 11. Out of Scope for v1

Explicitly deferred to v2+ (features, not testing — testing improvements are listed under Section 10's "Deferred to pre-1.0"):

- **Web platform support (WASM)** — significant additional surface (async-only API, WebCrypto polyfills, IndexedDB storage layer). ~1–2 weeks of focused work. Defer until there's actual web demand.
- **Old architecture support** — RN 0.74 and earlier. We assume the new arch is universal by the time anyone adopts this library.
- **Backup/restore primitives** beyond the basic `exportIdentity` / `importIdentity` pair — Signal's svr2/SVR3 protocols, full history backup, key transparency integration.
- **Automatic prekey replenishment** — consumer calls `replenishOneTimePreKeys` on a schedule. Could ship a helper that watches server-reported counts later.
- **Pluggable Argon2 parameters** for passphrase wrapping — uses libsignal defaults in v1.

---

## 12. Open Questions

None blocking the implementation plan. Decisions that may want revisiting before 1.0:

- Whether the facade should expose an automatic prekey-replenishment cron-like helper, or stay explicit.
- Whether `provisioning` belongs in the facade at all, or should live only in `core` (currently in facade for convenience; usage is rare).
- Whether to ship a separate `expo-libsignal-react` sub-package with hooks (`useSignalClient`, `useFingerprint`, etc.) once we see real consumer patterns.

---

## 13. Glossary

- **X3DH (Extended Triple Diffie-Hellman)** — Signal's asynchronous key agreement, lets Alice establish a session with Bob even if Bob is offline (Bob pre-publishes "prekey" bundles).
- **Double Ratchet** — the per-message key derivation that gives forward secrecy + post-compromise security. Each message uses a fresh key; keys are deleted after use.
- **PreKey** — a one-time public key Bob publishes to the server. Alice consumes one to start a session. Replenished as they're used.
- **Signed PreKey** — a longer-lived prekey signed by Bob's identity key. Rotated periodically (libsignal recommends weekly).
- **Kyber PreKey** — post-quantum prekey. Combined with X25519 for hybrid PQ key agreement.
- **Sender Keys** — Signal's group messaging mechanism. Each sender derives a symmetric "sender key" once, distributes it to group members via 1:1 messages, then encrypts subsequent group messages with it. O(1) encrypts per group message instead of O(N).
- **Sealed Sender** — hides the sender's identity from the server. Server delivers the ciphertext unauthenticated; the recipient verifies the sender via a server-issued certificate inside the encrypted payload.
- **SPQR (Sparse Post-Quantum Ratchet)** — Signal's PQ ratchet, shipped 2026. Adds Kyber-based post-quantum security alongside the X25519 ratchet.
- **Provisioning** — the protocol Signal uses to add a second device. New device generates an ephemeral keypair, displays a QR; existing device scans it and sends an encrypted bundle containing the shared identity key.
- **ProtocolAddress** — libsignal's `(name, deviceId)` tuple identifying a specific device.

---

## 14. Next Step

After this spec is approved, hand off to the `superpowers:writing-plans` skill to produce a detailed implementation plan (file-by-file build order, dependencies between tasks, verification criteria per step).
