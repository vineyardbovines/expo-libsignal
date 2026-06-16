# Sender Keys (Phase 4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Signal group messaging via Sender Keys on top of the existing 1:1 messaging stack, end to end on Android and iOS.

**Architecture:** Three new TypeScript classes (`SenderKeyDistributionMessage`, `SenderKeyRecord`, `GroupSessionBuilder`, `GroupCipher`) wrap libsignal's group APIs through the same native-op boundary used for 1:1 messaging. Native ops follow the established pattern: positional byte-array arguments, an ephemeral in-memory store seeded with the prior `SenderKeyRecord`, results carry back updated record bytes for the JS store to persist. One new store interface (`SenderKeyStore`) keyed by `(senderAddress, distributionId)`. SQLCipher schema bumps from v1 to v2 with a new `sender_keys` table. Library code unchanged on the 1:1 path.

**Tech Stack:**
- libsignal-client 0.94.4 (LibSignalClient on iOS, org.signal.libsignal on Android)
- Expo Modules API (Swift + Kotlin native, TypeScript JS)
- SQLCipher via op-sqlite (CommonCrypto backend on iOS, see `example/SMOKE_TEST_LOG.md`)
- Jest for TS-side unit tests
- Manual smoke test via example app (no native unit tests; native ops are exercised via the JS classes)

---

## File Structure

New files:
- `src/core/SenderKeyDistributionMessage.ts` — over-the-wire bootstrap message
- `src/core/SenderKeyRecord.ts` — persisted per-sender per-distribution-id state
- `src/core/GroupSessionBuilder.ts` — creates SKDMs, processes incoming SKDMs
- `src/core/GroupCipher.ts` — encrypts and decrypts group messages
- `ios/GroupOps.swift` — Swift wrappers for the four group ops
- `android/src/main/java/expo/modules/libsignal/GroupOps.kt` — Kotlin wrappers for the four group ops
- `example/src/screens/GroupsScreen.tsx` — 3-party (Alice/Bob/Carol) integration scenario
- `src/__tests__/GroupSessionBuilder.test.ts` — TS unit tests
- `src/__tests__/GroupCipher.test.ts` — TS unit tests
- `src/__tests__/SenderKeyDistributionMessage.test.ts` — TS unit tests

Modified files:
- `src/core/stores.ts` — add `SenderKeyStore` interface
- `src/stores/schema.ts` — add v2 migration creating `sender_keys` table; bump `SCHEMA_VERSION`
- `src/stores/SQLCipherProtocolStore.ts` — implement `SenderKeyStore` methods
- `src/ExpoLibsignalModule.ts` — declare new native methods on `NativeModule`
- `src/index.ts` — export new public classes
- `ios/ExpoLibsignalModule.swift` — register SharedObject classes and async ops for sender keys
- `android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt` — same registration on Android
- `example/App.tsx` — add Groups tab
- `example/SMOKE_TEST_LOG.md` — append a dated entry for the Phase 4 group-messaging run
- `README.md` — bump roadmap entry once verified
- `src/__tests__/schema.test.ts` — extend to assert v2 contents

---

## Task 1: Schema v2 and SenderKeyStore interface

**Why first:** Define the storage shape before any code touches it. Pure TS, jest-testable, no native dependency.

**Files:**
- Modify: `src/core/stores.ts`
- Modify: `src/stores/schema.ts`
- Test: `src/__tests__/schema.test.ts`

- [ ] **Step 1: Write the failing test extension for v2**

Add to `src/__tests__/schema.test.ts` after the existing v1 test:

```ts
  test('v2 creates the sender_keys table with a composite PK', () => {
    expect(SCHEMA_VERSION).toBe(2)
    const v2 = (MIGRATIONS[1] ?? []).join('\n')
    expect(v2).toContain('CREATE TABLE sender_keys')
    expect(v2).toContain('PRIMARY KEY (name, device_id, distribution_id)')
  })
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `bun run test src/__tests__/schema.test.ts`
Expected: `v2 creates the sender_keys table` FAILS because `SCHEMA_VERSION` is still 1 and `MIGRATIONS[1]` is undefined.

- [ ] **Step 3: Implement schema v2**

Edit `src/stores/schema.ts`:

```ts
export const SCHEMA_VERSION = 2
```

Add a second migration batch to the `MIGRATIONS` array:

```ts
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
```

- [ ] **Step 4: Add the SenderKeyStore interface**

Edit `src/core/stores.ts`. Add this at the bottom of the file:

```ts
export interface SenderKeyStore {
  /**
   * Load the SenderKeyRecord for (sender, distributionId), or null if none.
   * Called before encrypt/decrypt to feed the ratchet state into the native op.
   */
  loadSenderKey(sender: ProtocolAddress, distributionId: string): Promise<SenderKeyRecord | null>
  /**
   * Persist the SenderKeyRecord returned by the native op after every
   * createSenderKeyDistributionMessage / processSenderKeyDistributionMessage /
   * groupEncrypt / groupDecrypt call.
   */
  storeSenderKey(
    sender: ProtocolAddress,
    distributionId: string,
    record: SenderKeyRecord,
  ): Promise<void>
}
```

Add the import at the top:

```ts
import type { SenderKeyRecord } from './SenderKeyRecord'
```

This import will fail until Task 3 lands. That is expected — the interface lives here, the class lives there.

- [ ] **Step 5: Run the test to confirm it passes**

Run: `bun run test src/__tests__/schema.test.ts`
Expected: all four tests PASS (the SenderKeyRecord-import circular reference is a type-only import and does not affect runtime).

Also run: `bun run typecheck`
Expected: ERRORS, because `SenderKeyRecord` does not yet exist. That is OK — Task 2 introduces it. We will not commit until typecheck is clean.

- [ ] **Step 6: Defer commit**

Do NOT commit yet — typecheck is failing intentionally. Move to Task 2.

---

## Task 2: SenderKeyRecord TypeScript class

**Why next:** Unblocks the type import in `stores.ts` from Task 1.

**Files:**
- Create: `src/core/SenderKeyRecord.ts`

- [ ] **Step 1: Create `src/core/SenderKeyRecord.ts`**

```ts
import { NativeModule } from '../ExpoLibsignalModule'
import type { SenderKeyRecordRef } from '../ExpoLibsignal.types'

/**
 * Persisted ratchet state for one (sender, distributionId) pair. Opaque
 * libsignal blob; the JS side only serializes / deserializes through the
 * native module so it can be written to a SenderKeyStore.
 */
export class SenderKeyRecord {
  private readonly ref: SenderKeyRecordRef

  private constructor(ref: SenderKeyRecordRef) {
    this.ref = ref
  }

