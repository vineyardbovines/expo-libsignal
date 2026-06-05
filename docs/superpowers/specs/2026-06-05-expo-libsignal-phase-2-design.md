# expo-libsignal Phase 2 — Design Spec

**Status:** Approved
**Date:** 2026-06-05
**Author:** spence (with Claude)
**Phase:** 2 of 5 — 1:1 messaging (PreKey bundles, X3DH, Double Ratchet encrypt/decrypt)
**Builds on:** Phase 1 Foundation (`foundation-complete` tag), which shipped `IdentityKeyPair` end-to-end on iOS + Android, the typed `LibsignalError` hierarchy, the Expo config plugin, and the CI workflow.

---

## 1. Goal

Alice and Bob (two `IdentityKeyPair` instances) can establish a 1:1 session via X3DH and exchange Double-Ratchet-encrypted messages. The full handshake plus a few rounds of back-and-forth is verified in the example app on both iOS and Android.

## 2. Scope

### In

- New TypeScript public API surface:
  - `PublicKey` (libsignal's standalone EC public key, distinct from `IdentityKey`)
  - `ProtocolAddress` — `(name, deviceId)` tuple
  - `PreKeyRecord`, `SignedPreKeyRecord`, `KyberPreKeyRecord`
  - `PreKeyBundle` — what gets published to the server
  - `SessionRecord` — opaque session state with `serialize`/`deserialize` only
  - `SignalMessage`, `PreKeySignalMessage`, and the `CiphertextMessage` discriminated union
  - `SessionBuilder` — runs X3DH against a `PreKeyBundle`
  - `SessionCipher` — `encrypt`, `decryptPreKeySignal`, `decryptSignal`
  - Store interfaces: `SessionStore`, `IdentityKeyStore`, `PreKeyStore`, `SignedPreKeyStore`, `KyberPreKeyStore` — contracts only; consumers implement them.
- Native SharedObject wrappers for each of the above on iOS (Swift) + Android (Kotlin), following Phase 1's `Class()` registration pattern with throwing Kotlin `Constructor { }` blocks.
- Four stateless native crypto primitives: `processPreKeyBundleOp`, `encryptOp`, `decryptPreKeySignalOp`, `decryptSignalOp`.
- Module-level factory functions matching Phase 1 naming: `generatePreKeyRecord`, `deserializePreKeyRecord`, `generateSignedPreKeyRecord`, etc.
- TS unit tests for shape: error mapping, discriminator contracts, simple wrapper round-trips. (Same `jest-expo` setup; native is not loaded in unit tests.)
- Example app gains a tab navigator: Phase 1's smoke screen moves to an "Identity" tab; a new "Alice & Bob" tab runs the full handshake against a JS-side `InMemoryProtocolStore` and renders pass/fail per step.
- `example/SMOKE_TEST_LOG.md` gains a Phase 2 verification entry.
- README roadmap row updated to "shipped" at end.
- Final commit tagged `phase-2-complete`.

### Out (deferred to later phases)

- Default SQLCipher-backed store implementations → Phase 3.
- Sender Keys / group messaging (`GroupSessionBuilder`, `GroupCipher`, `SenderKeyDistributionMessage`, `SenderKeyStore`) → Phase 4.
- Sealed Sender → Phase 4.
- Provisioning protocol primitives → Phase 4.
- `SignalClient` facade → Phase 5.
- Full multi-tab playground (sealed sender, provisioning, inspector) → Phase 5.
- Native unit tests (XCTest / JUnit replay of libsignal vectors) → pre-1.0.
- Detox / Maestro E2E flows → pre-1.0.
- JS-pluggable stores via async bridge callbacks → not planned. Phase 3's SQLCipher stores use a separate native-only path.
- Web (WASM) → v2.

---

## 3. Key Decisions Locked

| Decision | Choice |
|---|---|
| Store bridge strategy | **Functional core, JS-owned state.** TS classes orchestrate read-from-store → call stateless native primitive → write returned deltas back. Native is stateless. |
| Store interfaces | Five separate TS interfaces (`SessionStore`, `IdentityKeyStore`, `PreKeyStore`, `SignedPreKeyStore`, `KyberPreKeyStore`); all methods return `Promise`. |
| Public TS API shape | Class-style (`SessionBuilder`, `SessionCipher`) matching the kickoff spec and the Java surface. Swift's free-function shape is hidden inside the native primitives. |
| Stores passed to constructors | Single options object (`{ sessionStore, identityStore, ... }`) rather than positional args. |
| `SessionBuilder` store set | Only `sessionStore` + `identityStore` — those are all `processPreKeyBundle` actually touches. |
| `SessionCipher` store set | All five stores. Only `decryptPreKeySignal` needs the prekey/signedprekey/kyber stores, but they live on the cipher to match the libsignal class. |
| Kyber prekey | **Required** in `PreKeyBundle`. Mandated by libsignal 0.94.4. |
| One-time prekey in bundle | **Optional**. Both `preKeyId` and `preKeyPublic` must be present together or both absent. |
| `CiphertextMessage` discrimination | Two concrete TS classes (`SignalMessage`, `PreKeySignalMessage`) each with `readonly type: 'signal' | 'preKeySignal'`. The union is `type CiphertextMessage = SignalMessage | PreKeySignalMessage`. |
| Native discrimination in `encryptOp` | Output has two nullable fields (`preKeySignalMessage`, `signalMessage`) plus a `messageType` tag. JS picks the populated one and constructs the right TS class. |
| Threading | All four native ops are `AsyncFunction` (Swift) / `Coroutine` (Kotlin). All TS surface methods are `async`. |
| Errors | Reuse Phase 1's `LibsignalError` hierarchy. No new classes added. Native `mapSignalError` may pick up additional kinds (e.g. `NoSession`, `InvalidKeyId`); these already route to existing classes. |
| Smoke testing | Manual run of the example app on iOS simulator + Android emulator, with results appended to `example/SMOKE_TEST_LOG.md`. No automated native tests this phase. |

---

## 4. Architecture

```
┌─────────────────────────────── JS ──────────────────────────────────┐
│  SessionBuilder { sessionStore, identityStore }                     │
│  SessionCipher  { sessionStore, identityStore, preKeyStore,         │
│                   signedPreKeyStore, kyberPreKeyStore }             │
│                                                                     │
│  processPreKeyBundle(remote, bundle):                               │
│    1. identityStore.getIdentityKeyPair / getLocalRegistrationId     │
│    2. identityStore.getIdentity(remote)                             │
│    3. sessionStore.loadSession(remote)        // may be null        │
│    4. NativeModule.processPreKeyBundleOp({...})                     │
│    5. sessionStore.storeSession(remote, newSession)                 │
│    6. identityStore.saveIdentity(remote, trustedRemoteIdentity)     │
│                                                                     │
│  encrypt(remote, plaintext):                                        │
│    1. read identity + registrationId + session + remote identity    │
│    2. NativeModule.encryptOp({...})                                 │
│    3. write back newSession + (maybe) identity                      │
│    4. construct PreKeySignalMessage or SignalMessage from native ref │
│                                                                     │
│  decryptPreKeySignal(remote, msg):                                  │
│    1. read identity / session / remote identity                     │
│    2. resolve referenced prekey, signed prekey, kyber prekey        │
│       from their stores (by ids on the message)                     │
│    3. NativeModule.decryptPreKeySignalOp({...})                     │
│    4. sessionStore.storeSession, identityStore.saveIdentity         │
│    5. preKeyStore.removePreKey(consumedPreKeyId) if non-null        │
│    6. kyberPreKeyStore.markKyberPreKeyUsed(kyberPreKeyId)           │
│                                                                     │
│  decryptSignal(remote, msg):                                        │
│    1. read identity + session                                       │
│    2. NativeModule.decryptSignalOp({...})                           │
│    3. write back newSession + (maybe) identity                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ JSI SharedObject + AsyncFunction
                               ▼
┌─────────────────────────── NATIVE ──────────────────────────────────┐
│  Stateless per-call ops. Each constructs an InMemory                │
│  SignalProtocolStore seeded with passed-in state, runs libsignal's  │
│  op, extracts post-state from the store, returns it.                │
│                                                                     │
│  Swift uses libsignal's top-level functions (signalEncrypt,         │
│  signalDecrypt, signalDecryptPreKey, processPreKeyBundle).          │
│  Kotlin uses SessionBuilder / SessionCipher classes constructed     │
│  per-call. Both seed an InMemorySignalProtocolStore.                │
│                                                                     │
│  SharedObject types: PublicKey, ProtocolAddress, PreKeyRecord,      │
│  SignedPreKeyRecord, KyberPreKeyRecord, PreKeyBundle,               │
│  SessionRecord, SignalMessage, PreKeySignalMessage.                 │
│  Plus a reusable IdentityKey ref (Phase 1's PublicIdentityKeyRef    │
│  may need a small extension to support construction from received   │
│  remote identities — see Section 8).                                │
└─────────────────────────────────────────────────────────────────────┘
```

The native side stays stateless because the JS side owns the canonical store state. Each op is a self-contained transaction over passed-in state.

**Why this works under both platforms' libsignal APIs:** Swift exposes free functions (`processPreKeyBundle(_:for:ourAddress:...)`, `signalEncrypt`, `signalDecrypt`, `signalDecryptPreKey`). Kotlin keeps `SessionBuilder`/`SessionCipher` classes. Both can be driven against a per-call seeded `InMemorySignalProtocolStore`. The four primitive ops are the only abstraction the JS side sees.

---

## 5. TypeScript Public API

All new types under `src/core/`, mirroring Phase 1's layout. Each TS class holds a private SharedObject ref obtained from a module-level factory call; methods on the class are auto-bound `Function`s on the SharedObject.

### `PublicKey`

```ts
export class PublicKey {
  static async deserialize(bytes: Uint8Array): Promise<PublicKey>
  serialize(): Uint8Array
}
```

### `ProtocolAddress`

```ts
export class ProtocolAddress {
  static async create(name: string, deviceId: number): Promise<ProtocolAddress>
  name(): string
  deviceId(): number
}
```

`deviceId` is a TS `number` but the underlying type is `uint32` constrained to 1–127. Range validated in TS before crossing the bridge.

### PreKey records

```ts
export class PreKeyRecord {
  static async generate(id: number): Promise<PreKeyRecord>
  static async deserialize(bytes: Uint8Array): Promise<PreKeyRecord>
  id(): number
  publicKey(): PublicKey
  serialize(): Uint8Array
}

export class SignedPreKeyRecord {
  static async generate(
    id: number,
    identityKeyPair: IdentityKeyPair,
    timestamp: number,
  ): Promise<SignedPreKeyRecord>
  static async deserialize(bytes: Uint8Array): Promise<SignedPreKeyRecord>
  id(): number
  timestamp(): number
  publicKey(): PublicKey
  signature(): Uint8Array
  serialize(): Uint8Array
}

export class KyberPreKeyRecord {
  static async generate(
    id: number,
    identityKeyPair: IdentityKeyPair,
    timestamp: number,
  ): Promise<KyberPreKeyRecord>
  static async deserialize(bytes: Uint8Array): Promise<KyberPreKeyRecord>
  id(): number
  timestamp(): number
  signature(): Uint8Array
  serialize(): Uint8Array
}
```

The signed and Kyber prekeys are signed using the consumer's `IdentityKeyPair`. The TS `generate` factory accepts the identity keypair and calls into the native primitive that produces both halves and the signature in one step.

### `PreKeyBundle`

```ts
export interface PreKeyBundleArgs {
  registrationId: number
  deviceId: number
  identityKey: IdentityKey
  signedPreKeyId: number
  signedPreKeyPublic: PublicKey
  signedPreKeySignature: Uint8Array
  kyberPreKeyId: number
  kyberPreKeyPublic: Uint8Array
  kyberPreKeySignature: Uint8Array
  preKeyId?: number
  preKeyPublic?: PublicKey
}

export class PreKeyBundle {
  static async create(args: PreKeyBundleArgs): Promise<PreKeyBundle>
  registrationId(): number
  deviceId(): number
  identityKey(): IdentityKey
  signedPreKeyId(): number
  signedPreKeyPublic(): PublicKey
  signedPreKeySignature(): Uint8Array
  kyberPreKeyId(): number
  kyberPreKeyPublic(): Uint8Array
  kyberPreKeySignature(): Uint8Array
  preKeyId(): number | null
  preKeyPublic(): PublicKey | null
}
```

`kyberPreKeyPublic` crosses the bridge as raw bytes rather than a dedicated `KEMPublicKey` SharedObject — we don't have any other operation in Phase 2 that consumes a Kyber public key in isolation, so the extra wrapper would be dead weight.

Validation in `create`: either both of `preKeyId` and `preKeyPublic` are present or neither is.

### `SessionRecord`

```ts
export class SessionRecord {
  static async deserialize(bytes: Uint8Array): Promise<SessionRecord>
  serialize(): Uint8Array
  // No public constructor — only produced by SessionBuilder / SessionCipher ops.
}
```

### Messages

```ts
export class SignalMessage {
  readonly type: 'signal'
  static async deserialize(bytes: Uint8Array): Promise<SignalMessage>
  serialize(): Uint8Array
}

export class PreKeySignalMessage {
  readonly type: 'preKeySignal'
  static async deserialize(bytes: Uint8Array): Promise<PreKeySignalMessage>
  serialize(): Uint8Array
  registrationId(): number
  preKeyId(): number | null
  signedPreKeyId(): number
}

export type CiphertextMessage = SignalMessage | PreKeySignalMessage
```

`type` is set in the TS constructor, not by the native side. The discriminator lets consumers write `if (msg.type === 'preKeySignal') ...` cleanly.

### Store interfaces

```ts
export type Direction = 'sending' | 'receiving'
export type IdentityChange = 'newOrUnchanged' | 'replacedExisting'

export interface IdentityKeyStore {
  getIdentityKeyPair(): Promise<IdentityKeyPair>
  getLocalRegistrationId(): Promise<number>
  saveIdentity(address: ProtocolAddress, key: IdentityKey): Promise<IdentityChange>
  isTrustedIdentity(
    address: ProtocolAddress,
    key: IdentityKey,
    direction: Direction,
  ): Promise<boolean>
  getIdentity(address: ProtocolAddress): Promise<IdentityKey | null>
}

export interface SessionStore {
  loadSession(address: ProtocolAddress): Promise<SessionRecord | null>
  storeSession(address: ProtocolAddress, record: SessionRecord): Promise<void>
}

export interface PreKeyStore {
  loadPreKey(id: number): Promise<PreKeyRecord> // throws InvalidKeyError if missing
  storePreKey(id: number, record: PreKeyRecord): Promise<void>
  removePreKey(id: number): Promise<void>
}

export interface SignedPreKeyStore {
  loadSignedPreKey(id: number): Promise<SignedPreKeyRecord>
  storeSignedPreKey(id: number, record: SignedPreKeyRecord): Promise<void>
}

export interface KyberPreKeyStore {
  loadKyberPreKey(id: number): Promise<KyberPreKeyRecord>
  storeKyberPreKey(id: number, record: KyberPreKeyRecord): Promise<void>
  markKyberPreKeyUsed(id: number): Promise<void>
}
```

All async. The native fast path in Phase 3 (SQLCipher) bypasses this layer entirely.

### Session orchestration

```ts
export interface SessionBuilderStores {
  sessionStore: SessionStore
  identityStore: IdentityKeyStore
}

export class SessionBuilder {
  constructor(stores: SessionBuilderStores, remote: ProtocolAddress)
  processPreKeyBundle(bundle: PreKeyBundle): Promise<void>
}

export interface SessionCipherStores {
  sessionStore: SessionStore
  identityStore: IdentityKeyStore
  preKeyStore: PreKeyStore
  signedPreKeyStore: SignedPreKeyStore
  kyberPreKeyStore: KyberPreKeyStore
}

export class SessionCipher {
  constructor(stores: SessionCipherStores, remote: ProtocolAddress)
  encrypt(plaintext: Uint8Array): Promise<CiphertextMessage>
  decryptPreKeySignal(message: PreKeySignalMessage): Promise<Uint8Array>
  decryptSignal(message: SignalMessage): Promise<Uint8Array>
}
```

`SessionBuilder` deliberately takes only the two stores it actually touches. `SessionCipher` takes all five even though `encrypt` and `decryptSignal` only need session + identity — the prekey/signed/kyber stores are needed for `decryptPreKeySignal`, and we keep the cipher whole rather than splitting into two classes.

### `src/index.ts` additions

The package root re-exports all new public types alongside the existing Phase 1 exports.

---

## 6. Native Primitives

### SharedObject ref types

One per new entity, all in `ios/` (Swift) and `android/src/main/java/expo/modules/libsignal/` (Kotlin). Each holds the libsignal handle.

Kotlin requires a throwing `Constructor { }` block on each (Phase 1 lesson #7). Swift does not.

### Module-level factory functions

Follow the Phase 1 convention exactly (`generateIdentityKeyPair`, `deserializeIdentityKeyPair`). All are `AsyncFunction` (Swift) / `Coroutine` (Kotlin).

```
generatePreKeyRecord(id)                                          -> PreKeyRecordRef
deserializePreKeyRecord(bytes)                                    -> PreKeyRecordRef
generateSignedPreKeyRecord(id, identityKeyPair, timestamp)        -> SignedPreKeyRecordRef
deserializeSignedPreKeyRecord(bytes)                              -> SignedPreKeyRecordRef
generateKyberPreKeyRecord(id, identityKeyPair, timestamp)         -> KyberPreKeyRecordRef
deserializeKyberPreKeyRecord(bytes)                               -> KyberPreKeyRecordRef
deserializePublicKey(bytes)                                       -> PublicKeyRef
createProtocolAddress(name, deviceId)                             -> ProtocolAddressRef
createPreKeyBundle({ ...12 fields, refs and bytes... })           -> PreKeyBundleRef
deserializeSessionRecord(bytes)                                   -> SessionRecordRef
deserializeSignalMessage(bytes)                                   -> SignalMessageRef
deserializePreKeySignalMessage(bytes)                             -> PreKeySignalMessageRef
```

### Instance methods on SharedObjects

Plain getters/serializers. Each is `Function("foo") { (ref: T) -> ... }` inside the `Class(T.self)` (Swift) / `Class(T::class) { ... }` (Kotlin) block. Auto-bound; JS calls as `ref.foo()`.

### Four core crypto primitives

All `AsyncFunction`/`Coroutine`. All take a single options record and return a single record.

**`processPreKeyBundleOp`** — drives X3DH.

| Input | |
|---|---|
| `bundle` | `PreKeyBundleRef` |
| `remoteAddress` | `ProtocolAddressRef` |
| `localAddress` | `ProtocolAddressRef` |
| `ourIdentityKeyPair` | `IdentityKeyPairRef` |
| `ourRegistrationId` | `number` |
| `existingSession` | `SessionRecordRef | null` |
| `existingRemoteIdentity` | `IdentityKeyRef | null` |
| `nowMs` | `number` |

| Output | |
|---|---|
| `newSession` | `SessionRecordRef` |
| `identityChange` | `'newOrUnchanged' | 'replacedExisting'` |
| `trustedRemoteIdentity` | `IdentityKeyRef` |

**`encryptOp`** — drives Double Ratchet send.

| Input | |
|---|---|
| `plaintext` | `Uint8Array` |
| `remoteAddress` | `ProtocolAddressRef` |
| `localAddress` | `ProtocolAddressRef` |
| `ourIdentityKeyPair` | `IdentityKeyPairRef` |
| `ourRegistrationId` | `number` |
| `existingSession` | `SessionRecordRef` (required) |
| `remoteIdentity` | `IdentityKeyRef | null` |
| `nowMs` | `number` |

| Output | |
|---|---|
| `messageType` | `'preKeySignal' | 'signal'` |
| `preKeySignalMessage` | `PreKeySignalMessageRef | null` |
| `signalMessage` | `SignalMessageRef | null` |
| `newSession` | `SessionRecordRef` |
| `identityChange` | `IdentityChange | null` |

Exactly one of `preKeySignalMessage` / `signalMessage` is non-null; the JS wrapper uses the `messageType` tag plus the non-null ref to construct the right TS class.

**`decryptPreKeySignalOp`** — drives Double Ratchet first-message receive.

| Input | |
|---|---|
| `message` | `PreKeySignalMessageRef` |
| `remoteAddress` | `ProtocolAddressRef` |
| `localAddress` | `ProtocolAddressRef` |
| `ourIdentityKeyPair` | `IdentityKeyPairRef` |
| `ourRegistrationId` | `number` |
| `existingSession` | `SessionRecordRef | null` |
| `existingRemoteIdentity` | `IdentityKeyRef | null` |
| `preKey` | `PreKeyRecordRef | null` (non-null iff the message carries a `preKeyId`) |
| `signedPreKey` | `SignedPreKeyRecordRef` |
| `kyberPreKey` | `KyberPreKeyRecordRef` |

| Output | |
|---|---|
| `plaintext` | `Uint8Array` |
| `newSession` | `SessionRecordRef` |
| `identityChange` | `IdentityChange | null` |
| `consumedPreKeyId` | `number | null` |
| `kyberPreKeyId` | `number` |

The JS wrapper uses `consumedPreKeyId` to call `preKeyStore.removePreKey` and `kyberPreKeyId` to call `kyberPreKeyStore.markKyberPreKeyUsed`.

**`decryptSignalOp`** — drives ongoing Double Ratchet receive.

| Input | |
|---|---|
| `message` | `SignalMessageRef` |
| `remoteAddress` | `ProtocolAddressRef` |
| `localAddress` | `ProtocolAddressRef` |
| `ourIdentityKeyPair` | `IdentityKeyPairRef` |
| `ourRegistrationId` | `number` |
| `existingSession` | `SessionRecordRef` (required) |
| `remoteIdentity` | `IdentityKeyRef | null` |

| Output | |
|---|---|
| `plaintext` | `Uint8Array` |
| `newSession` | `SessionRecordRef` |
| `identityChange` | `IdentityChange | null` |

### Platform-specific implementation notes

**Swift (`LibSignalClient` 0.94.4):** Each op constructs an `InMemorySignalProtocolStore`, seeded with `IdentityKeyPair` + `registrationId` via the `init(identity:registrationId:)` constructor. Then loads the relevant records into it (`storeSession`, `saveIdentity`, etc.). Then calls the top-level libsignal function (`processPreKeyBundle`, `signalEncrypt`, `signalDecrypt`, `signalDecryptPreKey`). Then reads post-state (`loadSession`, `identity(for:)`) from the same store. Uses `NullContext` for the `StoreContext` parameter.

**Kotlin (`libsignal-android` 0.94.4):** Each op constructs an `InMemorySignalProtocolStore` (libsignal provides one), seeds it the same way, constructs a `SessionBuilder` or `SessionCipher` against it, calls the method, reads post-state. The Kotlin class names are `SignalProtocolAddress` (not `ProtocolAddress`); our binding code translates between the names.

### Error mapping

Reuse Phase 1's `mapSignalError`. Add cases for new variants we'll see (`NoSession` → `SessionNotFound`, `InvalidKeyIdentifier` for prekey lookups → `InvalidKey`, `UntrustedIdentity` already mapped). No new JS error classes.

---

## 7. Example App Integration Test

The example app is the integration test — same model as Phase 1. New layout:

```
example/
├── App.tsx                          # entry — wraps tab navigator
├── src/
│   ├── stores/
│   │   └── InMemoryStores.ts        # implements the 5 store interfaces
│   ├── personas/
│   │   └── createPersona.ts         # identity + stores + registrationId bundle
│   └── screens/
│       ├── IdentityScreen.tsx       # Phase 1 smoke test, moved here
│       └── AliceBobScreen.tsx       # Phase 2 handshake + ratchet
└── SMOKE_TEST_LOG.md                # appended with Phase 2 result
```

**`InMemoryProtocolStore`** implements all five store interfaces against `Map`s keyed by `${address.name()}.${address.deviceId()}` for the address-keyed stores and by numeric id for the prekey stores. Stores the TS wrapper instances directly — no serialization until Phase 3.

**`createPersona(name)`** returns `{ identity: IdentityKeyPair, registrationId: number, stores: InMemoryProtocolStore, address: ProtocolAddress }`. The store's `getIdentityKeyPair`/`getLocalRegistrationId` return the persona's values.

**`AliceBobScreen` flow** (runs on mount, re-runnable):

1. Create Alice and Bob personas (fresh on each run).
2. Bob generates one-time `PreKeyRecord`, `SignedPreKeyRecord`, `KyberPreKeyRecord`. Stores them in Bob's stores. Composes a `PreKeyBundle`.
3. Alice: `new SessionBuilder({ sessionStore: alice.stores, identityStore: alice.stores }, bob.address).processPreKeyBundle(bundle)`.
4. Alice: `new SessionCipher({ ...alice.stores }, bob.address).encrypt(utf8('hello bob'))` — expect `messageType === 'preKeySignal'`.
5. Bob: `new SessionCipher({ ...bob.stores }, alice.address).decryptPreKeySignal(messageFromAlice)` — expect `'hello bob'`.
6. Bob: `encrypt(utf8('hi alice'))` — expect `messageType === 'signal'`.
7. Alice: `decryptSignal(messageFromBob)` — expect `'hi alice'`.
8. Round-trip three more messages each direction to exercise the ratchet.

**Assertions surfaced in the UI:**

- Step 4 message type === `'preKeySignal'`.
- Step 6 message type === `'signal'`.
- All decrypted bytes round-trip the plaintext exactly.
- Bob's `PreKeyStore` no longer contains the consumed prekey id (step 5 should have removed it).
- Bob's `KyberPreKeyStore` recorded the kyber prekey id as used.

**UI shape:** scrolling list of step labels showing pass/fail and a short detail (message type, byte length, first 16 hex of ciphertext). One "Re-run" button that resets both personas and replays. Visual rhythm matches Phase 1's smoke screen so failures are easy to spot.

**Expo SDK 56 compliance:** screen and navigator code authored against the live docs at https://docs.expo.dev/versions/v56.0.0/ (per `example/AGENTS.md`), not from memory.

**`SMOKE_TEST_LOG.md` append:**

```
## YYYY-MM-DD — Phase 2: 1:1 messaging
- iOS simulator: ok (Alice ↔ Bob handshake + 3 round-trips)
- Android emulator: ok (Alice ↔ Bob handshake + 3 round-trips)
- First message type: preKeySignal
- Subsequent message type: signal
- PreKey consumption: verified
- Kyber prekey marked used: verified
```

---

## 8. Risks and Open Items

Calling these out now so the implementation plan addresses them up front.

1. **`IdentityKeyRef` shape.** Phase 1 shipped `PublicIdentityKeyRef` as the SharedObject for an identity key. Phase 2's primitives return an identity ref (the trusted post-save remote identity). The implementation plan needs to either reuse `PublicIdentityKeyRef` or add a parallel `IdentityKeyRef` — to be settled in the plan against the actual Swift/Kotlin `IdentityKey` type. Either works; consistency matters more than the choice.

2. **Swift / Kotlin libsignal API drift.** Foundation taught us the kickoff spec can be wrong about specific signatures. Headers verified for this design against the installed `LibSignalClient` pod and the `libsignal-client-0.94.4.jar`. Notable confirmations:
   - Swift exposes top-level functions; Kotlin keeps `SessionBuilder` / `SessionCipher` classes.
   - Kyber is required in `PreKeyBundle` on both platforms.
   - Java type is `SignalProtocolAddress`, not `ProtocolAddress` — our binding renames.
   - Kotlin `IdentityKeyStore.IdentityChange` is an enum with `NEW_OR_UNCHANGED` / `REPLACED_EXISTING`; the Swift equivalent is `IdentityChange.newOrUnchanged` / `.replacedExisting`. The JS string-tag values match the Swift casing.
   - Kotlin's `KyberPreKeyStore.markKyberPreKeyUsed` takes `(int, int, ECPublicKey)`; Swift's takes `(id, signedPreKeyId, baseKey, context)`. Our TS interface simplifies to `markKyberPreKeyUsed(id: number)` — the additional args are derivable from libsignal's internal state and we don't need to expose them in Phase 2.

3. **PreKey vs. base-key reuse detection.** Swift's `markKyberPreKeyUsed` includes the base key for replay-attack detection (`baseKeysSeen`). Our TS surface drops this. Phase 2 ships without that protection because (a) the example app's in-memory store doesn't persist across runs, and (b) production consumers will get this for free once Phase 3's SQLCipher store implements it natively. Note in `SECURITY.md` if appropriate.

4. **Stack alignment.** Verified stack: Expo SDK 56, RN 0.85, Bun 1.3, Xcode 26.3, Android NDK 27, Java 17, libsignal 0.94.4. The Phase 1 plan's "Bun 1.x" was approximate; we run against installed versions.

---

## 9. Next step

Hand off to `superpowers:writing-plans` to produce the detailed implementation plan (file-by-file, task-by-task, with verification per step). The Phase 1 Foundation plan is the template for grain and shape; Phase 2 should be smaller (~20 tasks) since build/CI/plugin/error scaffolding is all in place.