  static async deserialize(bytes: Uint8Array): Promise<SenderKeyRecord> {
    const ref = await NativeModule.deserializeSenderKeyRecord(bytes)
    return new SenderKeyRecord(ref)
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: still failing — `SenderKeyRecordRef` and `NativeModule.deserializeSenderKeyRecord` do not exist yet. Move to Task 3.

---

## Task 3: SenderKeyDistributionMessage TypeScript class

**Why grouped with Task 2:** Same pattern, both consumed by the builder in Task 5.

**Files:**
- Create: `src/core/SenderKeyDistributionMessage.ts`
- Test: `src/__tests__/SenderKeyDistributionMessage.test.ts`

- [ ] **Step 1: Create `src/core/SenderKeyDistributionMessage.ts`**

```ts
import { NativeModule } from '../ExpoLibsignalModule'
import type { SenderKeyDistributionMessageRef } from '../ExpoLibsignal.types'

/**
 * Over-the-wire bootstrap that lets a recipient set up the shared sender key
 * for one (sender, distributionId) pair. The sender produces one via
 * GroupSessionBuilder.createSenderKeyDistributionMessage and ships it to each
 * group member, typically wrapped in the existing 1:1 Signal session.
 */
export class SenderKeyDistributionMessage {
  private readonly ref: SenderKeyDistributionMessageRef

  private constructor(ref: SenderKeyDistributionMessageRef) {
    this.ref = ref
  }

  static async deserialize(bytes: Uint8Array): Promise<SenderKeyDistributionMessage> {
    const ref = await NativeModule.deserializeSenderKeyDistributionMessage(bytes)
    return new SenderKeyDistributionMessage(ref)
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }

  distributionId(): string {
    return this.ref.distributionId()
  }

  chainId(): number {
    return this.ref.chainId()
  }

  iteration(): number {
    return this.ref.iteration()
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `src/__tests__/SenderKeyDistributionMessage.test.ts`:

```ts
import { SenderKeyDistributionMessage } from '../core/SenderKeyDistributionMessage'

jest.mock('../ExpoLibsignalModule', () => {
  const skdmBytes = new Uint8Array([0x33, 0x33, 0x33])
  const ref = {
    serialize: () => skdmBytes,
    distributionId: () => 'aaaa-1111-2222-3333-444444444444',
    chainId: () => 7,
    iteration: () => 0,
  }
  return {
    NativeModule: {
      deserializeSenderKeyDistributionMessage: jest.fn(async () => ref),
    },
  }
})

describe('SenderKeyDistributionMessage', () => {
  test('deserialize then serialize round-trips through the ref', async () => {
    const msg = await SenderKeyDistributionMessage.deserialize(new Uint8Array([0x33, 0x33, 0x33]))
    expect(msg.serialize()).toEqual(new Uint8Array([0x33, 0x33, 0x33]))
    expect(msg.distributionId()).toBe('aaaa-1111-2222-3333-444444444444')
    expect(msg.chainId()).toBe(7)
    expect(msg.iteration()).toBe(0)
  })
})
```

- [ ] **Step 3: Run the test to confirm it passes once typecheck recovers**

Cannot run yet — `SenderKeyDistributionMessageRef` is not defined in `ExpoLibsignal.types`. Move to Task 4.

---

## Task 4: TypeScript module surface for new refs

**Why:** Closes the type loop so Tasks 1-3 typecheck clean.

**Files:**
- Modify: `src/ExpoLibsignal.types.ts`
- Modify: `src/ExpoLibsignalModule.ts`

- [ ] **Step 1: Add the new ref types**

Read `src/ExpoLibsignal.types.ts` to find where the existing `*Ref` types are declared (look for `PreKeySignalMessageRef`). Below the last existing ref type, add:

```ts
export type SenderKeyRecordRef = {
  serialize(): Uint8Array
}

export type SenderKeyDistributionMessageRef = {
  serialize(): Uint8Array
  distributionId(): string
  chainId(): number
  iteration(): number
}
```

- [ ] **Step 2: Declare the native methods on NativeModule**

Read `src/ExpoLibsignalModule.ts`. Find the `NativeModule` declaration and the existing typed methods (look for `deserializePreKeySignalMessage`). In the same module surface, add:

```ts
  deserializeSenderKeyRecord(bytes: Uint8Array): Promise<SenderKeyRecordRef>
  deserializeSenderKeyDistributionMessage(
    bytes: Uint8Array,
  ): Promise<SenderKeyDistributionMessageRef>

  createSenderKeyDistributionOp(
    config: SenderKeyOpConfig,
    distributionId: string,
    existingRecord: Uint8Array | null,
  ): Promise<{ message: Uint8Array; newRecord: Uint8Array }>

  processSenderKeyDistributionOp(
    config: SenderKeyOpConfig,
    distributionId: string,
    message: Uint8Array,
    existingRecord: Uint8Array | null,
  ): Promise<{ newRecord: Uint8Array }>

  groupEncryptOp(
    config: SenderKeyOpConfig,
    distributionId: string,
    plaintext: Uint8Array,
    existingRecord: Uint8Array,
  ): Promise<{ ciphertext: Uint8Array; newRecord: Uint8Array }>

  groupDecryptOp(
    config: SenderKeyOpConfig,
    ciphertext: Uint8Array,
    existingRecord: Uint8Array,
  ): Promise<{ plaintext: Uint8Array; newRecord: Uint8Array }>
```

Define `SenderKeyOpConfig` alongside the existing `SessionOpConfig` type (or wherever opConfig types live in this file):

```ts
export type SenderKeyOpConfig = {
  senderName: string
  senderDeviceId: number
  nowMs: number
}
```

Add imports as needed:

```ts
import type {
  SenderKeyDistributionMessageRef,
  SenderKeyRecordRef,
} from './ExpoLibsignal.types'
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASSES (Tasks 1-3 + Task 4 close the type loop on the JS side; the native methods do not yet exist at runtime but TypeScript only checks the type declarations).

- [ ] **Step 4: Run the SenderKeyDistributionMessage test**

Run: `bun run test src/__tests__/SenderKeyDistributionMessage.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the schema test**

Run: `bun run test src/__tests__/schema.test.ts`
Expected: all four tests PASS.

- [ ] **Step 6: Commit the TS-only foundation**

```bash
git add src/core/stores.ts src/core/SenderKeyRecord.ts src/core/SenderKeyDistributionMessage.ts \
  src/ExpoLibsignal.types.ts src/ExpoLibsignalModule.ts \
  src/stores/schema.ts src/__tests__/schema.test.ts src/__tests__/SenderKeyDistributionMessage.test.ts
git commit -m "feat(ts): SenderKeyStore interface, SenderKey* classes, schema v2"
```

---

## Task 5: iOS native — SenderKey SharedObject classes and deserialize functions

**Files:**
- Modify: `ios/ExpoLibsignalModule.swift`
- Create: `ios/SenderKeyRefs.swift`

- [ ] **Step 1: Create `ios/SenderKeyRefs.swift`**

```swift
import Foundation
import ExpoModulesCore
import LibSignalClient

final class SenderKeyRecordRef: SharedObject {
  let record: SenderKeyRecord
  init(record: SenderKeyRecord) {
    self.record = record
  }
}

final class SenderKeyDistributionMessageRef: SharedObject {
  let message: SenderKeyDistributionMessage
  init(message: SenderKeyDistributionMessage) {
    self.message = message
  }
}
```

- [ ] **Step 2: Register the SharedObject classes on the module**

Edit `ios/ExpoLibsignalModule.swift`. Right after the existing `Class(PreKeySignalMessageRef.self) { ... }` block, add:

```swift
    AsyncFunction("deserializeSenderKeyRecord") { (bytes: Data) -> SenderKeyRecordRef in
      do {
        let record = try SenderKeyRecord(bytes: bytes)
        return SenderKeyRecordRef(record: record)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(SenderKeyRecordRef.self) {
      Function("serialize") { (ref: SenderKeyRecordRef) -> Data in ref.record.serialize() }
    }

    AsyncFunction("deserializeSenderKeyDistributionMessage") { (bytes: Data) -> SenderKeyDistributionMessageRef in
      do {
        let msg = try SenderKeyDistributionMessage(bytes: bytes)
        return SenderKeyDistributionMessageRef(message: msg)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(SenderKeyDistributionMessageRef.self) {
      Function("serialize") { (ref: SenderKeyDistributionMessageRef) -> Data in ref.message.serialize() }
      Function("distributionId") { (ref: SenderKeyDistributionMessageRef) -> String in
        return ref.message.distributionId.uuidString
      }
      Function("chainId") { (ref: SenderKeyDistributionMessageRef) -> UInt32 in
        return ref.message.chainId
      }
      Function("iteration") { (ref: SenderKeyDistributionMessageRef) -> UInt32 in
        return ref.message.iteration
      }
    }
```

- [ ] **Step 3: Build iOS to confirm compile**

Run: `cd example/ios && xcodebuild -workspace expolibsignalexample.xcworkspace -scheme expolibsignalexample -sdk iphonesimulator -configuration Debug -destination 'platform=iOS Simulator,id=5105FFD8-CC6E-443C-8791-99D70A8B900D' build 2>&1 | tail -20`
Expected: BUILD SUCCEEDED.

---

## Task 6: iOS native — group ops

**Files:**
- Create: `ios/GroupOps.swift`
- Modify: `ios/ExpoLibsignalModule.swift`

- [ ] **Step 1: Create `ios/GroupOps.swift`**

```swift
import Foundation
import ExpoModulesCore
import LibSignalClient

struct SenderKeyOpConfig: Record {
  @Field var senderName: String = ""
  @Field var senderDeviceId: UInt32 = 0
  @Field var nowMs: Double = 0
}

struct CreateSenderKeyDistributionResult: Record {
  @Field var message: Data = Data()
  @Field var newRecord: Data = Data()
}

struct ProcessSenderKeyDistributionResult: Record {
  @Field var newRecord: Data = Data()
}

struct GroupEncryptResult: Record {
  @Field var ciphertext: Data = Data()
  @Field var newRecord: Data = Data()
}

struct GroupDecryptResult: Record {
  @Field var plaintext: Data = Data()
  @Field var newRecord: Data = Data()
}

// Captures the post-op SenderKeyRecord for (sender, distributionId). libsignal
// stores after createSKDM / processSKDM / groupEncrypt / groupDecrypt; this
// wrapper reads it back so the JS layer can persist it to the real store.
private final class CapturingSenderKeyStore: SenderKeyStore {
  private var records: [String: SenderKeyRecord] = [:]
  private static func key(_ sender: ProtocolAddress, _ id: UUID) -> String {
    return "\(sender.name).\(sender.deviceId).\(id.uuidString)"
  }
  func storeSenderKey(from sender: ProtocolAddress, distributionId: UUID, record: SenderKeyRecord, context: StoreContext) throws {
    records[Self.key(sender, distributionId)] = record
  }
  func loadSenderKey(from sender: ProtocolAddress, distributionId: UUID, context: StoreContext) throws -> SenderKeyRecord? {
    return records[Self.key(sender, distributionId)]
  }
  func captured(_ sender: ProtocolAddress, _ id: UUID) -> SenderKeyRecord? {
    return records[Self.key(sender, distributionId: id)]
  }
}

private func makeStore(senderAddress: ProtocolAddress, distributionId: UUID, existingRecord: Data?) throws -> CapturingSenderKeyStore {
  let store = CapturingSenderKeyStore()
  if let bytes = existingRecord {
    let record = try SenderKeyRecord(bytes: bytes)
    try store.storeSenderKey(from: senderAddress, distributionId: distributionId, record: record, context: NullContext())
  }
  return store
}

private func uuidOrThrow(_ s: String) throws -> UUID {
  guard let id = UUID(uuidString: s) else {
    throw Exception(name: "LibsignalError", description: "invalid distributionId \(s)")
  }
  return id
}

private func senderAddress(_ config: SenderKeyOpConfig) throws -> ProtocolAddress {
  return try ProtocolAddress(name: config.senderName, deviceId: config.senderDeviceId)
}

private func loadNewRecord(_ store: CapturingSenderKeyStore, _ sender: ProtocolAddress, _ id: UUID) throws -> Data {
  guard let rec = try store.loadSenderKey(from: sender, distributionId: id, context: NullContext()) else {
    throw Exception(name: "LibsignalError", description: "expected store to contain a new SenderKeyRecord after op")
  }
  return rec.serialize()
}

func runCreateSenderKeyDistributionOp(
  config: SenderKeyOpConfig,
  distributionId: String,
  existingRecord: Data?
) throws -> CreateSenderKeyDistributionResult {
  let id = try uuidOrThrow(distributionId)
  let sender = try senderAddress(config)
  let store = try makeStore(senderAddress: sender, distributionId: id, existingRecord: existingRecord)
  let skdm = try SenderKeyDistributionMessage(from: sender, distributionId: id, store: store, context: NullContext())
  var result = CreateSenderKeyDistributionResult()
  result.message = skdm.serialize()
  result.newRecord = try loadNewRecord(store, sender, id)
  return result
}

func runProcessSenderKeyDistributionOp(
  config: SenderKeyOpConfig,
  distributionId: String,
  message: Data,
  existingRecord: Data?
) throws -> ProcessSenderKeyDistributionResult {
  let id = try uuidOrThrow(distributionId)
  let sender = try senderAddress(config)
  let store = try makeStore(senderAddress: sender, distributionId: id, existingRecord: existingRecord)
  let skdm = try SenderKeyDistributionMessage(bytes: message)
  try processSenderKeyDistributionMessage(skdm, from: sender, store: store, context: NullContext())
  var result = ProcessSenderKeyDistributionResult()
  result.newRecord = try loadNewRecord(store, sender, id)
  return result
}

func runGroupEncryptOp(
  config: SenderKeyOpConfig,
  distributionId: String,
  plaintext: Data,
  existingRecord: Data
) throws -> GroupEncryptResult {
  let id = try uuidOrThrow(distributionId)
  let sender = try senderAddress(config)
  let store = try makeStore(senderAddress: sender, distributionId: id, existingRecord: existingRecord)
  let ciphertext = try groupEncrypt(plaintext, from: sender, distributionId: id, store: store, context: NullContext())
  var result = GroupEncryptResult()
  result.ciphertext = Data(ciphertext.serialize())
  result.newRecord = try loadNewRecord(store, sender, id)
  return result
}

func runGroupDecryptOp(
  config: SenderKeyOpConfig,
  ciphertext: Data,
  existingRecord: Data
) throws -> GroupDecryptResult {
  // distributionId is on the ciphertext, not the config — the in-memory store
  // is keyed by (sender, distributionId) and the existing record was looked up
  // by the JS layer from the same SenderKeyMessage, so we re-derive the id.
  let parsed = try SenderKeyMessage(bytes: ciphertext)
  let sender = try senderAddress(config)
  let id = try uuidOrThrow(parsed.distributionId.uuidString)
  let store = try makeStore(senderAddress: sender, distributionId: id, existingRecord: existingRecord)
  let plaintext = try groupDecrypt(ciphertext, from: sender, store: store, context: NullContext())
  var result = GroupDecryptResult()
  result.plaintext = Data(plaintext)
  result.newRecord = try loadNewRecord(store, sender, id)
  return result
}
```

- [ ] **Step 2: Register the ops on the module**

In `ios/ExpoLibsignalModule.swift`, after `decryptSignalOp`, add:

```swift
    AsyncFunction("createSenderKeyDistributionOp") { (config: SenderKeyOpConfig, distributionId: String, existingRecord: Data?) -> CreateSenderKeyDistributionResult in
      do {
        return try runCreateSenderKeyDistributionOp(config: config, distributionId: distributionId, existingRecord: existingRecord)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("processSenderKeyDistributionOp") { (config: SenderKeyOpConfig, distributionId: String, message: Data, existingRecord: Data?) -> ProcessSenderKeyDistributionResult in
      do {
        return try runProcessSenderKeyDistributionOp(config: config, distributionId: distributionId, message: message, existingRecord: existingRecord)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("groupEncryptOp") { (config: SenderKeyOpConfig, distributionId: String, plaintext: Data, existingRecord: Data) -> GroupEncryptResult in
      do {
        return try runGroupEncryptOp(config: config, distributionId: distributionId, plaintext: plaintext, existingRecord: existingRecord)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("groupDecryptOp") { (config: SenderKeyOpConfig, ciphertext: Data, existingRecord: Data) -> GroupDecryptResult in
      do {
        return try runGroupDecryptOp(config: config, ciphertext: ciphertext, existingRecord: existingRecord)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }
```

- [ ] **Step 3: Build iOS**

Run: `cd example/ios && xcodebuild -workspace expolibsignalexample.xcworkspace -scheme expolibsignalexample -sdk iphonesimulator -configuration Debug -destination 'platform=iOS Simulator,id=5105FFD8-CC6E-443C-8791-99D70A8B900D' build 2>&1 | tail -20`
Expected: BUILD SUCCEEDED.

---

## Task 7: Android native — SenderKey SharedObject classes and deserialize functions

**Files:**
- Create: `android/src/main/java/expo/modules/libsignal/SenderKeyRefs.kt`
- Modify: `android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt`

- [ ] **Step 1: Create `android/src/main/java/expo/modules/libsignal/SenderKeyRefs.kt`**

```kotlin
package expo.modules.libsignal

import expo.modules.kotlin.sharedobjects.SharedObject
import org.signal.libsignal.protocol.groups.state.SenderKeyRecord
import org.signal.libsignal.protocol.message.SenderKeyDistributionMessage

class SenderKeyRecordRef(val record: SenderKeyRecord) : SharedObject()

class SenderKeyDistributionMessageRef(val message: SenderKeyDistributionMessage) : SharedObject()
```

- [ ] **Step 2: Register on the module**

Edit `android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt`. After the existing `Class(PreKeySignalMessageRef::class)` block, add:

```kotlin
    AsyncFunction("deserializeSenderKeyRecord") { bytes: ByteArray ->
      try {
        SenderKeyRecordRef(SenderKeyRecord(bytes))
      } catch (e: Throwable) {
        throw CodedException("LibsignalError", e.message, e)
      }
    }

    Class(SenderKeyRecordRef::class) {
      Function("serialize") { ref: SenderKeyRecordRef -> ref.record.serialize() }
    }

    AsyncFunction("deserializeSenderKeyDistributionMessage") { bytes: ByteArray ->
      try {
        SenderKeyDistributionMessageRef(SenderKeyDistributionMessage(bytes))
      } catch (e: Throwable) {
        throw CodedException("LibsignalError", e.message, e)
      }
    }

    Class(SenderKeyDistributionMessageRef::class) {
      Function("serialize") { ref: SenderKeyDistributionMessageRef -> ref.message.serialize() }
      Function("distributionId") { ref: SenderKeyDistributionMessageRef -> ref.message.distributionId.toString() }
      Function("chainId") { ref: SenderKeyDistributionMessageRef -> ref.message.chainId }
      Function("iteration") { ref: SenderKeyDistributionMessageRef -> ref.message.iteration }
    }
```

Match the surrounding error-handling style — if other deserialize functions use a different pattern (e.g. plain `throw RuntimeException`), use the same here.

- [ ] **Step 3: Build Android**

Run: `cd example/android && ./gradlew :app:assembleDebug 2>&1 | tail -10`
Expected: BUILD SUCCESSFUL.

---

## Task 8: Android native — group ops

**Files:**
- Create: `android/src/main/java/expo/modules/libsignal/GroupOps.kt`
- Modify: `android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt`

- [ ] **Step 1: Create `android/src/main/java/expo/modules/libsignal/GroupOps.kt`**

```kotlin
package expo.modules.libsignal

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.UUID
import org.signal.libsignal.protocol.SignalProtocolAddress
import org.signal.libsignal.protocol.groups.GroupCipher
import org.signal.libsignal.protocol.groups.GroupSessionBuilder
import org.signal.libsignal.protocol.groups.state.SenderKeyRecord
import org.signal.libsignal.protocol.groups.state.SenderKeyStore
import org.signal.libsignal.protocol.message.SenderKeyDistributionMessage
import org.signal.libsignal.protocol.message.SenderKeyMessage

class SenderKeyOpConfig : Record {
  @Field var senderName: String = ""
  @Field var senderDeviceId: Int = 0
  @Field var nowMs: Double = 0.0
}

class CreateSenderKeyDistributionResult : Record {
  @Field var message: ByteArray = ByteArray(0)
  @Field var newRecord: ByteArray = ByteArray(0)
}

class ProcessSenderKeyDistributionResult : Record {
  @Field var newRecord: ByteArray = ByteArray(0)
}

class GroupEncryptResult : Record {
  @Field var ciphertext: ByteArray = ByteArray(0)
  @Field var newRecord: ByteArray = ByteArray(0)
}

class GroupDecryptResult : Record {
  @Field var plaintext: ByteArray = ByteArray(0)
  @Field var newRecord: ByteArray = ByteArray(0)
}

private class CapturingSenderKeyStore : SenderKeyStore {
  private val records = mutableMapOf<String, SenderKeyRecord>()
  private fun key(sender: SignalProtocolAddress, id: UUID) = "${sender.name}.${sender.deviceId}.$id"
  override fun storeSenderKey(sender: SignalProtocolAddress, distributionId: UUID, record: SenderKeyRecord) {
    records[key(sender, distributionId)] = record
  }
  override fun loadSenderKey(sender: SignalProtocolAddress, distributionId: UUID): SenderKeyRecord? {
    return records[key(sender, distributionId)]
  }
}

private fun makeStore(sender: SignalProtocolAddress, id: UUID, existing: ByteArray?): CapturingSenderKeyStore {
  val store = CapturingSenderKeyStore()
  if (existing != null) {
    store.storeSenderKey(sender, id, SenderKeyRecord(existing))
  }
  return store
}

private fun senderAddress(config: SenderKeyOpConfig) =
  SignalProtocolAddress(config.senderName, config.senderDeviceId)

private fun loadNewRecord(store: CapturingSenderKeyStore, sender: SignalProtocolAddress, id: UUID): ByteArray {
  val rec = store.loadSenderKey(sender, id)
    ?: throw IllegalStateException("expected store to contain a new SenderKeyRecord after op")
  return rec.serialize()
}

internal fun runCreateSenderKeyDistributionOp(
  config: SenderKeyOpConfig,
  distributionId: String,
  existingRecord: ByteArray?,
): CreateSenderKeyDistributionResult {
  val id = UUID.fromString(distributionId)
  val sender = senderAddress(config)
  val store = makeStore(sender, id, existingRecord)
  val builder = GroupSessionBuilder(store)
  val skdm = builder.create(sender, id)
  val result = CreateSenderKeyDistributionResult()
  result.message = skdm.serialize()
  result.newRecord = loadNewRecord(store, sender, id)
  return result
}

internal fun runProcessSenderKeyDistributionOp(
  config: SenderKeyOpConfig,
  distributionId: String,
  message: ByteArray,
  existingRecord: ByteArray?,
): ProcessSenderKeyDistributionResult {
  val id = UUID.fromString(distributionId)
  val sender = senderAddress(config)
  val store = makeStore(sender, id, existingRecord)
  val builder = GroupSessionBuilder(store)
  val skdm = SenderKeyDistributionMessage(message)
  builder.process(sender, skdm)
  val result = ProcessSenderKeyDistributionResult()
  result.newRecord = loadNewRecord(store, sender, id)
  return result
}

internal fun runGroupEncryptOp(
  config: SenderKeyOpConfig,
  distributionId: String,
  plaintext: ByteArray,
  existingRecord: ByteArray,
): GroupEncryptResult {
  val id = UUID.fromString(distributionId)
  val sender = senderAddress(config)
  val store = makeStore(sender, id, existingRecord)
  val cipher = GroupCipher(store, sender)
  val ciphertext = cipher.encrypt(id, plaintext)
  val result = GroupEncryptResult()
  result.ciphertext = ciphertext.serialize()
  result.newRecord = loadNewRecord(store, sender, id)
  return result
}

internal fun runGroupDecryptOp(
  config: SenderKeyOpConfig,
  ciphertext: ByteArray,
  existingRecord: ByteArray,
): GroupDecryptResult {
  val parsed = SenderKeyMessage(ciphertext)
  val sender = senderAddress(config)
  val id = parsed.distributionId
  val store = makeStore(sender, id, existingRecord)
  val cipher = GroupCipher(store, sender)
  val plaintext = cipher.decrypt(parsed)
  val result = GroupDecryptResult()
  result.plaintext = plaintext
  result.newRecord = loadNewRecord(store, sender, id)
  return result
}
```

If `SenderKeyMessage#getDistributionId` differs in the installed Java libsignal API (e.g. method-of-the-message vs property), match what the upstream version exposes. The pattern is: parse the ciphertext, ask it for the distribution UUID, key the store by it.

- [ ] **Step 2: Register the four ops on the module**

Edit `android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt`. After the existing `decryptSignalOp` registration, add the four parallel `AsyncFunction` blocks following the same pattern as the iOS side. (Mirror the pattern used for `encryptOp` etc. in the same file — the Kotlin syntax is slightly different from Swift.)

- [ ] **Step 3: Build Android**

Run: `cd example/android && ./gradlew :app:assembleDebug 2>&1 | tail -10`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: Commit the native layer**

```bash
git add ios/ android/
git commit -m "feat(native): SenderKey refs and group ops on iOS and Android"
```

---

## Task 9: TS GroupSessionBuilder

**Files:**
- Create: `src/core/GroupSessionBuilder.ts`
- Test: `src/__tests__/GroupSessionBuilder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/GroupSessionBuilder.test.ts`:

```ts
import { GroupSessionBuilder } from '../core/GroupSessionBuilder'
import { ProtocolAddress } from '../core/ProtocolAddress'
import { SenderKeyRecord } from '../core/SenderKeyRecord'
import { SenderKeyDistributionMessage } from '../core/SenderKeyDistributionMessage'

const DISTRIBUTION_ID = '11111111-2222-3333-4444-555555555555'

const skdmBytes = new Uint8Array([0x77, 0x77])
const recordBytes = new Uint8Array([0x55, 0x55])

jest.mock('../ExpoLibsignalModule', () => ({
  NativeModule: {
    createSenderKeyDistributionOp: jest.fn(async () => ({
      message: skdmBytes,
      newRecord: recordBytes,
    })),
    processSenderKeyDistributionOp: jest.fn(async () => ({
      newRecord: recordBytes,
    })),
    deserializeSenderKeyDistributionMessage: jest.fn(async () => ({
      serialize: () => skdmBytes,
      distributionId: () => DISTRIBUTION_ID,
      chainId: () => 0,
      iteration: () => 0,
    })),
    deserializeSenderKeyRecord: jest.fn(async () => ({
      serialize: () => recordBytes,
    })),
    createProtocolAddress: jest.fn(async (name: string, deviceId: number) => ({
      name: () => name,
      deviceId: () => deviceId,
    })),
  },
}))

describe('GroupSessionBuilder', () => {
  test('createSenderKeyDistributionMessage stores the new record and returns the SKDM', async () => {
    const calls: Array<{ name: string; deviceId: number; id: string }> = []
    const stored: Array<{ name: string; deviceId: number; id: string; bytes: Uint8Array }> = []
    const store = {
      loadSenderKey: jest.fn(async (addr, id) => {
        calls.push({ name: addr.name(), deviceId: addr.deviceId(), id })
        return null
      }),
      storeSenderKey: jest.fn(async (addr, id, rec) => {
        stored.push({ name: addr.name(), deviceId: addr.deviceId(), id, bytes: rec.serialize() })
      }),
    }
    const builder = new GroupSessionBuilder(store)
    const sender = await ProtocolAddress.create('alice', 1)
    const message = await builder.createSenderKeyDistributionMessage(sender, DISTRIBUTION_ID)
    expect(message).toBeInstanceOf(SenderKeyDistributionMessage)
    expect(message.distributionId()).toBe(DISTRIBUTION_ID)
    expect(calls).toEqual([{ name: 'alice', deviceId: 1, id: DISTRIBUTION_ID }])
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ name: 'alice', deviceId: 1, id: DISTRIBUTION_ID })
  })

  test('processSenderKeyDistributionMessage stores the new record', async () => {
    const stored: Array<{ name: string; id: string }> = []
    const store = {
      loadSenderKey: jest.fn(async () => null),
      storeSenderKey: jest.fn(async (addr, id) => {
        stored.push({ name: addr.name(), id })
      }),
    }
    const builder = new GroupSessionBuilder(store)
    const sender = await ProtocolAddress.create('bob', 2)
    const message = await SenderKeyDistributionMessage.deserialize(skdmBytes)
    await builder.processSenderKeyDistributionMessage(sender, message)
    expect(stored).toEqual([{ name: 'bob', id: DISTRIBUTION_ID }])
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `bun run test src/__tests__/GroupSessionBuilder.test.ts`
Expected: FAIL — `GroupSessionBuilder` does not exist.

- [ ] **Step 3: Implement `src/core/GroupSessionBuilder.ts`**

```ts
import { NativeModule } from '../ExpoLibsignalModule'
import type { ProtocolAddress } from './ProtocolAddress'
import { SenderKeyDistributionMessage } from './SenderKeyDistributionMessage'
import { SenderKeyRecord } from './SenderKeyRecord'
import type { SenderKeyStore } from './stores'

export class GroupSessionBuilder {
  private readonly store: SenderKeyStore

  constructor(store: SenderKeyStore) {
    this.store = store
  }

  async createSenderKeyDistributionMessage(
    sender: ProtocolAddress,
    distributionId: string,
  ): Promise<SenderKeyDistributionMessage> {
    const existing = await this.store.loadSenderKey(sender, distributionId)
    const result = await NativeModule.createSenderKeyDistributionOp(
      { senderName: sender.name(), senderDeviceId: sender.deviceId(), nowMs: Date.now() },
      distributionId,
      existing ? existing.serialize() : null,
    )
    const newRecord = await SenderKeyRecord.deserialize(result.newRecord)
    await this.store.storeSenderKey(sender, distributionId, newRecord)
    return SenderKeyDistributionMessage.deserialize(result.message)
  }

  async processSenderKeyDistributionMessage(
    sender: ProtocolAddress,
    message: SenderKeyDistributionMessage,
  ): Promise<void> {
    const distributionId = message.distributionId()
    const existing = await this.store.loadSenderKey(sender, distributionId)
    const result = await NativeModule.processSenderKeyDistributionOp(
      { senderName: sender.name(), senderDeviceId: sender.deviceId(), nowMs: Date.now() },
      distributionId,
      message.serialize(),
      existing ? existing.serialize() : null,
    )
    const newRecord = await SenderKeyRecord.deserialize(result.newRecord)
    await this.store.storeSenderKey(sender, distributionId, newRecord)
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `bun run test src/__tests__/GroupSessionBuilder.test.ts`
Expected: PASS.

---

## Task 10: TS GroupCipher

**Files:**
- Create: `src/core/GroupCipher.ts`
- Test: `src/__tests__/GroupCipher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/GroupCipher.test.ts`:

```ts
import { GroupCipher } from '../core/GroupCipher'
import { ProtocolAddress } from '../core/ProtocolAddress'
import { SenderKeyRecord } from '../core/SenderKeyRecord'

const DISTRIBUTION_ID = '11111111-2222-3333-4444-555555555555'

const recordBytes = new Uint8Array([0x55, 0x55])
const ciphertextBytes = new Uint8Array([0x99])
const plaintextBytes = new Uint8Array([0x68, 0x69])  // "hi"

jest.mock('../ExpoLibsignalModule', () => ({
  NativeModule: {
    groupEncryptOp: jest.fn(async () => ({ ciphertext: ciphertextBytes, newRecord: recordBytes })),
    groupDecryptOp: jest.fn(async () => ({ plaintext: plaintextBytes, newRecord: recordBytes })),
    deserializeSenderKeyRecord: jest.fn(async () => ({ serialize: () => recordBytes })),
    createProtocolAddress: jest.fn(async (name: string, deviceId: number) => ({
      name: () => name,
      deviceId: () => deviceId,
    })),
  },
}))

describe('GroupCipher', () => {
  test('encrypt looks up the record, calls native, stores the rotated record', async () => {
    const stored: Array<{ name: string; id: string }> = []
    const store = {
      loadSenderKey: jest.fn(async () => SenderKeyRecord.deserialize(recordBytes)),
      storeSenderKey: jest.fn(async (addr, id) => stored.push({ name: addr.name(), id })),
    }
    const sender = await ProtocolAddress.create('alice', 1)
    const cipher = new GroupCipher(store, sender)
    const out = await cipher.encrypt(DISTRIBUTION_ID, new Uint8Array([0x68, 0x69]))
    expect(out).toEqual(ciphertextBytes)
    expect(stored).toEqual([{ name: 'alice', id: DISTRIBUTION_ID }])
  })

  test('encrypt throws if no record is in the store', async () => {
    const store = {
      loadSenderKey: jest.fn(async () => null),
      storeSenderKey: jest.fn(),
    }
    const sender = await ProtocolAddress.create('alice', 1)
    const cipher = new GroupCipher(store, sender)
    await expect(cipher.encrypt(DISTRIBUTION_ID, new Uint8Array())).rejects.toThrow(/no sender key/i)
  })

  test('decrypt looks up by sender, calls native, stores the rotated record', async () => {
    const stored: Array<{ name: string }> = []
    const store = {
      loadSenderKey: jest.fn(async () => SenderKeyRecord.deserialize(recordBytes)),
      storeSenderKey: jest.fn(async (addr) => stored.push({ name: addr.name() })),
    }
    const sender = await ProtocolAddress.create('bob', 1)
    const cipher = new GroupCipher(store, sender)
    const out = await cipher.decrypt(DISTRIBUTION_ID, ciphertextBytes)
    expect(out).toEqual(plaintextBytes)
    expect(stored).toEqual([{ name: 'bob' }])
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `bun run test src/__tests__/GroupCipher.test.ts`
Expected: FAIL — `GroupCipher` does not exist.

- [ ] **Step 3: Implement `src/core/GroupCipher.ts`**

```ts
import { NativeModule } from '../ExpoLibsignalModule'
import { SenderKeyNotFoundError } from '../errors'
import type { ProtocolAddress } from './ProtocolAddress'
import { SenderKeyRecord } from './SenderKeyRecord'
import type { SenderKeyStore } from './stores'

export class GroupCipher {
  private readonly store: SenderKeyStore
  private readonly sender: ProtocolAddress

  constructor(store: SenderKeyStore, sender: ProtocolAddress) {
    this.store = store
    this.sender = sender
  }

  async encrypt(distributionId: string, plaintext: Uint8Array): Promise<Uint8Array> {
    const existing = await this.store.loadSenderKey(this.sender, distributionId)
    if (existing === null) {
      throw new SenderKeyNotFoundError(
        `no sender key for ${this.sender.name()}.${this.sender.deviceId()} distribution=${distributionId}`,
      )
    }
    const result = await NativeModule.groupEncryptOp(
      { senderName: this.sender.name(), senderDeviceId: this.sender.deviceId(), nowMs: Date.now() },
      distributionId,
      plaintext,
      existing.serialize(),
    )
    const newRecord = await SenderKeyRecord.deserialize(result.newRecord)
    await this.store.storeSenderKey(this.sender, distributionId, newRecord)
    return result.ciphertext
  }

  async decrypt(distributionId: string, ciphertext: Uint8Array): Promise<Uint8Array> {
    const existing = await this.store.loadSenderKey(this.sender, distributionId)
    if (existing === null) {
      throw new SenderKeyNotFoundError(
        `no sender key for ${this.sender.name()}.${this.sender.deviceId()} distribution=${distributionId}`,
      )
    }
    const result = await NativeModule.groupDecryptOp(
      { senderName: this.sender.name(), senderDeviceId: this.sender.deviceId(), nowMs: Date.now() },
      ciphertext,
      existing.serialize(),
    )
    const newRecord = await SenderKeyRecord.deserialize(result.newRecord)
    await this.store.storeSenderKey(this.sender, distributionId, newRecord)
    return result.plaintext
  }
}
```

- [ ] **Step 4: Add `SenderKeyNotFoundError` to `src/errors.ts`**

Read the existing error classes in `src/errors.ts`. Add a new typed error following the same pattern as `SessionNotFoundError`:

```ts
export class SenderKeyNotFoundError extends LibsignalError {
  constructor(message: string) {
    super(message)
    this.name = 'SenderKeyNotFoundError'
  }
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `bun run test src/__tests__/GroupCipher.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit the JS classes**

```bash
git add src/core/GroupSessionBuilder.ts src/core/GroupCipher.ts \
  src/__tests__/GroupSessionBuilder.test.ts src/__tests__/GroupCipher.test.ts \
  src/errors.ts
git commit -m "feat(ts): GroupSessionBuilder and GroupCipher backed by SenderKeyStore"
```

---

## Task 11: SQLCipherProtocolStore implements SenderKeyStore

**Files:**
- Modify: `src/stores/SQLCipherProtocolStore.ts`

- [ ] **Step 1: Add the new methods**

Inside the class body of `SQLCipherProtocolStore`, after the existing `markKyberPreKeyUsed` method, add:

```ts
  // SenderKeyStore

  async loadSenderKey(
    sender: ProtocolAddress,
    distributionId: string,
  ): Promise<SenderKeyRecord | null> {
    const res = await this.db.execute(
      'SELECT record FROM sender_keys WHERE name = ? AND device_id = ? AND distribution_id = ?',
      [sender.name(), sender.deviceId(), distributionId],
    )
    const row = res.rows[0]
    if (row === undefined) return null
    return SenderKeyRecord.deserialize(toBytes(row.record))
  }

  async storeSenderKey(
    sender: ProtocolAddress,
    distributionId: string,
    record: SenderKeyRecord,
  ): Promise<void> {
    await this.db.execute(
      'INSERT INTO sender_keys (name, device_id, distribution_id, record, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT(name, device_id, distribution_id) DO UPDATE SET record = excluded.record, updated_at = excluded.updated_at',
      [sender.name(), sender.deviceId(), distributionId, record.serialize(), Date.now()],
    )
  }
```

Add the imports / declared-interface tags:

```ts
import { SenderKeyRecord } from '../core/SenderKeyRecord'
import type { SenderKeyStore } from '../core/stores'
```

And extend the class signature:

```ts
export class SQLCipherProtocolStore
  implements
    SessionStore,
    IdentityKeyStore,
    PreKeyStore,
    SignedPreKeyStore,
    KyberPreKeyStore,
    SenderKeyStore
```

- [ ] **Step 2: Update the schema test to assert the table exists**

The test already added in Task 1 covers this. If you skipped it, add it now.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Run all tests**

Run: `bun run test`
Expected: all PASS, including `schema.test.ts`, `GroupCipher.test.ts`, `GroupSessionBuilder.test.ts`, `SenderKeyDistributionMessage.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/stores/SQLCipherProtocolStore.ts
git commit -m "feat(ts): SQLCipherProtocolStore implements SenderKeyStore (schema v2)"
```

---

## Task 12: Export new public API and update index

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Export the new classes**

Read `src/index.ts` to find the existing block of `export { ... } from './core/...'` lines. Add:

```ts
export { GroupCipher } from './core/GroupCipher'
export { GroupSessionBuilder } from './core/GroupSessionBuilder'
export { SenderKeyDistributionMessage } from './core/SenderKeyDistributionMessage'
export { SenderKeyRecord } from './core/SenderKeyRecord'
export type { SenderKeyStore } from './core/stores'
```

If there is a separate stores index (e.g. `src/stores/index.ts`), make sure `SQLCipherProtocolStore` still satisfies the public `SenderKeyStore` interface from there (the actual implementation just has to satisfy the interface; no extra export needed).

- [ ] **Step 2: Typecheck + tests**

Run: `bun run typecheck && bun run test`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(ts): export GroupCipher, GroupSessionBuilder, SenderKey* classes"
```

---

## Task 13: Example screen — three-party group flow

**Goal:** End-to-end exercise of all four ops. Alice, Bob, Carol; pairwise 1:1 sessions already wired; Alice creates a distribution and posts a group message; Bob and Carol both decrypt; Bob then creates his own distribution and posts a reply.

**Files:**
- Create: `example/src/screens/GroupsScreen.tsx`
- Modify: `example/App.tsx`

- [ ] **Step 1: Sketch the flow as a checklist (informational, not a step)**

```
1. Generate three identities (alice/bob/carol), three pre-key bundles
2. Three pairwise 1:1 sessions via processPreKeyBundle (each side runs as needed)
3. Alice creates SenderKeyDistributionMessage for distributionId D_A
4. Alice ships SKDM to Bob over 1:1 (encryptOp + Bob decryptPreKeySignalOp)
5. Alice ships SKDM to Carol over 1:1
6. Bob and Carol each processSenderKeyDistributionMessage on the SKDM
7. Alice GroupCipher.encrypt("hello group") with D_A
8. Bob GroupCipher.decrypt -> "hello group"
9. Carol GroupCipher.decrypt -> "hello group"
10. Bob creates SKDM for distributionId D_B, ships to Alice and Carol over 1:1
11. Alice and Carol process
12. Bob GroupCipher.encrypt("hi alice + carol") with D_B
13. Alice and Carol both decrypt
14. Log [GROUPS-SUMMARY] JSON for the test harness
```

- [ ] **Step 2: Create `example/src/screens/GroupsScreen.tsx`**

Use `example/src/screens/AliceBobScreen.tsx` as the structural template (in-memory stores, ProtocolAddress, ResultRow pattern, useEffect auto-run, summary log line). The screen must:

- Use `SQLCipherProtocolStore` instances for alice/bob/carol (so the SenderKey rows hit the new sender_keys table)
- OR fall back to in-memory stores if simpler — but at least one platform smoke must hit SQLCipher. Document the choice in the screen header text.
- Use `runExclusive` on each store around each protocol op (matches the Persistence pattern).
- Emit `[GROUPS-SUMMARY]` JSON via `console.log` with the same `{status, steps:[{label, detail, ok}]}` shape used by the other screens.

The full code is too long to inline here. Author it by:

1. Read `example/src/screens/AliceBobScreen.tsx` end to end.
2. Read `example/src/screens/PersistenceScreen.tsx` for the SQLCipher store wiring pattern.
3. Compose the two.

Validate by jest (no test for the screen itself, but the imports must typecheck) and by running it on a sim.

- [ ] **Step 3: Wire the tab in `example/App.tsx`**

Edit `example/App.tsx`. Add the import:

```ts
import GroupsScreen from './src/screens/GroupsScreen'
```

Extend the `Tab` union (or whatever type is used) and the `TabButton` row:

```tsx
<TabButton current={tab} value="groups" label="Groups" onPress={setTab} />
```

Add the conditional render:

```tsx
{tab === 'groups' && <GroupsScreen />}
```

- [ ] **Step 4: Typecheck the example**

Run: `cd example && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add example/src/screens/GroupsScreen.tsx example/App.tsx
git commit -m "test(example): Groups screen exercising SenderKey end-to-end"
```

---

## Task 14: Android smoke test

- [ ] **Step 1: Build and install**

Run: `cd example && npx expo run:android` (CHECK WITH USER FIRST — this launches a dev server and binds ports).

- [ ] **Step 2: Tap the Groups tab and watch the log**

Run: `adb logcat | grep -E 'GROUPS-SUMMARY|SQLCIPHER-SUMMARY|ALICEBOB-SUMMARY'`

Expected: a `[GROUPS-SUMMARY]` line whose `status` is `"ok"` and every step has `ok: true`.

- [ ] **Step 3: Verify the SQLCipher row landed**

If `GroupsScreen` uses `SQLCipherProtocolStore`, exit the app and check that the `sender_keys` table has rows (you will need to add a small "dump" button to the screen, or just leave this as a future verification). Skip if running on the in-memory variant.

- [ ] **Step 4: Append the entry to `example/SMOKE_TEST_LOG.md`**

Use the same format as the other Phase entries.

---

## Task 15: iOS Simulator smoke test

- [ ] **Step 1: Build and run on the sim**

Run: `cd example && npx expo run:ios --port 8082 --device 5105FFD8-CC6E-443C-8791-99D70A8B900D` (CHECK WITH USER FIRST — port binding).

- [ ] **Step 2: Tap Groups, watch Metro for `[GROUPS-SUMMARY]`**

Expected: status `"ok"`, all steps `ok: true`.

- [ ] **Step 3: Restart the app and re-run if the screen has a persistence-style resumed mode**

Optional — depends on the GroupsScreen design from Task 13.

- [ ] **Step 4: Append the iOS entry to `example/SMOKE_TEST_LOG.md`**

- [ ] **Step 5: Update the roadmap in `README.md`**

In the roadmap table, replace:

```
| Groups (Sender Keys), Sealed Sender, Provisioning | pending |
```

with:

```
| Groups (Sender Keys) | ✅ shipped (Android and iOS Simulator both verified end to end — see `example/SMOKE_TEST_LOG.md`) |
| Sealed Sender, Provisioning | pending |
```

- [ ] **Step 6: Final commit**

```bash
git add example/SMOKE_TEST_LOG.md README.md
git commit -m "docs: Sender Keys verified on Android and iOS Simulator"
```

---

## Self-Review Notes

**Spec coverage:** All four group ops (`createSenderKeyDistributionMessage`, `processSenderKeyDistributionMessage`, group `encrypt`, group `decrypt`) have native ops (Tasks 6, 8), TS class methods (Tasks 9, 10), and integration coverage (Task 13). The `SenderKeyStore` interface (Task 1) and SQLCipher implementation (Task 11) are both shipped. SKDM and Record have serializable JS classes (Tasks 2, 3, 4).

**Out of scope:** Sealed Sender and Provisioning remain pending. They get their own plans in Phase 4b and 4c. The `SignalClient` facade also remains pending (Phase 5).

**Decisions left to the implementer:**
- Whether GroupsScreen uses `SQLCipherProtocolStore` or in-memory stores. SQLCipher exercises the new schema migration end to end; in-memory keeps the screen simpler. Recommendation: SQLCipher, so the v2 migration is verified by the same screen. Add a small "wiped" button per persona that uses the hardened wipe pattern from `PersistenceScreen.tsx`.
- Distribution-id UUID generation: just call `crypto.randomUUID()` in the screen. The native side accepts UUID strings.
- Whether to also test SKDM-over-1:1 wrapping in the screen (recommended) or just hand-deliver the SKDM bytes between in-process personas (simpler).

**Things that will probably trip up the implementer:**
- The Swift `SenderKeyMessage` may expose `distributionId` as a UUID property; the Java equivalent may be `getDistributionId()` returning a `UUID`. Verify against the installed libsignal version (0.94.4) when wiring `runGroupDecryptOp`.
- The Android `GroupSessionBuilder.create` signature changed across libsignal versions. Older versions take just `(senderAddress)`, newer take `(senderAddress, distributionUuid)`. Check the installed Java API.
- On iOS, the existing `NullContext()` type from `SessionOps.swift` should be reused; do not redefine it.
- `crypto.randomUUID()` requires a runtime that exposes it. React Native 0.85 ships with one; if not, fall back to a small helper (or import from `expo-crypto`).
- The `[GROUPS-SUMMARY]` log line must be the exact substring the smoke test grep expects.

**Type consistency check passed:** `SenderKeyStore.loadSenderKey/storeSenderKey` signatures match across `src/core/stores.ts` (Task 1), `SQLCipherProtocolStore` (Task 11), and the GroupCipher / GroupSessionBuilder consumers (Tasks 9, 10). `SenderKeyOpConfig` shape matches between TS (Task 4), Swift (Task 6), Kotlin (Task 8). The `{message, newRecord}` and `{ciphertext, newRecord}` result shapes also match across all three layers.
