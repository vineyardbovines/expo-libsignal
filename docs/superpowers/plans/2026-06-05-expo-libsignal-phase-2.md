# expo-libsignal Phase 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two `IdentityKeyPair` instances (Alice and Bob) can establish a session via X3DH against `PreKeyBundle`s and exchange Double-Ratchet-encrypted messages, with the full handshake plus three round-trips verified in the example app on iOS and Android.

**Architecture:** Functional core, JS-owned state. TS classes (`SessionBuilder`, `SessionCipher`) orchestrate: read state from JS store implementations, call stateless native primitives, write returned deltas back. Native primitives seed a per-call `InMemorySignalProtocolStore`, run libsignal's op, extract post-state. Swift uses libsignal's top-level functions; Kotlin uses `SessionBuilder`/`SessionCipher` classes — both shapes hide behind the four primitive ops.

**Tech Stack:** Same as Phase 1 — Expo SDK 56, Expo Modules API, Swift 6 with `LibSignalClient` 0.94.4 (pod), Kotlin with `org.signal:libsignal-android:0.94.4`, TypeScript, Jest, Biome, GitHub Actions, Bun.

**Working directory:** All file paths relative to `/Users/spence/dev/expo-libsignal/`.

**Builds on:** Phase 1 Foundation (`foundation-complete` tag). The error hierarchy, native module wiring patterns, plugin, and CI are already in place.

**Two design refinements vs. the spec, locked here:**

1. `SessionBuilder` and `SessionCipher` constructors take `(stores, remote: ProtocolAddress, local: ProtocolAddress)` — libsignal requires both addresses for X3DH binding; spec drew only `remote`.
2. The Phase 1 wrapper `PublicIdentityKeyRef` is reused as the identity-key ref throughout Phase 2 — no rename, no parallel ref type.

---

## File Structure

After this plan completes:

```
src/
├── core/
│   ├── IdentityKeyPair.ts                    # existing
│   ├── PublicKey.ts                          # NEW
│   ├── ProtocolAddress.ts                    # NEW
│   ├── PreKeyRecord.ts                       # NEW
│   ├── SignedPreKeyRecord.ts                 # NEW
│   ├── KyberPreKeyRecord.ts                  # NEW
│   ├── PreKeyBundle.ts                       # NEW
│   ├── SessionRecord.ts                      # NEW
│   ├── messages.ts                           # NEW
│   ├── stores.ts                             # NEW
│   ├── SessionBuilder.ts                     # NEW
│   └── SessionCipher.ts                      # NEW
├── errors.ts                                 # existing
├── ExpoLibsignalModule.ts                    # existing
├── index.ts                                  # MODIFIED
└── __tests__/
    ├── errors.test.ts                        # existing
    ├── smoke.test.ts                         # existing
    ├── ProtocolAddress.test.ts               # NEW
    └── PreKeyBundle.test.ts                  # NEW

ios/
├── ExpoLibsignalModule.swift                 # MODIFIED
├── PublicKey.swift                           # NEW
├── ProtocolAddress.swift                     # NEW
├── PreKeyRecords.swift                       # NEW (3 refs in one file — small)
├── PreKeyBundle.swift                        # NEW
├── SessionRecord.swift                       # NEW
├── Messages.swift                            # NEW
└── SessionOps.swift                          # NEW

android/src/main/java/expo/modules/libsignal/
├── ExpoLibsignalModule.kt                    # MODIFIED
├── PublicKey.kt                              # NEW
├── ProtocolAddress.kt                        # NEW
├── PreKeyRecords.kt                          # NEW
├── PreKeyBundle.kt                           # NEW
├── SessionRecord.kt                          # NEW
├── Messages.kt                               # NEW
└── SessionOps.kt                             # NEW

example/
├── App.tsx                                   # MODIFIED — tab nav entry
├── src/
│   ├── stores/InMemoryProtocolStore.ts       # NEW
│   ├── personas/createPersona.ts             # NEW
│   └── screens/
│       ├── IdentityScreen.tsx                # NEW (Phase 1 code moved here)
│       └── AliceBobScreen.tsx                # NEW
└── SMOKE_TEST_LOG.md                         # MODIFIED
```

---

## Task 1: Sanity-check Phase 1 still works

**Files:** none (verification only)

- [ ] **Step 1: Confirm working directory and branch**

```bash
cd /Users/spence/dev/expo-libsignal
git rev-parse --abbrev-ref HEAD
git describe --tags --abbrev=0
```
Expected: branch `main`, latest tag `foundation-complete` (or a more recent tag).

- [ ] **Step 2: Confirm lint + typecheck + tests pass on Phase 1 baseline**

```bash
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun test
```
Expected: all pass. Phase 1's `errors.test.ts` and `smoke.test.ts` should each pass.

- [ ] **Step 3: Confirm the example app's `IdentityKeyPair` smoke test still runs on iOS**

```bash
cd example
bunx expo prebuild --clean --platform ios
cd ios && pod install && cd ..
bunx expo run:ios
```
Expected: the example app launches, the Phase 1 smoke screen shows "ok (round-trip verified)" with two hex strings.

Note: this is a baseline check, not a behavior change. No commit.

---

## Task 2: Add native `PublicKey` and `ProtocolAddress` SharedObjects

**Files:**
- Create: `ios/PublicKey.swift`
- Create: `ios/ProtocolAddress.swift`
- Create: `android/src/main/java/expo/modules/libsignal/PublicKey.kt`
- Create: `android/src/main/java/expo/modules/libsignal/ProtocolAddress.kt`

- [ ] **Step 1: Write `ios/PublicKey.swift`**

```swift
import Foundation
import ExpoModulesCore
import LibSignalClient

final class PublicKeyRef: SharedObject {
  let key: PublicKey

  init(key: PublicKey) {
    self.key = key
    super.init()
  }
}
```

- [ ] **Step 2: Write `ios/ProtocolAddress.swift`**

```swift
import Foundation
import ExpoModulesCore
import LibSignalClient

final class ProtocolAddressRef: SharedObject {
  let address: ProtocolAddress

  init(address: ProtocolAddress) {
    self.address = address
    super.init()
  }
}
```

- [ ] **Step 3: Write `android/src/main/java/expo/modules/libsignal/PublicKey.kt`**

```kotlin
package expo.modules.libsignal

import expo.modules.kotlin.sharedobjects.SharedObject
import org.signal.libsignal.protocol.ecc.ECPublicKey

class PublicKeyRef(val key: ECPublicKey) : SharedObject()
```

- [ ] **Step 4: Write `android/src/main/java/expo/modules/libsignal/ProtocolAddress.kt`**

```kotlin
package expo.modules.libsignal

import expo.modules.kotlin.sharedobjects.SharedObject
import org.signal.libsignal.protocol.SignalProtocolAddress

class ProtocolAddressRef(val address: SignalProtocolAddress) : SharedObject()
```

- [ ] **Step 5: Commit**

```bash
git add ios/PublicKey.swift ios/ProtocolAddress.swift \
  android/src/main/java/expo/modules/libsignal/PublicKey.kt \
  android/src/main/java/expo/modules/libsignal/ProtocolAddress.kt
git commit -m "feat(native): PublicKey and ProtocolAddress SharedObject wrappers"
```

Note: these will not compile into the module yet — they're only referenced once we wire them into `ExpoLibsignalModule.swift`/`.kt` in Task 3.

---

## Task 3: Wire `PublicKey` and `ProtocolAddress` into the native modules

**Files:**
- Modify: `ios/ExpoLibsignalModule.swift`
- Modify: `android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt`

- [ ] **Step 1: In `ios/ExpoLibsignalModule.swift`, add factory functions and `Class()` blocks after the existing `IdentityKeyPairRef` ones**

Inside the `definition()` body, after the existing `Class(PrivateKeyRef.self) { ... }` block, append:

```swift
    AsyncFunction("deserializePublicKey") { (bytes: Data) -> PublicKeyRef in
      do {
        let key = try PublicKey(bytes)
        return PublicKeyRef(key: key)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(PublicKeyRef.self) {
      Function("serialize") { (ref: PublicKeyRef) -> Data in
        return Data(ref.key.serialize())
      }
    }

    AsyncFunction("createProtocolAddress") { (name: String, deviceId: UInt32) -> ProtocolAddressRef in
      do {
        let addr = try ProtocolAddress(name: name, deviceId: deviceId)
        return ProtocolAddressRef(address: addr)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(ProtocolAddressRef.self) {
      Function("name") { (ref: ProtocolAddressRef) -> String in
        return ref.address.name
      }
      Function("deviceId") { (ref: ProtocolAddressRef) -> UInt32 in
        return ref.address.deviceId
      }
    }
```

- [ ] **Step 2: In `android/.../ExpoLibsignalModule.kt`, add the equivalent**

Add the imports at the top:

```kotlin
import org.signal.libsignal.protocol.SignalProtocolAddress
import org.signal.libsignal.protocol.ecc.ECPublicKey
```

After the existing `Class(PrivateKeyRef::class) { ... }` block, append:

```kotlin
    AsyncFunction("deserializePublicKey") Coroutine { bytes: ByteArray ->
      try {
        PublicKeyRef(ECPublicKey(bytes))
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }

    Class(PublicKeyRef::class) {
      Constructor {
        throw IllegalStateException(
          "PublicKeyRef is not directly constructable from JS. " +
            "Use PublicKey.deserialize().",
        )
      }

      Function("serialize") { ref: PublicKeyRef ->
        ref.key.serialize()
      }
    }

    AsyncFunction("createProtocolAddress") Coroutine { name: String, deviceId: Int ->
      ProtocolAddressRef(SignalProtocolAddress(name, deviceId))
    }

    Class(ProtocolAddressRef::class) {
      Constructor {
        throw IllegalStateException(
          "ProtocolAddressRef is not directly constructable from JS. " +
            "Use ProtocolAddress.create(name, deviceId).",
        )
      }

      Function("name") { ref: ProtocolAddressRef ->
        ref.address.name
      }
      Function("deviceId") { ref: ProtocolAddressRef ->
        ref.address.deviceId
      }
    }
```

- [ ] **Step 3: Compile-check iOS**

```bash
cd example
bunx expo prebuild --clean --platform ios
cd ios && pod install
xcodebuild -workspace expolibsignalexample.xcworkspace \
  -scheme expolibsignalexample \
  -configuration Debug \
  -destination "generic/platform=iOS Simulator" \
  -derivedDataPath ./build \
  build 2>&1 | tail -30
```
Expected: `BUILD SUCCEEDED`. If `IdentityKeyPair(bytes:)` style construction warns about Data vs. ContiguousBytes shape, mirror what Phase 1's existing module file does for `deserializeIdentityKeyPair` (it uses `IdentityKeyPair(bytes: bytes)`).

- [ ] **Step 4: Compile-check Android**

```bash
cd /Users/spence/dev/expo-libsignal/example
bunx expo prebuild --clean --platform android
cd android && ./gradlew :expo-libsignal:assembleRelease 2>&1 | tail -30
```
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add ios/ExpoLibsignalModule.swift android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt
git commit -m "feat(native): wire PublicKey and ProtocolAddress into module"
```

---

## Task 4: Add TS wrappers for `PublicKey` and `ProtocolAddress`

**Files:**
- Create: `src/core/PublicKey.ts`
- Create: `src/core/ProtocolAddress.ts`
- Create: `src/__tests__/ProtocolAddress.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/ProtocolAddress.test.ts`:

```typescript
import { ProtocolAddress } from '../core/ProtocolAddress'

describe('ProtocolAddress validation', () => {
  it('rejects deviceId below 1', async () => {
    await expect(ProtocolAddress.create('alice', 0)).rejects.toThrow(/deviceId/)
  })

  it('rejects deviceId above 127', async () => {
    await expect(ProtocolAddress.create('alice', 128)).rejects.toThrow(/deviceId/)
  })

  it('rejects non-integer deviceId', async () => {
    await expect(ProtocolAddress.create('alice', 1.5)).rejects.toThrow(/deviceId/)
  })

  it('rejects empty name', async () => {
    await expect(ProtocolAddress.create('', 1)).rejects.toThrow(/name/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/__tests__/ProtocolAddress.test.ts
```
Expected: FAIL — `Cannot find module '../core/ProtocolAddress'`.

- [ ] **Step 3: Write `src/core/PublicKey.ts`**

```typescript
import { NativeModule } from '../ExpoLibsignalModule'

interface PublicKeyRef {
  serialize(): Uint8Array
}

export class PublicKey {
  private readonly ref: PublicKeyRef

  constructor(ref: PublicKeyRef) {
    this.ref = ref
  }

  static async deserialize(bytes: Uint8Array): Promise<PublicKey> {
    const ref = (await NativeModule.deserializePublicKey(bytes)) as PublicKeyRef
    return new PublicKey(ref)
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }

  // Package-internal: used by other core wrappers that receive a PublicKeyRef
  // from a native primitive.
  /** @internal */
  _ref(): PublicKeyRef {
    return this.ref
  }
}
```

- [ ] **Step 4: Write `src/core/ProtocolAddress.ts`**

```typescript
import { NativeModule } from '../ExpoLibsignalModule'

interface ProtocolAddressRef {
  name(): string
  deviceId(): number
}

export class ProtocolAddress {
  private readonly ref: ProtocolAddressRef

  constructor(ref: ProtocolAddressRef) {
    this.ref = ref
  }

  static async create(name: string, deviceId: number): Promise<ProtocolAddress> {
    if (name.length === 0) {
      throw new Error('ProtocolAddress: name must be non-empty')
    }
    if (!Number.isInteger(deviceId) || deviceId < 1 || deviceId > 127) {
      throw new Error(`ProtocolAddress: deviceId must be an integer in [1, 127], got ${deviceId}`)
    }
    const ref = (await NativeModule.createProtocolAddress(name, deviceId)) as ProtocolAddressRef
    return new ProtocolAddress(ref)
  }

  name(): string {
    return this.ref.name()
  }

  deviceId(): number {
    return this.ref.deviceId()
  }

  /** @internal */
  _ref(): ProtocolAddressRef {
    return this.ref
  }
}
```

- [ ] **Step 5: Update `src/index.ts` to export both**

Replace the file with:

```typescript
export { IdentityKey, IdentityKeyPair, PrivateKey } from './core/IdentityKeyPair'
export { ProtocolAddress } from './core/ProtocolAddress'
export { PublicKey } from './core/PublicKey'
export * from './errors'
```

- [ ] **Step 6: Re-run tests, typecheck, lint**

```bash
bun test src/__tests__/ProtocolAddress.test.ts
bun run typecheck
bun run lint
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/PublicKey.ts src/core/ProtocolAddress.ts src/__tests__/ProtocolAddress.test.ts src/index.ts
git commit -m "feat(ts): PublicKey and ProtocolAddress public API"
```

---

## Task 5: Add native `PreKeyRecord`, `SignedPreKeyRecord`, `KyberPreKeyRecord` SharedObjects

**Files:**
- Create: `ios/PreKeyRecords.swift`
- Create: `android/src/main/java/expo/modules/libsignal/PreKeyRecords.kt`

- [ ] **Step 1: Write `ios/PreKeyRecords.swift`**

```swift
import Foundation
import ExpoModulesCore
import LibSignalClient

final class PreKeyRecordRef: SharedObject {
  let record: PreKeyRecord

  init(record: PreKeyRecord) {
    self.record = record
    super.init()
  }
}

final class SignedPreKeyRecordRef: SharedObject {
  let record: SignedPreKeyRecord

  init(record: SignedPreKeyRecord) {
    self.record = record
    super.init()
  }
}

final class KyberPreKeyRecordRef: SharedObject {
  let record: KyberPreKeyRecord

  init(record: KyberPreKeyRecord) {
    self.record = record
    super.init()
  }
}
```

- [ ] **Step 2: Write `android/.../PreKeyRecords.kt`**

```kotlin
package expo.modules.libsignal

import expo.modules.kotlin.sharedobjects.SharedObject
import org.signal.libsignal.protocol.state.KyberPreKeyRecord
import org.signal.libsignal.protocol.state.PreKeyRecord
import org.signal.libsignal.protocol.state.SignedPreKeyRecord

class PreKeyRecordRef(val record: PreKeyRecord) : SharedObject()

class SignedPreKeyRecordRef(val record: SignedPreKeyRecord) : SharedObject()

class KyberPreKeyRecordRef(val record: KyberPreKeyRecord) : SharedObject()
```

- [ ] **Step 3: Commit**

```bash
git add ios/PreKeyRecords.swift android/src/main/java/expo/modules/libsignal/PreKeyRecords.kt
git commit -m "feat(native): PreKey/SignedPreKey/KyberPreKey SharedObject wrappers"
```

---

## Task 6: Wire PreKey records into the native modules

**Files:**
- Modify: `ios/ExpoLibsignalModule.swift`
- Modify: `android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt`

- [ ] **Step 1: Add Swift factories and instance methods**

Append after the `ProtocolAddressRef` `Class()` block in `ios/ExpoLibsignalModule.swift`:

```swift
    AsyncFunction("generatePreKeyRecord") { (id: UInt32) -> PreKeyRecordRef in
      do {
        let privateKey = PrivateKey.generate()
        let record = try PreKeyRecord(id: id, privateKey: privateKey)
        return PreKeyRecordRef(record: record)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("deserializePreKeyRecord") { (bytes: Data) -> PreKeyRecordRef in
      do {
        let record = try PreKeyRecord(bytes: bytes)
        return PreKeyRecordRef(record: record)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(PreKeyRecordRef.self) {
      Function("id") { (ref: PreKeyRecordRef) -> UInt32 in
        return ref.record.id
      }
      Function("publicKey") { (ref: PreKeyRecordRef) -> PublicKeyRef in
        let pk = try ref.record.publicKey()
        return PublicKeyRef(key: pk)
      }
      Function("serialize") { (ref: PreKeyRecordRef) -> Data in
        return ref.record.serialize()
      }
    }

    AsyncFunction("generateSignedPreKeyRecord") { (id: UInt32, identity: IdentityKeyPairRef, timestamp: Double) -> SignedPreKeyRecordRef in
      do {
        let privateKey = PrivateKey.generate()
        let publicKey = privateKey.publicKey
        let signature = identity.keyPair.privateKey.generateSignature(message: publicKey.serialize())
        let record = try SignedPreKeyRecord(id: id, timestamp: UInt64(timestamp), privateKey: privateKey, signature: signature)
        return SignedPreKeyRecordRef(record: record)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("deserializeSignedPreKeyRecord") { (bytes: Data) -> SignedPreKeyRecordRef in
      do {
        let record = try SignedPreKeyRecord(bytes: bytes)
        return SignedPreKeyRecordRef(record: record)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(SignedPreKeyRecordRef.self) {
      Function("id") { (ref: SignedPreKeyRecordRef) -> UInt32 in
        return ref.record.id
      }
      Function("timestamp") { (ref: SignedPreKeyRecordRef) -> Double in
        return Double(ref.record.timestamp)
      }
      Function("publicKey") { (ref: SignedPreKeyRecordRef) -> PublicKeyRef in
        let pk = try ref.record.publicKey()
        return PublicKeyRef(key: pk)
      }
      Function("signature") { (ref: SignedPreKeyRecordRef) -> Data in
        return ref.record.signature
      }
      Function("serialize") { (ref: SignedPreKeyRecordRef) -> Data in
        return ref.record.serialize()
      }
    }

    AsyncFunction("generateKyberPreKeyRecord") { (id: UInt32, identity: IdentityKeyPairRef, timestamp: Double) -> KyberPreKeyRecordRef in
      do {
        let keyPair = KEMKeyPair.generate()
        let signature = identity.keyPair.privateKey.generateSignature(message: keyPair.publicKey.serialize())
        let record = try KyberPreKeyRecord(id: id, timestamp: UInt64(timestamp), keyPair: keyPair, signature: signature)
        return KyberPreKeyRecordRef(record: record)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("deserializeKyberPreKeyRecord") { (bytes: Data) -> KyberPreKeyRecordRef in
      do {
        let record = try KyberPreKeyRecord(bytes: bytes)
        return KyberPreKeyRecordRef(record: record)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(KyberPreKeyRecordRef.self) {
      Function("id") { (ref: KyberPreKeyRecordRef) -> UInt32 in
        return ref.record.id
      }
      Function("timestamp") { (ref: KyberPreKeyRecordRef) -> Double in
        return Double(ref.record.timestamp)
      }
      Function("signature") { (ref: KyberPreKeyRecordRef) -> Data in
        return ref.record.signature
      }
      Function("serialize") { (ref: KyberPreKeyRecordRef) -> Data in
        return ref.record.serialize()
      }
    }
```

- [ ] **Step 2: Add Kotlin factories and instance methods**

Append the corresponding Kotlin code after the `ProtocolAddressRef` `Class()` block in `android/.../ExpoLibsignalModule.kt`. Add imports at top:

```kotlin
import org.signal.libsignal.protocol.ecc.ECKeyPair
import org.signal.libsignal.protocol.kem.KEMKeyPair
import org.signal.libsignal.protocol.kem.KEMKeyType
import org.signal.libsignal.protocol.state.KyberPreKeyRecord
import org.signal.libsignal.protocol.state.PreKeyRecord
import org.signal.libsignal.protocol.state.SignedPreKeyRecord
```

Inside the `definition()` body append:

```kotlin
    AsyncFunction("generatePreKeyRecord") Coroutine { id: Int ->
      val keyPair = ECKeyPair.generate()
      PreKeyRecordRef(PreKeyRecord(id, keyPair))
    }

    AsyncFunction("deserializePreKeyRecord") Coroutine { bytes: ByteArray ->
      try {
        PreKeyRecordRef(PreKeyRecord(bytes))
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }

    Class(PreKeyRecordRef::class) {
      Constructor {
        throw IllegalStateException("PreKeyRecordRef is not directly constructable from JS. Use PreKeyRecord.generate().")
      }
      Function("id") { ref: PreKeyRecordRef -> ref.record.id }
      Function("publicKey") { ref: PreKeyRecordRef -> PublicKeyRef(ref.record.keyPair.publicKey) }
      Function("serialize") { ref: PreKeyRecordRef -> ref.record.serialize() }
    }

    AsyncFunction("generateSignedPreKeyRecord") Coroutine { id: Int, identity: IdentityKeyPairRef, timestamp: Double ->
      val keyPair = ECKeyPair.generate()
      val signature = identity.keyPair.privateKey.calculateSignature(keyPair.publicKey.serialize())
      SignedPreKeyRecordRef(SignedPreKeyRecord(id, timestamp.toLong(), keyPair, signature))
    }

    AsyncFunction("deserializeSignedPreKeyRecord") Coroutine { bytes: ByteArray ->
      try {
        SignedPreKeyRecordRef(SignedPreKeyRecord(bytes))
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }

    Class(SignedPreKeyRecordRef::class) {
      Constructor {
        throw IllegalStateException("SignedPreKeyRecordRef is not directly constructable from JS. Use SignedPreKeyRecord.generate().")
      }
      Function("id") { ref: SignedPreKeyRecordRef -> ref.record.id }
      Function("timestamp") { ref: SignedPreKeyRecordRef -> ref.record.timestamp.toDouble() }
      Function("publicKey") { ref: SignedPreKeyRecordRef -> PublicKeyRef(ref.record.keyPair.publicKey) }
      Function("signature") { ref: SignedPreKeyRecordRef -> ref.record.signature }
      Function("serialize") { ref: SignedPreKeyRecordRef -> ref.record.serialize() }
    }

    AsyncFunction("generateKyberPreKeyRecord") Coroutine { id: Int, identity: IdentityKeyPairRef, timestamp: Double ->
      val keyPair = KEMKeyPair.generate(KEMKeyType.KYBER_1024)
      val signature = identity.keyPair.privateKey.calculateSignature(keyPair.publicKey.serialize())
      KyberPreKeyRecordRef(KyberPreKeyRecord(id, timestamp.toLong(), keyPair, signature))
    }

    AsyncFunction("deserializeKyberPreKeyRecord") Coroutine { bytes: ByteArray ->
      try {
        KyberPreKeyRecordRef(KyberPreKeyRecord(bytes))
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }

    Class(KyberPreKeyRecordRef::class) {
      Constructor {
        throw IllegalStateException("KyberPreKeyRecordRef is not directly constructable from JS. Use KyberPreKeyRecord.generate().")
      }
      Function("id") { ref: KyberPreKeyRecordRef -> ref.record.id }
      Function("timestamp") { ref: KyberPreKeyRecordRef -> ref.record.timestamp.toDouble() }
      Function("signature") { ref: KyberPreKeyRecordRef -> ref.record.signature }
      Function("serialize") { ref: KyberPreKeyRecordRef -> ref.record.serialize() }
    }
```

- [ ] **Step 3: Build-check iOS, then Android**

iOS:
```bash
cd example && bunx expo prebuild --clean --platform ios && cd ios && pod install
xcodebuild -workspace expolibsignalexample.xcworkspace -scheme expolibsignalexample \
  -configuration Debug -destination "generic/platform=iOS Simulator" \
  -derivedDataPath ./build build 2>&1 | tail -30
```
Expected: `BUILD SUCCEEDED`. If `KEMKeyPair.generate()` Swift signature drifts (e.g., requires a `KeyType` parameter), check `Kem.swift` in `example/ios/Pods/LibSignalClient/swift/Sources/LibSignalClient/Kem.swift` and pass the correct constant (Kyber-1024 expected).

Android:
```bash
cd /Users/spence/dev/expo-libsignal/example && bunx expo prebuild --clean --platform android
cd android && ./gradlew :expo-libsignal:assembleRelease 2>&1 | tail -30
```
Expected: `BUILD SUCCESSFUL`. If `ECKeyPair.generate()` isn't a static factory in Kotlin (older API was via `Curve.generateKeyPair()`), check the jar with `javap` and fall back accordingly.

- [ ] **Step 4: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add ios/ExpoLibsignalModule.swift android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt
git commit -m "feat(native): wire PreKey records into module"
```

---

## Task 7: Add TS wrappers for PreKey records

**Files:**
- Create: `src/core/PreKeyRecord.ts`
- Create: `src/core/SignedPreKeyRecord.ts`
- Create: `src/core/KyberPreKeyRecord.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write `src/core/PreKeyRecord.ts`**

```typescript
import { NativeModule } from '../ExpoLibsignalModule'
import { PublicKey } from './PublicKey'

interface PreKeyRecordRef {
  id(): number
  publicKey(): unknown
  serialize(): Uint8Array
}

export class PreKeyRecord {
  private readonly ref: PreKeyRecordRef

  constructor(ref: PreKeyRecordRef) {
    this.ref = ref
  }

  static async generate(id: number): Promise<PreKeyRecord> {
    if (!Number.isInteger(id) || id < 0) {
      throw new Error(`PreKeyRecord: id must be a non-negative integer, got ${id}`)
    }
    const ref = (await NativeModule.generatePreKeyRecord(id)) as PreKeyRecordRef
    return new PreKeyRecord(ref)
  }

  static async deserialize(bytes: Uint8Array): Promise<PreKeyRecord> {
    const ref = (await NativeModule.deserializePreKeyRecord(bytes)) as PreKeyRecordRef
    return new PreKeyRecord(ref)
  }

  id(): number {
    return this.ref.id()
  }

  publicKey(): PublicKey {
    return new PublicKey(this.ref.publicKey() as never)
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }

  /** @internal */
  _ref(): PreKeyRecordRef {
    return this.ref
  }
}
```

- [ ] **Step 2: Write `src/core/SignedPreKeyRecord.ts`**

```typescript
import { NativeModule } from '../ExpoLibsignalModule'
import { IdentityKeyPair } from './IdentityKeyPair'
import { PublicKey } from './PublicKey'

interface SignedPreKeyRecordRef {
  id(): number
  timestamp(): number
  publicKey(): unknown
  signature(): Uint8Array
  serialize(): Uint8Array
}

// IdentityKeyPair holds a private ref; we use a package-internal accessor.
// To keep blast radius small, IdentityKeyPair is patched in Task 14 (the
// orchestration task) to expose `_ref()`. For Task 7 the SignedPreKey
// factory uses the public IdentityKeyPair directly — the native bridge
// converts SharedObject parameters automatically.

export class SignedPreKeyRecord {
  private readonly ref: SignedPreKeyRecordRef

  constructor(ref: SignedPreKeyRecordRef) {
    this.ref = ref
  }

  static async generate(
    id: number,
    identityKeyPair: IdentityKeyPair,
    timestamp: number,
  ): Promise<SignedPreKeyRecord> {
    if (!Number.isInteger(id) || id < 0) {
      throw new Error(`SignedPreKeyRecord: id must be a non-negative integer, got ${id}`)
    }
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new Error(`SignedPreKeyRecord: timestamp must be a non-negative ms-since-epoch number`)
    }
    const ref = (await NativeModule.generateSignedPreKeyRecord(
      id,
      // SharedObject wrappers pass through as their native ref automatically
      // when used as AsyncFunction parameters. The IdentityKeyPair TS class
      // holds the ref privately; we surface it via the same opaque-object
      // shape Phase 1 uses (no _ref() needed — the auto-bound instance is
      // visible to the bridge as `identityKeyPair`).
      identityKeyPair,
      timestamp,
    )) as SignedPreKeyRecordRef
    return new SignedPreKeyRecord(ref)
  }

  static async deserialize(bytes: Uint8Array): Promise<SignedPreKeyRecord> {
    const ref = (await NativeModule.deserializeSignedPreKeyRecord(bytes)) as SignedPreKeyRecordRef
    return new SignedPreKeyRecord(ref)
  }

  id(): number {
    return this.ref.id()
  }

  timestamp(): number {
    return this.ref.timestamp()
  }

  publicKey(): PublicKey {
    return new PublicKey(this.ref.publicKey() as never)
  }

  signature(): Uint8Array {
    return this.ref.signature()
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }

  /** @internal */
  _ref(): SignedPreKeyRecordRef {
    return this.ref
  }
}
```

Important: the native side reads `identityKeyPair` as `IdentityKeyPairRef` because the bridge unwraps SharedObject-holding TS classes to their underlying ref when crossing the boundary. If the build fails at the bridge with "expected SharedObject, got plain object", patch `IdentityKeyPair` to expose `_ref()` and pass `identityKeyPair._ref()` instead. See Task 14 for the same pattern.

- [ ] **Step 3: Write `src/core/KyberPreKeyRecord.ts`**

```typescript
import { NativeModule } from '../ExpoLibsignalModule'
import { IdentityKeyPair } from './IdentityKeyPair'

interface KyberPreKeyRecordRef {
  id(): number
  timestamp(): number
  signature(): Uint8Array
  serialize(): Uint8Array
}

export class KyberPreKeyRecord {
  private readonly ref: KyberPreKeyRecordRef

  constructor(ref: KyberPreKeyRecordRef) {
    this.ref = ref
  }

  static async generate(
    id: number,
    identityKeyPair: IdentityKeyPair,
    timestamp: number,
  ): Promise<KyberPreKeyRecord> {
    if (!Number.isInteger(id) || id < 0) {
      throw new Error(`KyberPreKeyRecord: id must be a non-negative integer, got ${id}`)
    }
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new Error(`KyberPreKeyRecord: timestamp must be a non-negative ms-since-epoch number`)
    }
    const ref = (await NativeModule.generateKyberPreKeyRecord(
      id,
      identityKeyPair,
      timestamp,
    )) as KyberPreKeyRecordRef
    return new KyberPreKeyRecord(ref)
  }

  static async deserialize(bytes: Uint8Array): Promise<KyberPreKeyRecord> {
    const ref = (await NativeModule.deserializeKyberPreKeyRecord(bytes)) as KyberPreKeyRecordRef
    return new KyberPreKeyRecord(ref)
  }

  id(): number {
    return this.ref.id()
  }

  timestamp(): number {
    return this.ref.timestamp()
  }

  signature(): Uint8Array {
    return this.ref.signature()
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }

  /** @internal */
  _ref(): KyberPreKeyRecordRef {
    return this.ref
  }
}
```

- [ ] **Step 4: Update `src/index.ts`**

```typescript
export { IdentityKey, IdentityKeyPair, PrivateKey } from './core/IdentityKeyPair'
export { KyberPreKeyRecord } from './core/KyberPreKeyRecord'
export { PreKeyRecord } from './core/PreKeyRecord'
export { ProtocolAddress } from './core/ProtocolAddress'
export { PublicKey } from './core/PublicKey'
export { SignedPreKeyRecord } from './core/SignedPreKeyRecord'
export * from './errors'
```

- [ ] **Step 5: Typecheck + lint + test**

```bash
bun run typecheck
bun run lint
bun test
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/PreKeyRecord.ts src/core/SignedPreKeyRecord.ts src/core/KyberPreKeyRecord.ts src/index.ts
git commit -m "feat(ts): PreKey, SignedPreKey, KyberPreKey record wrappers"
```

---

## Task 8: Add native `PreKeyBundle` SharedObject

**Files:**
- Create: `ios/PreKeyBundle.swift`
- Create: `android/src/main/java/expo/modules/libsignal/PreKeyBundle.kt`

- [ ] **Step 1: Write `ios/PreKeyBundle.swift`**

```swift
import Foundation
import ExpoModulesCore
import LibSignalClient

final class PreKeyBundleRef: SharedObject {
  let bundle: PreKeyBundle

  init(bundle: PreKeyBundle) {
    self.bundle = bundle
    super.init()
  }
}
```

- [ ] **Step 2: Write `android/.../PreKeyBundle.kt`**

```kotlin
package expo.modules.libsignal

import expo.modules.kotlin.sharedobjects.SharedObject
import org.signal.libsignal.protocol.state.PreKeyBundle

class PreKeyBundleRef(val bundle: PreKeyBundle) : SharedObject()
```

- [ ] **Step 3: Commit**

```bash
git add ios/PreKeyBundle.swift android/src/main/java/expo/modules/libsignal/PreKeyBundle.kt
git commit -m "feat(native): PreKeyBundle SharedObject wrapper"
```

---

## Task 9: Wire `PreKeyBundle` into the native modules

**Files:**
- Modify: `ios/ExpoLibsignalModule.swift`
- Modify: `android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt`

- [ ] **Step 1: Define a Swift `Record` for the create args, then add the factory and instance methods**

At the top of `ios/ExpoLibsignalModule.swift`, after the existing imports, add:

```swift
struct PreKeyBundleArgs: Record {
  @Field var registrationId: UInt32
  @Field var deviceId: UInt32
  @Field var identityKey: PublicIdentityKeyRef
  @Field var signedPreKeyId: UInt32
  @Field var signedPreKeyPublic: PublicKeyRef
  @Field var signedPreKeySignature: Data
  @Field var kyberPreKeyId: UInt32
  @Field var kyberPreKeyPublic: Data
  @Field var kyberPreKeySignature: Data
  @Field var preKeyId: UInt32? = nil
  @Field var preKeyPublic: PublicKeyRef? = nil
}
```

Then inside the module `definition()` body, after the `KyberPreKeyRecordRef` `Class()` block, append:

```swift
    AsyncFunction("createPreKeyBundle") { (args: PreKeyBundleArgs) -> PreKeyBundleRef in
      do {
        let kyberPub = try KEMPublicKey(args.kyberPreKeyPublic)
        let bundle: PreKeyBundle
        if let preKeyId = args.preKeyId, let preKeyPublicRef = args.preKeyPublic {
          bundle = try PreKeyBundle(
            registrationId: args.registrationId,
            deviceId: args.deviceId,
            prekeyId: preKeyId,
            prekey: preKeyPublicRef.key,
            signedPrekeyId: args.signedPreKeyId,
            signedPrekey: args.signedPreKeyPublic.key,
            signedPrekeySignature: args.signedPreKeySignature,
            identity: args.identityKey.key,
            kyberPrekeyId: args.kyberPreKeyId,
            kyberPrekey: kyberPub,
            kyberPrekeySignature: args.kyberPreKeySignature,
          )
        } else {
          bundle = try PreKeyBundle(
            registrationId: args.registrationId,
            deviceId: args.deviceId,
            signedPrekeyId: args.signedPreKeyId,
            signedPrekey: args.signedPreKeyPublic.key,
            signedPrekeySignature: args.signedPreKeySignature,
            identity: args.identityKey.key,
            kyberPrekeyId: args.kyberPreKeyId,
            kyberPrekey: kyberPub,
            kyberPrekeySignature: args.kyberPreKeySignature,
          )
        }
        return PreKeyBundleRef(bundle: bundle)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(PreKeyBundleRef.self) {
      Function("registrationId") { (ref: PreKeyBundleRef) -> UInt32 in ref.bundle.registrationId }
      Function("deviceId") { (ref: PreKeyBundleRef) -> UInt32 in ref.bundle.deviceId }
      Function("identityKey") { (ref: PreKeyBundleRef) -> PublicIdentityKeyRef in
        PublicIdentityKeyRef(key: ref.bundle.identityKey)
      }
      Function("signedPreKeyId") { (ref: PreKeyBundleRef) -> UInt32 in ref.bundle.signedPreKeyId }
      Function("signedPreKeyPublic") { (ref: PreKeyBundleRef) -> PublicKeyRef in
        PublicKeyRef(key: ref.bundle.signedPreKeyPublic)
      }
      Function("signedPreKeySignature") { (ref: PreKeyBundleRef) -> Data in ref.bundle.signedPreKeySignature }
      Function("kyberPreKeyId") { (ref: PreKeyBundleRef) -> UInt32 in ref.bundle.kyberPreKeyId }
      Function("kyberPreKeyPublic") { (ref: PreKeyBundleRef) -> Data in
        Data(ref.bundle.kyberPreKeyPublic.serialize())
      }
      Function("kyberPreKeySignature") { (ref: PreKeyBundleRef) -> Data in ref.bundle.kyberPreKeySignature }
      Function("preKeyId") { (ref: PreKeyBundleRef) -> UInt32? in ref.bundle.preKeyId }
      Function("preKeyPublic") { (ref: PreKeyBundleRef) -> PublicKeyRef? in
        ref.bundle.preKeyPublic.map { PublicKeyRef(key: $0) }
      }
    }
```

- [ ] **Step 2: Define a Kotlin `Record` and add the factory and instance methods**

At the top of `android/.../ExpoLibsignalModule.kt`, after the imports, add:

```kotlin
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import org.signal.libsignal.protocol.kem.KEMPublicKey
import org.signal.libsignal.protocol.state.PreKeyBundle

class PreKeyBundleArgs : Record {
  @Field var registrationId: Int = 0
  @Field var deviceId: Int = 0
  @Field var identityKey: PublicIdentityKeyRef? = null
  @Field var signedPreKeyId: Int = 0
  @Field var signedPreKeyPublic: PublicKeyRef? = null
  @Field var signedPreKeySignature: ByteArray = ByteArray(0)
  @Field var kyberPreKeyId: Int = 0
  @Field var kyberPreKeyPublic: ByteArray = ByteArray(0)
  @Field var kyberPreKeySignature: ByteArray = ByteArray(0)
  @Field var preKeyId: Int? = null
  @Field var preKeyPublic: PublicKeyRef? = null
}
```

Inside `definition()` after the `KyberPreKeyRecordRef` `Class()` block append:

```kotlin
    AsyncFunction("createPreKeyBundle") Coroutine { args: PreKeyBundleArgs ->
      val identity = args.identityKey ?: throw IllegalArgumentException("identityKey required")
      val signedPub = args.signedPreKeyPublic ?: throw IllegalArgumentException("signedPreKeyPublic required")
      val kyberPub = KEMPublicKey(args.kyberPreKeyPublic)
      val preKeyId = args.preKeyId
      val preKeyPub = args.preKeyPublic
      val bundle = if (preKeyId != null && preKeyPub != null) {
        PreKeyBundle(
          args.registrationId,
          args.deviceId,
          preKeyId,
          preKeyPub.key,
          args.signedPreKeyId,
          signedPub.key,
          args.signedPreKeySignature,
          identity.key,
          args.kyberPreKeyId,
          kyberPub,
          args.kyberPreKeySignature,
        )
      } else {
        PreKeyBundle(
          args.registrationId,
          args.deviceId,
          PreKeyBundle.NULL_PRE_KEY_ID,
          null,
          args.signedPreKeyId,
          signedPub.key,
          args.signedPreKeySignature,
          identity.key,
          args.kyberPreKeyId,
          kyberPub,
          args.kyberPreKeySignature,
        )
      }
      PreKeyBundleRef(bundle)
    }

    Class(PreKeyBundleRef::class) {
      Constructor {
        throw IllegalStateException("PreKeyBundleRef is not directly constructable from JS. Use PreKeyBundle.create().")
      }
      Function("registrationId") { ref: PreKeyBundleRef -> ref.bundle.registrationId }
      Function("deviceId") { ref: PreKeyBundleRef -> ref.bundle.deviceId }
      Function("identityKey") { ref: PreKeyBundleRef -> PublicIdentityKeyRef(ref.bundle.identityKey) }
      Function("signedPreKeyId") { ref: PreKeyBundleRef -> ref.bundle.signedPreKeyId }
      Function("signedPreKeyPublic") { ref: PreKeyBundleRef -> PublicKeyRef(ref.bundle.signedPreKey) }
      Function("signedPreKeySignature") { ref: PreKeyBundleRef -> ref.bundle.signedPreKeySignature }
      Function("kyberPreKeyId") { ref: PreKeyBundleRef -> ref.bundle.kyberPreKeyId }
      Function("kyberPreKeyPublic") { ref: PreKeyBundleRef -> ref.bundle.kyberPreKey.serialize() }
      Function("kyberPreKeySignature") { ref: PreKeyBundleRef -> ref.bundle.kyberPreKeySignature }
      Function("preKeyId") { ref: PreKeyBundleRef ->
        val id = ref.bundle.preKeyId
        if (id == PreKeyBundle.NULL_PRE_KEY_ID) null else id
      }
      Function("preKeyPublic") { ref: PreKeyBundleRef ->
        val pk = ref.bundle.preKey
        if (pk == null) null else PublicKeyRef(pk)
      }
    }
```

Note: Kotlin's `PreKeyBundle.NULL_PRE_KEY_ID` is the sentinel for "no one-time prekey".

- [ ] **Step 3: Build-check both platforms**

iOS:
```bash
cd example && bunx expo prebuild --clean --platform ios && cd ios && pod install
xcodebuild -workspace expolibsignalexample.xcworkspace -scheme expolibsignalexample \
  -configuration Debug -destination "generic/platform=iOS Simulator" \
  -derivedDataPath ./build build 2>&1 | tail -30
```
Android:
```bash
cd /Users/spence/dev/expo-libsignal/example && bunx expo prebuild --clean --platform android
cd android && ./gradlew :expo-libsignal:assembleRelease 2>&1 | tail -30
```
Expected: both build.

- [ ] **Step 4: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add ios/ExpoLibsignalModule.swift android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt
git commit -m "feat(native): wire PreKeyBundle into module"
```

---

## Task 10: Add TS wrapper for `PreKeyBundle`

**Files:**
- Create: `src/core/PreKeyBundle.ts`
- Create: `src/__tests__/PreKeyBundle.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/PreKeyBundle.test.ts`:

```typescript
// We only validate the both-or-neither rule on preKeyId/preKeyPublic.
// Other fields are validated by the native bridge. We don't load native
// in unit tests, so the success path is covered by the example app.

// To exercise the validation without loading the native module, we
// stub it. The wrapper validates BEFORE calling native, so the stub
// is never invoked by these tests.
jest.mock('../ExpoLibsignalModule', () => ({
  NativeModule: {
    createPreKeyBundle: jest.fn(() => {
      throw new Error('native should not be called in validation tests')
    }),
  },
}))

import { PreKeyBundle } from '../core/PreKeyBundle'

describe('PreKeyBundle.create validation', () => {
  // Minimal fixtures — only the fields the validator examines need to be real
  // shapes; everything else can be `undefined as never` because we never reach
  // the native call.
  const validBase = {
    registrationId: 1,
    deviceId: 1,
    identityKey: undefined as never,
    signedPreKeyId: 1,
    signedPreKeyPublic: undefined as never,
    signedPreKeySignature: new Uint8Array(),
    kyberPreKeyId: 1,
    kyberPreKeyPublic: new Uint8Array(),
    kyberPreKeySignature: new Uint8Array(),
  }

  it('rejects preKeyId without preKeyPublic', async () => {
    await expect(
      PreKeyBundle.create({ ...validBase, preKeyId: 1 }),
    ).rejects.toThrow(/preKeyId.*preKeyPublic/)
  })

  it('rejects preKeyPublic without preKeyId', async () => {
    await expect(
      PreKeyBundle.create({ ...validBase, preKeyPublic: undefined as never }),
    ).rejects.toThrow(/preKeyId.*preKeyPublic/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/__tests__/PreKeyBundle.test.ts
```
Expected: FAIL — `Cannot find module '../core/PreKeyBundle'`.

- [ ] **Step 3: Write `src/core/PreKeyBundle.ts`**

```typescript
import { NativeModule } from '../ExpoLibsignalModule'
import type { IdentityKey } from './IdentityKeyPair'
import { PublicKey } from './PublicKey'

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

interface PreKeyBundleRef {
  registrationId(): number
  deviceId(): number
  identityKey(): unknown
  signedPreKeyId(): number
  signedPreKeyPublic(): unknown
  signedPreKeySignature(): Uint8Array
  kyberPreKeyId(): number
  kyberPreKeyPublic(): Uint8Array
  kyberPreKeySignature(): Uint8Array
  preKeyId(): number | null
  preKeyPublic(): unknown | null
}

export class PreKeyBundle {
  private readonly ref: PreKeyBundleRef

  constructor(ref: PreKeyBundleRef) {
    this.ref = ref
  }

  static async create(args: PreKeyBundleArgs): Promise<PreKeyBundle> {
    const hasId = args.preKeyId !== undefined
    const hasPub = args.preKeyPublic !== undefined
    if (hasId !== hasPub) {
      throw new Error('PreKeyBundle: preKeyId and preKeyPublic must both be present or both be absent')
    }
    const ref = (await NativeModule.createPreKeyBundle(args)) as PreKeyBundleRef
    return new PreKeyBundle(ref)
  }

  registrationId(): number { return this.ref.registrationId() }
  deviceId(): number { return this.ref.deviceId() }
  signedPreKeyId(): number { return this.ref.signedPreKeyId() }
  signedPreKeySignature(): Uint8Array { return this.ref.signedPreKeySignature() }
  kyberPreKeyId(): number { return this.ref.kyberPreKeyId() }
  kyberPreKeyPublic(): Uint8Array { return this.ref.kyberPreKeyPublic() }
  kyberPreKeySignature(): Uint8Array { return this.ref.kyberPreKeySignature() }
  preKeyId(): number | null { return this.ref.preKeyId() }

  identityKey(): IdentityKey {
    // Construct from the returned PublicIdentityKeyRef.
    // IdentityKey's constructor takes the ref; import lazily to dodge
    // circularity with IdentityKeyPair.
    const { IdentityKey } = require('./IdentityKeyPair') as typeof import('./IdentityKeyPair')
    return new IdentityKey(this.ref.identityKey() as never)
  }

  signedPreKeyPublic(): PublicKey {
    return new PublicKey(this.ref.signedPreKeyPublic() as never)
  }

  preKeyPublic(): PublicKey | null {
    const pk = this.ref.preKeyPublic()
    return pk === null ? null : new PublicKey(pk as never)
  }

  /** @internal */
  _ref(): PreKeyBundleRef {
    return this.ref
  }
}
```

- [ ] **Step 4: Update `src/index.ts`**

```typescript
export { IdentityKey, IdentityKeyPair, PrivateKey } from './core/IdentityKeyPair'
export { KyberPreKeyRecord } from './core/KyberPreKeyRecord'
export { PreKeyBundle, type PreKeyBundleArgs } from './core/PreKeyBundle'
export { PreKeyRecord } from './core/PreKeyRecord'
export { ProtocolAddress } from './core/ProtocolAddress'
export { PublicKey } from './core/PublicKey'
export { SignedPreKeyRecord } from './core/SignedPreKeyRecord'
export * from './errors'
```

- [ ] **Step 5: Tests + typecheck + lint**

```bash
bun test src/__tests__/PreKeyBundle.test.ts
bun run typecheck
bun run lint
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/PreKeyBundle.ts src/__tests__/PreKeyBundle.test.ts src/index.ts
git commit -m "feat(ts): PreKeyBundle wrapper with validation"
```

---

## Task 11: Add native `SessionRecord`, `SignalMessage`, `PreKeySignalMessage` SharedObjects

**Files:**
- Create: `ios/SessionRecord.swift`
- Create: `ios/Messages.swift`
- Create: `android/src/main/java/expo/modules/libsignal/SessionRecord.kt`
- Create: `android/src/main/java/expo/modules/libsignal/Messages.kt`

- [ ] **Step 1: Write `ios/SessionRecord.swift`**

```swift
import Foundation
import ExpoModulesCore
import LibSignalClient

final class SessionRecordRef: SharedObject {
  let record: SessionRecord

  init(record: SessionRecord) {
    self.record = record
    super.init()
  }
}
```

- [ ] **Step 2: Write `ios/Messages.swift`**

```swift
import Foundation
import ExpoModulesCore
import LibSignalClient

final class SignalMessageRef: SharedObject {
  let message: SignalMessage

  init(message: SignalMessage) {
    self.message = message
    super.init()
  }
}

final class PreKeySignalMessageRef: SharedObject {
  let message: PreKeySignalMessage

  init(message: PreKeySignalMessage) {
    self.message = message
    super.init()
  }
}
```

- [ ] **Step 3: Write `android/.../SessionRecord.kt`**

```kotlin
package expo.modules.libsignal

import expo.modules.kotlin.sharedobjects.SharedObject
import org.signal.libsignal.protocol.state.SessionRecord

class SessionRecordRef(val record: SessionRecord) : SharedObject()
```

- [ ] **Step 4: Write `android/.../Messages.kt`**

```kotlin
package expo.modules.libsignal

import expo.modules.kotlin.sharedobjects.SharedObject
import org.signal.libsignal.protocol.message.PreKeySignalMessage
import org.signal.libsignal.protocol.message.SignalMessage

class SignalMessageRef(val message: SignalMessage) : SharedObject()

class PreKeySignalMessageRef(val message: PreKeySignalMessage) : SharedObject()
```

- [ ] **Step 5: Commit**

```bash
git add ios/SessionRecord.swift ios/Messages.swift \
  android/src/main/java/expo/modules/libsignal/SessionRecord.kt \
  android/src/main/java/expo/modules/libsignal/Messages.kt
git commit -m "feat(native): SessionRecord, SignalMessage, PreKeySignalMessage SharedObjects"
```

---

## Task 12: Wire `SessionRecord` and message types into the native modules

**Files:**
- Modify: `ios/ExpoLibsignalModule.swift`
- Modify: `android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt`

- [ ] **Step 1: Add Swift factories and instance methods**

After the `PreKeyBundleRef` `Class()` block in `ios/ExpoLibsignalModule.swift`:

```swift
    AsyncFunction("deserializeSessionRecord") { (bytes: Data) -> SessionRecordRef in
      do {
        let record = try SessionRecord(bytes: bytes)
        return SessionRecordRef(record: record)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(SessionRecordRef.self) {
      Function("serialize") { (ref: SessionRecordRef) -> Data in ref.record.serialize() }
    }

    AsyncFunction("deserializeSignalMessage") { (bytes: Data) -> SignalMessageRef in
      do {
        let msg = try SignalMessage(bytes: bytes)
        return SignalMessageRef(message: msg)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(SignalMessageRef.self) {
      Function("serialize") { (ref: SignalMessageRef) -> Data in ref.message.serialize() }
    }

    AsyncFunction("deserializePreKeySignalMessage") { (bytes: Data) -> PreKeySignalMessageRef in
      do {
        let msg = try PreKeySignalMessage(bytes: bytes)
        return PreKeySignalMessageRef(message: msg)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(PreKeySignalMessageRef.self) {
      Function("serialize") { (ref: PreKeySignalMessageRef) -> Data in
        return try ref.message.serialize()
      }
      Function("registrationId") { (ref: PreKeySignalMessageRef) -> UInt32 in
        return try ref.message.registrationId()
      }
      Function("preKeyId") { (ref: PreKeySignalMessageRef) -> UInt32? in
        return try ref.message.preKeyId()
      }
      Function("signedPreKeyId") { (ref: PreKeySignalMessageRef) -> UInt32 in
        return ref.message.signedPreKeyId
      }
    }
```

- [ ] **Step 2: Add Kotlin equivalents**

After the `PreKeyBundleRef` `Class()` block in `android/.../ExpoLibsignalModule.kt`. Add imports first:

```kotlin
import org.signal.libsignal.protocol.message.PreKeySignalMessage
import org.signal.libsignal.protocol.message.SignalMessage
import org.signal.libsignal.protocol.state.SessionRecord
```

Then inside `definition()`:

```kotlin
    AsyncFunction("deserializeSessionRecord") Coroutine { bytes: ByteArray ->
      try {
        SessionRecordRef(SessionRecord(bytes))
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }

    Class(SessionRecordRef::class) {
      Constructor {
        throw IllegalStateException("SessionRecordRef is not directly constructable from JS. Use SessionRecord.deserialize() or get one from SessionBuilder/SessionCipher.")
      }
      Function("serialize") { ref: SessionRecordRef -> ref.record.serialize() }
    }

    AsyncFunction("deserializeSignalMessage") Coroutine { bytes: ByteArray ->
      try {
        SignalMessageRef(SignalMessage(bytes))
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }

    Class(SignalMessageRef::class) {
      Constructor {
        throw IllegalStateException("SignalMessageRef is not directly constructable from JS. Use SignalMessage.deserialize().")
      }
      Function("serialize") { ref: SignalMessageRef -> ref.message.serialize() }
    }

    AsyncFunction("deserializePreKeySignalMessage") Coroutine { bytes: ByteArray ->
      try {
        PreKeySignalMessageRef(PreKeySignalMessage(bytes))
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }

    Class(PreKeySignalMessageRef::class) {
      Constructor {
        throw IllegalStateException("PreKeySignalMessageRef is not directly constructable from JS. Use PreKeySignalMessage.deserialize().")
      }
      Function("serialize") { ref: PreKeySignalMessageRef -> ref.message.serialize() }
      Function("registrationId") { ref: PreKeySignalMessageRef -> ref.message.registrationId }
      Function("preKeyId") { ref: PreKeySignalMessageRef ->
        val opt = ref.message.preKeyId
        if (opt.isPresent) opt.get() else null
      }
      Function("signedPreKeyId") { ref: PreKeySignalMessageRef -> ref.message.signedPreKeyId }
    }
```

- [ ] **Step 3: Build-check both platforms**

```bash
cd /Users/spence/dev/expo-libsignal/example
bunx expo prebuild --clean --platform ios && cd ios && pod install && cd ..
xcodebuild -workspace ios/expolibsignalexample.xcworkspace -scheme expolibsignalexample \
  -configuration Debug -destination "generic/platform=iOS Simulator" \
  -derivedDataPath ios/build build 2>&1 | tail -20
bunx expo prebuild --clean --platform android
cd android && ./gradlew :expo-libsignal:assembleRelease 2>&1 | tail -20
```
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add ios/ExpoLibsignalModule.swift android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt
git commit -m "feat(native): wire SessionRecord and message types into module"
```

---

## Task 13: Add TS wrappers for `SessionRecord` and messages

**Files:**
- Create: `src/core/SessionRecord.ts`
- Create: `src/core/messages.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write `src/core/SessionRecord.ts`**

```typescript
import { NativeModule } from '../ExpoLibsignalModule'

interface SessionRecordRef {
  serialize(): Uint8Array
}

export class SessionRecord {
  private readonly ref: SessionRecordRef

  constructor(ref: SessionRecordRef) {
    this.ref = ref
  }

  static async deserialize(bytes: Uint8Array): Promise<SessionRecord> {
    const ref = (await NativeModule.deserializeSessionRecord(bytes)) as SessionRecordRef
    return new SessionRecord(ref)
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }

  /** @internal */
  _ref(): SessionRecordRef {
    return this.ref
  }
}
```

- [ ] **Step 2: Write `src/core/messages.ts`**

```typescript
import { NativeModule } from '../ExpoLibsignalModule'

interface SignalMessageRef {
  serialize(): Uint8Array
}

interface PreKeySignalMessageRef {
  serialize(): Uint8Array
  registrationId(): number
  preKeyId(): number | null
  signedPreKeyId(): number
}

export class SignalMessage {
  readonly type = 'signal' as const
  private readonly ref: SignalMessageRef

  constructor(ref: SignalMessageRef) {
    this.ref = ref
  }

  static async deserialize(bytes: Uint8Array): Promise<SignalMessage> {
    const ref = (await NativeModule.deserializeSignalMessage(bytes)) as SignalMessageRef
    return new SignalMessage(ref)
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }

  /** @internal */
  _ref(): SignalMessageRef {
    return this.ref
  }
}

export class PreKeySignalMessage {
  readonly type = 'preKeySignal' as const
  private readonly ref: PreKeySignalMessageRef

  constructor(ref: PreKeySignalMessageRef) {
    this.ref = ref
  }

  static async deserialize(bytes: Uint8Array): Promise<PreKeySignalMessage> {
    const ref = (await NativeModule.deserializePreKeySignalMessage(bytes)) as PreKeySignalMessageRef
    return new PreKeySignalMessage(ref)
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }

  registrationId(): number {
    return this.ref.registrationId()
  }

  preKeyId(): number | null {
    return this.ref.preKeyId()
  }

  signedPreKeyId(): number {
    return this.ref.signedPreKeyId()
  }

  /** @internal */
  _ref(): PreKeySignalMessageRef {
    return this.ref
  }
}

export type CiphertextMessage = SignalMessage | PreKeySignalMessage
```

- [ ] **Step 3: Update `src/index.ts`**

```typescript
export { IdentityKey, IdentityKeyPair, PrivateKey } from './core/IdentityKeyPair'
export { KyberPreKeyRecord } from './core/KyberPreKeyRecord'
export { type CiphertextMessage, PreKeySignalMessage, SignalMessage } from './core/messages'
export { PreKeyBundle, type PreKeyBundleArgs } from './core/PreKeyBundle'
export { PreKeyRecord } from './core/PreKeyRecord'
export { ProtocolAddress } from './core/ProtocolAddress'
export { PublicKey } from './core/PublicKey'
export { SessionRecord } from './core/SessionRecord'
export { SignedPreKeyRecord } from './core/SignedPreKeyRecord'
export * from './errors'
```

- [ ] **Step 4: Typecheck + lint + tests**

```bash
bun run typecheck
bun run lint
bun test
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/SessionRecord.ts src/core/messages.ts src/index.ts
git commit -m "feat(ts): SessionRecord, SignalMessage, PreKeySignalMessage wrappers"
```

---

## Task 14: Add TS store interfaces

**Files:**
- Create: `src/core/stores.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write `src/core/stores.ts`**

```typescript
import type { IdentityKey, IdentityKeyPair } from './IdentityKeyPair'
import type { KyberPreKeyRecord } from './KyberPreKeyRecord'
import type { PreKeyRecord } from './PreKeyRecord'
import type { ProtocolAddress } from './ProtocolAddress'
import type { SessionRecord } from './SessionRecord'
import type { SignedPreKeyRecord } from './SignedPreKeyRecord'

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
  loadPreKey(id: number): Promise<PreKeyRecord>
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

- [ ] **Step 2: Update `src/index.ts`**

Add the store exports — the existing exports stay, append:

```typescript
export type {
  Direction,
  IdentityChange,
  IdentityKeyStore,
  KyberPreKeyStore,
  PreKeyStore,
  SessionStore,
  SignedPreKeyStore,
} from './core/stores'
```

- [ ] **Step 3: Typecheck + lint**

```bash
bun run typecheck
bun run lint
```
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/core/stores.ts src/index.ts
git commit -m "feat(ts): store interfaces (5 stores)"
```

---

## Task 15: Native iOS — `processPreKeyBundleOp` primitive

**Files:**
- Create: `ios/SessionOps.swift`
- Modify: `ios/ExpoLibsignalModule.swift`

The four crypto primitives all share the same shape: seed a per-call `InMemorySignalProtocolStore`, run libsignal's op, read post-state. We put the shared helper plus the four ops in a single file to keep the module file from getting unwieldy.

- [ ] **Step 1: Create `ios/SessionOps.swift` with the shared seed/read helpers and `processPreKeyBundleOp`**

```swift
import Foundation
import ExpoModulesCore
import LibSignalClient

// MARK: - Argument and result records

struct ProcessPreKeyBundleArgs: Record {
  @Field var bundle: PreKeyBundleRef
  @Field var remoteAddress: ProtocolAddressRef
  @Field var localAddress: ProtocolAddressRef
  @Field var ourIdentityKeyPair: IdentityKeyPairRef
  @Field var ourRegistrationId: UInt32
  @Field var existingSession: SessionRecordRef? = nil
  @Field var existingRemoteIdentity: PublicIdentityKeyRef? = nil
  @Field var nowMs: Double
}

struct ProcessPreKeyBundleResult: Record {
  @Field var newSession: SessionRecordRef
  @Field var identityChange: String
  @Field var trustedRemoteIdentity: PublicIdentityKeyRef
}

// MARK: - Store seeding helpers

func seedStore(
  identityKeyPair: IdentityKeyPairRef,
  registrationId: UInt32,
  remoteAddress: ProtocolAddressRef? = nil,
  existingSession: SessionRecordRef? = nil,
  existingRemoteIdentity: PublicIdentityKeyRef? = nil,
) throws -> InMemorySignalProtocolStore {
  let store = InMemorySignalProtocolStore(identity: identityKeyPair.keyPair, registrationId: registrationId)
  let ctx = NullContext()
  if let session = existingSession, let addr = remoteAddress {
    try store.storeSession(session.record, for: addr.address, context: ctx)
  }
  if let ident = existingRemoteIdentity, let addr = remoteAddress {
    _ = try store.saveIdentity(ident.key, for: addr.address, context: ctx)
  }
  return store
}

func identityChangeString(
  store: InMemorySignalProtocolStore,
  remoteAddress: ProtocolAddressRef,
  existing: PublicIdentityKeyRef?,
) throws -> String {
  let now = try store.identity(for: remoteAddress.address, context: NullContext())
  if let now = now, let existing = existing, now == existing.key {
    return "newOrUnchanged"
  }
  return existing == nil ? "newOrUnchanged" : "replacedExisting"
}

// MARK: - processPreKeyBundleOp

func runProcessPreKeyBundleOp(_ args: ProcessPreKeyBundleArgs) throws -> ProcessPreKeyBundleResult {
  let ctx = NullContext()
  let store = try seedStore(
    identityKeyPair: args.ourIdentityKeyPair,
    registrationId: args.ourRegistrationId,
    remoteAddress: args.remoteAddress,
    existingSession: args.existingSession,
    existingRemoteIdentity: args.existingRemoteIdentity,
  )

  try processPreKeyBundle(
    args.bundle.bundle,
    for: args.remoteAddress.address,
    ourAddress: args.localAddress.address,
    sessionStore: store,
    identityStore: store,
    now: Date(timeIntervalSince1970: args.nowMs / 1000.0),
    context: ctx,
  )

  guard let newSession = try store.loadSession(for: args.remoteAddress.address, context: ctx) else {
    throw Exception(name: "LibsignalError", description: "processPreKeyBundle did not produce a session")
  }
  let trustedRemoteIdentity = try store.identity(for: args.remoteAddress.address, context: ctx)
    ?? args.bundle.bundle.identityKey
  let change = try identityChangeString(
    store: store,
    remoteAddress: args.remoteAddress,
    existing: args.existingRemoteIdentity,
  )

  let result = ProcessPreKeyBundleResult()
  result.newSession = SessionRecordRef(record: newSession)
  result.identityChange = change
  result.trustedRemoteIdentity = PublicIdentityKeyRef(key: trustedRemoteIdentity)
  return result
}
```

- [ ] **Step 2: Register `processPreKeyBundleOp` in `ios/ExpoLibsignalModule.swift`**

After the `PreKeySignalMessageRef` `Class()` block append:

```swift
    AsyncFunction("processPreKeyBundleOp") { (args: ProcessPreKeyBundleArgs) -> ProcessPreKeyBundleResult in
      do {
        return try runProcessPreKeyBundleOp(args)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }
```

- [ ] **Step 3: Build-check iOS**

```bash
cd example
bunx expo prebuild --clean --platform ios && cd ios && pod install
xcodebuild -workspace expolibsignalexample.xcworkspace -scheme expolibsignalexample \
  -configuration Debug -destination "generic/platform=iOS Simulator" \
  -derivedDataPath ./build build 2>&1 | tail -30
```
Expected: `BUILD SUCCEEDED`. If `InMemorySignalProtocolStore.saveIdentity` warns about an unused return, capture it with `_ = try ...`. If `identity(for:context:)` returns `IdentityKey?` rather than throwing when missing, the code above already handles `nil` via the `?? args.bundle.bundle.identityKey` fallback.

- [ ] **Step 4: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add ios/SessionOps.swift ios/ExpoLibsignalModule.swift
git commit -m "feat(ios): processPreKeyBundleOp native primitive"
```

---

## Task 16: Native Android — `processPreKeyBundleOp` primitive

**Files:**
- Create: `android/src/main/java/expo/modules/libsignal/SessionOps.kt`
- Modify: `android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt`

- [ ] **Step 1: Create `android/.../SessionOps.kt`**

```kotlin
package expo.modules.libsignal

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.time.Instant
import org.signal.libsignal.protocol.SessionBuilder
import org.signal.libsignal.protocol.state.IdentityKeyStore
import org.signal.libsignal.protocol.state.impl.InMemorySignalProtocolStore

class ProcessPreKeyBundleArgs : Record {
  @Field var bundle: PreKeyBundleRef? = null
  @Field var remoteAddress: ProtocolAddressRef? = null
  @Field var localAddress: ProtocolAddressRef? = null
  @Field var ourIdentityKeyPair: IdentityKeyPairRef? = null
  @Field var ourRegistrationId: Int = 0
  @Field var existingSession: SessionRecordRef? = null
  @Field var existingRemoteIdentity: PublicIdentityKeyRef? = null
  @Field var nowMs: Double = 0.0
}

class ProcessPreKeyBundleResult : Record {
  @Field var newSession: SessionRecordRef? = null
  @Field var identityChange: String = "newOrUnchanged"
  @Field var trustedRemoteIdentity: PublicIdentityKeyRef? = null
}

internal fun seedStore(
  identity: IdentityKeyPairRef,
  registrationId: Int,
  remoteAddress: ProtocolAddressRef? = null,
  existingSession: SessionRecordRef? = null,
  existingRemoteIdentity: PublicIdentityKeyRef? = null,
): InMemorySignalProtocolStore {
  val store = InMemorySignalProtocolStore(identity.keyPair, registrationId)
  if (existingSession != null && remoteAddress != null) {
    store.storeSession(remoteAddress.address, existingSession.record)
  }
  if (existingRemoteIdentity != null && remoteAddress != null) {
    store.saveIdentity(remoteAddress.address, existingRemoteIdentity.key)
  }
  return store
}

internal fun identityChangeString(
  store: InMemorySignalProtocolStore,
  remoteAddress: ProtocolAddressRef,
  existing: PublicIdentityKeyRef?,
): String {
  val now = store.getIdentity(remoteAddress.address)
  if (now != null && existing != null && now == existing.key) {
    return "newOrUnchanged"
  }
  return if (existing == null) "newOrUnchanged" else "replacedExisting"
}

internal fun runProcessPreKeyBundleOp(args: ProcessPreKeyBundleArgs): ProcessPreKeyBundleResult {
  val bundle = args.bundle ?: throw IllegalArgumentException("bundle required")
  val remote = args.remoteAddress ?: throw IllegalArgumentException("remoteAddress required")
  val local = args.localAddress ?: throw IllegalArgumentException("localAddress required")
  val identity = args.ourIdentityKeyPair ?: throw IllegalArgumentException("ourIdentityKeyPair required")

  val store = seedStore(
    identity = identity,
    registrationId = args.ourRegistrationId,
    remoteAddress = remote,
    existingSession = args.existingSession,
    existingRemoteIdentity = args.existingRemoteIdentity,
  )

  val builder = SessionBuilder(store, store, store, store, remote.address, local.address)
  builder.process(bundle.bundle, Instant.ofEpochMilli(args.nowMs.toLong()))

  val newSession = store.loadSession(remote.address)
    ?: throw IllegalStateException("processPreKeyBundle did not produce a session")
  val trustedRemote = store.getIdentity(remote.address) ?: bundle.bundle.identityKey

  val result = ProcessPreKeyBundleResult()
  result.newSession = SessionRecordRef(newSession)
  result.identityChange = identityChangeString(store, remote, args.existingRemoteIdentity)
  result.trustedRemoteIdentity = PublicIdentityKeyRef(trustedRemote)
  return result
}
```

- [ ] **Step 2: Register `processPreKeyBundleOp` in the Kotlin module**

In `android/.../ExpoLibsignalModule.kt` inside `definition()`, after the `PreKeySignalMessageRef` `Class()` block:

```kotlin
    AsyncFunction("processPreKeyBundleOp") Coroutine { args: ProcessPreKeyBundleArgs ->
      try {
        runProcessPreKeyBundleOp(args)
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }
```

- [ ] **Step 3: Build-check Android**

```bash
cd /Users/spence/dev/expo-libsignal/example
bunx expo prebuild --clean --platform android
cd android && ./gradlew :expo-libsignal:assembleRelease 2>&1 | tail -30
```
Expected: `BUILD SUCCESSFUL`. If `SessionBuilder` constructor signature differs (e.g., `SessionBuilder(SignalProtocolStore, addr1, addr2)`), check via `javap` and adapt — both forms exist in the jar. If `Instant.ofEpochMilli` causes a desugar warning, that's expected and harmless (core library desugaring is already enabled per Phase 1 lesson #6).

- [ ] **Step 4: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add android/src/main/java/expo/modules/libsignal/SessionOps.kt \
  android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt
git commit -m "feat(android): processPreKeyBundleOp native primitive"
```

---

## Task 17: Native iOS — `encryptOp` primitive

**Files:**
- Modify: `ios/SessionOps.swift`
- Modify: `ios/ExpoLibsignalModule.swift`

- [ ] **Step 1: Append the `encryptOp` types and runner to `ios/SessionOps.swift`**

```swift
struct EncryptArgs: Record {
  @Field var plaintext: Data
  @Field var remoteAddress: ProtocolAddressRef
  @Field var localAddress: ProtocolAddressRef
  @Field var ourIdentityKeyPair: IdentityKeyPairRef
  @Field var ourRegistrationId: UInt32
  @Field var existingSession: SessionRecordRef
  @Field var remoteIdentity: PublicIdentityKeyRef? = nil
  @Field var nowMs: Double
}

struct EncryptResult: Record {
  @Field var messageType: String
  @Field var preKeySignalMessage: PreKeySignalMessageRef? = nil
  @Field var signalMessage: SignalMessageRef? = nil
  @Field var newSession: SessionRecordRef
  @Field var identityChange: String? = nil
}

func runEncryptOp(_ args: EncryptArgs) throws -> EncryptResult {
  let ctx = NullContext()
  let store = try seedStore(
    identityKeyPair: args.ourIdentityKeyPair,
    registrationId: args.ourRegistrationId,
    remoteAddress: args.remoteAddress,
    existingSession: args.existingSession,
    existingRemoteIdentity: args.remoteIdentity,
  )

  let ciphertext = try signalEncrypt(
    message: args.plaintext,
    for: args.remoteAddress.address,
    localAddress: args.localAddress.address,
    sessionStore: store,
    identityStore: store,
    now: Date(timeIntervalSince1970: args.nowMs / 1000.0),
    context: ctx,
  )

  guard let newSession = try store.loadSession(for: args.remoteAddress.address, context: ctx) else {
    throw Exception(name: "LibsignalError", description: "encryptOp produced no session")
  }

  let result = EncryptResult()
  result.newSession = SessionRecordRef(record: newSession)
  result.identityChange = args.remoteIdentity == nil ? nil : "newOrUnchanged"

  switch ciphertext.messageType {
  case .preKey:
    let bytes = ciphertext.serialize()
    let preKeyMsg = try PreKeySignalMessage(bytes: bytes)
    result.messageType = "preKeySignal"
    result.preKeySignalMessage = PreKeySignalMessageRef(message: preKeyMsg)
  case .whisper:
    let bytes = ciphertext.serialize()
    let signalMsg = try SignalMessage(bytes: bytes)
    result.messageType = "signal"
    result.signalMessage = SignalMessageRef(message: signalMsg)
  default:
    throw Exception(name: "LibsignalError", description: "encryptOp produced unexpected ciphertext type \(ciphertext.messageType.rawValue)")
  }
  return result
}
```

- [ ] **Step 2: Register `encryptOp` in the iOS module**

In `ios/ExpoLibsignalModule.swift`, after the `processPreKeyBundleOp` registration:

```swift
    AsyncFunction("encryptOp") { (args: EncryptArgs) -> EncryptResult in
      do {
        return try runEncryptOp(args)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }
```

- [ ] **Step 3: Build-check iOS**

```bash
cd example && bunx expo prebuild --clean --platform ios && cd ios && pod install
xcodebuild -workspace expolibsignalexample.xcworkspace -scheme expolibsignalexample \
  -configuration Debug -destination "generic/platform=iOS Simulator" \
  -derivedDataPath ./build build 2>&1 | tail -30
```
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add ios/SessionOps.swift ios/ExpoLibsignalModule.swift
git commit -m "feat(ios): encryptOp native primitive"
```

---

## Task 18: Native Android — `encryptOp` primitive

**Files:**
- Modify: `android/src/main/java/expo/modules/libsignal/SessionOps.kt`
- Modify: `android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt`

- [ ] **Step 1: Append `encryptOp` to `android/.../SessionOps.kt`**

Add imports at top:

```kotlin
import org.signal.libsignal.protocol.SessionCipher
import org.signal.libsignal.protocol.message.CiphertextMessage
import org.signal.libsignal.protocol.message.PreKeySignalMessage
import org.signal.libsignal.protocol.message.SignalMessage
```

Then append:

```kotlin
class EncryptArgs : Record {
  @Field var plaintext: ByteArray = ByteArray(0)
  @Field var remoteAddress: ProtocolAddressRef? = null
  @Field var localAddress: ProtocolAddressRef? = null
  @Field var ourIdentityKeyPair: IdentityKeyPairRef? = null
  @Field var ourRegistrationId: Int = 0
  @Field var existingSession: SessionRecordRef? = null
  @Field var remoteIdentity: PublicIdentityKeyRef? = null
  @Field var nowMs: Double = 0.0
}

class EncryptResult : Record {
  @Field var messageType: String = ""
  @Field var preKeySignalMessage: PreKeySignalMessageRef? = null
  @Field var signalMessage: SignalMessageRef? = null
  @Field var newSession: SessionRecordRef? = null
  @Field var identityChange: String? = null
}

internal fun runEncryptOp(args: EncryptArgs): EncryptResult {
  val remote = args.remoteAddress ?: throw IllegalArgumentException("remoteAddress required")
  val local = args.localAddress ?: throw IllegalArgumentException("localAddress required")
  val identity = args.ourIdentityKeyPair ?: throw IllegalArgumentException("ourIdentityKeyPair required")
  val session = args.existingSession ?: throw IllegalArgumentException("existingSession required")

  val store = seedStore(
    identity = identity,
    registrationId = args.ourRegistrationId,
    remoteAddress = remote,
    existingSession = session,
    existingRemoteIdentity = args.remoteIdentity,
  )

  val cipher = SessionCipher(store, store, store, store, store, remote.address, local.address)
  val ciphertext = cipher.encrypt(args.plaintext, Instant.ofEpochMilli(args.nowMs.toLong()))

  val newSession = store.loadSession(remote.address)
    ?: throw IllegalStateException("encryptOp produced no session")

  val result = EncryptResult()
  result.newSession = SessionRecordRef(newSession)
  result.identityChange = if (args.remoteIdentity == null) null else "newOrUnchanged"

  when (ciphertext.type) {
    CiphertextMessage.PREKEY_TYPE -> {
      result.messageType = "preKeySignal"
      result.preKeySignalMessage = PreKeySignalMessageRef(PreKeySignalMessage(ciphertext.serialize()))
    }
    CiphertextMessage.WHISPER_TYPE -> {
      result.messageType = "signal"
      result.signalMessage = SignalMessageRef(SignalMessage(ciphertext.serialize()))
    }
    else -> throw IllegalStateException("encryptOp produced unexpected ciphertext type ${ciphertext.type}")
  }
  return result
}
```

- [ ] **Step 2: Register `encryptOp` in the Kotlin module**

In `android/.../ExpoLibsignalModule.kt` after the `processPreKeyBundleOp` registration:

```kotlin
    AsyncFunction("encryptOp") Coroutine { args: EncryptArgs ->
      try {
        runEncryptOp(args)
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }
```

- [ ] **Step 3: Build-check Android**

```bash
cd /Users/spence/dev/expo-libsignal/example
bunx expo prebuild --clean --platform android
cd android && ./gradlew :expo-libsignal:assembleRelease 2>&1 | tail -30
```
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add android/src/main/java/expo/modules/libsignal/SessionOps.kt \
  android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt
git commit -m "feat(android): encryptOp native primitive"
```

---

## Task 19: Native iOS — `decryptPreKeySignalOp` primitive

**Files:**
- Modify: `ios/SessionOps.swift`
- Modify: `ios/ExpoLibsignalModule.swift`

- [ ] **Step 1: Append `decryptPreKeySignalOp` types and runner to `ios/SessionOps.swift`**

```swift
struct DecryptPreKeySignalArgs: Record {
  @Field var message: PreKeySignalMessageRef
  @Field var remoteAddress: ProtocolAddressRef
  @Field var localAddress: ProtocolAddressRef
  @Field var ourIdentityKeyPair: IdentityKeyPairRef
  @Field var ourRegistrationId: UInt32
  @Field var existingSession: SessionRecordRef? = nil
  @Field var existingRemoteIdentity: PublicIdentityKeyRef? = nil
  @Field var preKey: PreKeyRecordRef? = nil
  @Field var signedPreKey: SignedPreKeyRecordRef
  @Field var kyberPreKey: KyberPreKeyRecordRef
}

struct DecryptPreKeySignalResult: Record {
  @Field var plaintext: Data
  @Field var newSession: SessionRecordRef
  @Field var identityChange: String? = nil
  @Field var consumedPreKeyId: UInt32? = nil
  @Field var kyberPreKeyId: UInt32
}

func runDecryptPreKeySignalOp(_ args: DecryptPreKeySignalArgs) throws -> DecryptPreKeySignalResult {
  let ctx = NullContext()
  let store = try seedStore(
    identityKeyPair: args.ourIdentityKeyPair,
    registrationId: args.ourRegistrationId,
    remoteAddress: args.remoteAddress,
    existingSession: args.existingSession,
    existingRemoteIdentity: args.existingRemoteIdentity,
  )

  // Seed the prekey stores with the supplied records.
  if let preKey = args.preKey {
    try store.storePreKey(preKey.record, id: preKey.record.id, context: ctx)
  }
  try store.storeSignedPreKey(args.signedPreKey.record, id: args.signedPreKey.record.id, context: ctx)
  try store.storeKyberPreKey(args.kyberPreKey.record, id: args.kyberPreKey.record.id, context: ctx)

  let plaintext = try signalDecryptPreKey(
    message: args.message.message,
    from: args.remoteAddress.address,
    localAddress: args.localAddress.address,
    sessionStore: store,
    identityStore: store,
    preKeyStore: store,
    signedPreKeyStore: store,
    kyberPreKeyStore: store,
    context: ctx,
  )

  guard let newSession = try store.loadSession(for: args.remoteAddress.address, context: ctx) else {
    throw Exception(name: "LibsignalError", description: "decryptPreKeySignalOp produced no session")
  }

  // Was the one-time prekey consumed? loadPreKey throws after removal; we check the message id.
  let messagePreKeyId = try args.message.message.preKeyId()
  let consumedPreKeyId: UInt32? = messagePreKeyId  // libsignal removes it during decrypt

  let result = DecryptPreKeySignalResult()
  result.plaintext = Data(plaintext)
  result.newSession = SessionRecordRef(record: newSession)
  result.identityChange = try identityChangeString(
    store: store,
    remoteAddress: args.remoteAddress,
    existing: args.existingRemoteIdentity,
  )
  result.consumedPreKeyId = consumedPreKeyId
  result.kyberPreKeyId = args.kyberPreKey.record.id
  return result
}
```

- [ ] **Step 2: Register `decryptPreKeySignalOp` in the iOS module**

```swift
    AsyncFunction("decryptPreKeySignalOp") { (args: DecryptPreKeySignalArgs) -> DecryptPreKeySignalResult in
      do {
        return try runDecryptPreKeySignalOp(args)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }
```

- [ ] **Step 3: Build-check iOS**

```bash
cd example && bunx expo prebuild --clean --platform ios && cd ios && pod install
xcodebuild -workspace expolibsignalexample.xcworkspace -scheme expolibsignalexample \
  -configuration Debug -destination "generic/platform=iOS Simulator" \
  -derivedDataPath ./build build 2>&1 | tail -20
```
Expected: success.

- [ ] **Step 4: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add ios/SessionOps.swift ios/ExpoLibsignalModule.swift
git commit -m "feat(ios): decryptPreKeySignalOp native primitive"
```

---

## Task 20: Native Android — `decryptPreKeySignalOp` primitive

**Files:**
- Modify: `android/src/main/java/expo/modules/libsignal/SessionOps.kt`
- Modify: `android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt`

- [ ] **Step 1: Append to `android/.../SessionOps.kt`**

```kotlin
class DecryptPreKeySignalArgs : Record {
  @Field var message: PreKeySignalMessageRef? = null
  @Field var remoteAddress: ProtocolAddressRef? = null
  @Field var localAddress: ProtocolAddressRef? = null
  @Field var ourIdentityKeyPair: IdentityKeyPairRef? = null
  @Field var ourRegistrationId: Int = 0
  @Field var existingSession: SessionRecordRef? = null
  @Field var existingRemoteIdentity: PublicIdentityKeyRef? = null
  @Field var preKey: PreKeyRecordRef? = null
  @Field var signedPreKey: SignedPreKeyRecordRef? = null
  @Field var kyberPreKey: KyberPreKeyRecordRef? = null
}

class DecryptPreKeySignalResult : Record {
  @Field var plaintext: ByteArray = ByteArray(0)
  @Field var newSession: SessionRecordRef? = null
  @Field var identityChange: String? = null
  @Field var consumedPreKeyId: Int? = null
  @Field var kyberPreKeyId: Int = 0
}

internal fun runDecryptPreKeySignalOp(args: DecryptPreKeySignalArgs): DecryptPreKeySignalResult {
  val msg = args.message ?: throw IllegalArgumentException("message required")
  val remote = args.remoteAddress ?: throw IllegalArgumentException("remoteAddress required")
  val local = args.localAddress ?: throw IllegalArgumentException("localAddress required")
  val identity = args.ourIdentityKeyPair ?: throw IllegalArgumentException("ourIdentityKeyPair required")
  val signedPreKey = args.signedPreKey ?: throw IllegalArgumentException("signedPreKey required")
  val kyberPreKey = args.kyberPreKey ?: throw IllegalArgumentException("kyberPreKey required")

  val store = seedStore(
    identity = identity,
    registrationId = args.ourRegistrationId,
    remoteAddress = remote,
    existingSession = args.existingSession,
    existingRemoteIdentity = args.existingRemoteIdentity,
  )

  args.preKey?.let { store.storePreKey(it.record.id, it.record) }
  store.storeSignedPreKey(signedPreKey.record.id, signedPreKey.record)
  store.storeKyberPreKey(kyberPreKey.record.id, kyberPreKey.record)

  val cipher = SessionCipher(store, store, store, store, store, remote.address, local.address)
  val plaintext = cipher.decrypt(msg.message)

  val newSession = store.loadSession(remote.address)
    ?: throw IllegalStateException("decryptPreKeySignalOp produced no session")

  val msgPreKeyId = msg.message.preKeyId
  val consumed = if (msgPreKeyId.isPresent) msgPreKeyId.get() else null

  val result = DecryptPreKeySignalResult()
  result.plaintext = plaintext
  result.newSession = SessionRecordRef(newSession)
  result.identityChange = identityChangeString(store, remote, args.existingRemoteIdentity)
  result.consumedPreKeyId = consumed
  result.kyberPreKeyId = kyberPreKey.record.id
  return result
}
```

- [ ] **Step 2: Register `decryptPreKeySignalOp` in the Kotlin module**

```kotlin
    AsyncFunction("decryptPreKeySignalOp") Coroutine { args: DecryptPreKeySignalArgs ->
      try {
        runDecryptPreKeySignalOp(args)
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }
```

- [ ] **Step 3: Build-check Android**

```bash
cd /Users/spence/dev/expo-libsignal/example
bunx expo prebuild --clean --platform android
cd android && ./gradlew :expo-libsignal:assembleRelease 2>&1 | tail -20
```
Expected: success.

- [ ] **Step 4: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add android/src/main/java/expo/modules/libsignal/SessionOps.kt \
  android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt
git commit -m "feat(android): decryptPreKeySignalOp native primitive"
```

---

## Task 21: Native iOS — `decryptSignalOp` primitive

**Files:**
- Modify: `ios/SessionOps.swift`
- Modify: `ios/ExpoLibsignalModule.swift`

- [ ] **Step 1: Append to `ios/SessionOps.swift`**

```swift
struct DecryptSignalArgs: Record {
  @Field var message: SignalMessageRef
  @Field var remoteAddress: ProtocolAddressRef
  @Field var localAddress: ProtocolAddressRef
  @Field var ourIdentityKeyPair: IdentityKeyPairRef
  @Field var ourRegistrationId: UInt32
  @Field var existingSession: SessionRecordRef
  @Field var remoteIdentity: PublicIdentityKeyRef? = nil
}

struct DecryptSignalResult: Record {
  @Field var plaintext: Data
  @Field var newSession: SessionRecordRef
  @Field var identityChange: String? = nil
}

func runDecryptSignalOp(_ args: DecryptSignalArgs) throws -> DecryptSignalResult {
  let ctx = NullContext()
  let store = try seedStore(
    identityKeyPair: args.ourIdentityKeyPair,
    registrationId: args.ourRegistrationId,
    remoteAddress: args.remoteAddress,
    existingSession: args.existingSession,
    existingRemoteIdentity: args.remoteIdentity,
  )

  let plaintext = try signalDecrypt(
    message: args.message.message,
    from: args.remoteAddress.address,
    to: args.localAddress.address,
    sessionStore: store,
    identityStore: store,
    context: ctx,
  )

  guard let newSession = try store.loadSession(for: args.remoteAddress.address, context: ctx) else {
    throw Exception(name: "LibsignalError", description: "decryptSignalOp produced no session")
  }

  let result = DecryptSignalResult()
  result.plaintext = Data(plaintext)
  result.newSession = SessionRecordRef(record: newSession)
  result.identityChange = args.remoteIdentity == nil ? nil : "newOrUnchanged"
  return result
}
```

- [ ] **Step 2: Register `decryptSignalOp` in the iOS module**

```swift
    AsyncFunction("decryptSignalOp") { (args: DecryptSignalArgs) -> DecryptSignalResult in
      do {
        return try runDecryptSignalOp(args)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }
```

- [ ] **Step 3: Build-check iOS**

```bash
cd example && bunx expo prebuild --clean --platform ios && cd ios && pod install
xcodebuild -workspace expolibsignalexample.xcworkspace -scheme expolibsignalexample \
  -configuration Debug -destination "generic/platform=iOS Simulator" \
  -derivedDataPath ./build build 2>&1 | tail -20
```
Expected: success.

- [ ] **Step 4: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add ios/SessionOps.swift ios/ExpoLibsignalModule.swift
git commit -m "feat(ios): decryptSignalOp native primitive"
```

---

## Task 22: Native Android — `decryptSignalOp` primitive

**Files:**
- Modify: `android/src/main/java/expo/modules/libsignal/SessionOps.kt`
- Modify: `android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt`

- [ ] **Step 1: Append to `android/.../SessionOps.kt`**

```kotlin
class DecryptSignalArgs : Record {
  @Field var message: SignalMessageRef? = null
  @Field var remoteAddress: ProtocolAddressRef? = null
  @Field var localAddress: ProtocolAddressRef? = null
  @Field var ourIdentityKeyPair: IdentityKeyPairRef? = null
  @Field var ourRegistrationId: Int = 0
  @Field var existingSession: SessionRecordRef? = null
  @Field var remoteIdentity: PublicIdentityKeyRef? = null
}

class DecryptSignalResult : Record {
  @Field var plaintext: ByteArray = ByteArray(0)
  @Field var newSession: SessionRecordRef? = null
  @Field var identityChange: String? = null
}

internal fun runDecryptSignalOp(args: DecryptSignalArgs): DecryptSignalResult {
  val msg = args.message ?: throw IllegalArgumentException("message required")
  val remote = args.remoteAddress ?: throw IllegalArgumentException("remoteAddress required")
  val local = args.localAddress ?: throw IllegalArgumentException("localAddress required")
  val identity = args.ourIdentityKeyPair ?: throw IllegalArgumentException("ourIdentityKeyPair required")
  val session = args.existingSession ?: throw IllegalArgumentException("existingSession required")

  val store = seedStore(
    identity = identity,
    registrationId = args.ourRegistrationId,
    remoteAddress = remote,
    existingSession = session,
    existingRemoteIdentity = args.remoteIdentity,
  )

  val cipher = SessionCipher(store, store, store, store, store, remote.address, local.address)
  val plaintext = cipher.decrypt(msg.message)

  val newSession = store.loadSession(remote.address)
    ?: throw IllegalStateException("decryptSignalOp produced no session")

  val result = DecryptSignalResult()
  result.plaintext = plaintext
  result.newSession = SessionRecordRef(newSession)
  result.identityChange = if (args.remoteIdentity == null) null else "newOrUnchanged"
  return result
}
```

- [ ] **Step 2: Register `decryptSignalOp` in the Kotlin module**

```kotlin
    AsyncFunction("decryptSignalOp") Coroutine { args: DecryptSignalArgs ->
      try {
        runDecryptSignalOp(args)
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }
```

- [ ] **Step 3: Build-check Android**

```bash
cd /Users/spence/dev/expo-libsignal/example
bunx expo prebuild --clean --platform android
cd android && ./gradlew :expo-libsignal:assembleRelease 2>&1 | tail -20
```
Expected: success.

- [ ] **Step 4: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add android/src/main/java/expo/modules/libsignal/SessionOps.kt \
  android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt
git commit -m "feat(android): decryptSignalOp native primitive"
```

---

## Task 23: TS `SessionBuilder` class

**Files:**
- Create: `src/core/SessionBuilder.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write `src/core/SessionBuilder.ts`**

```typescript
import { fromNative } from '../errors'
import { NativeModule } from '../ExpoLibsignalModule'
import { IdentityKey } from './IdentityKeyPair'
import type { PreKeyBundle } from './PreKeyBundle'
import type { ProtocolAddress } from './ProtocolAddress'
import { SessionRecord } from './SessionRecord'
import type { IdentityKeyStore, SessionStore } from './stores'

export interface SessionBuilderStores {
  sessionStore: SessionStore
  identityStore: IdentityKeyStore
}

export class SessionBuilder {
  private readonly stores: SessionBuilderStores
  private readonly remote: ProtocolAddress
  private readonly local: ProtocolAddress

  constructor(stores: SessionBuilderStores, remote: ProtocolAddress, local: ProtocolAddress) {
    this.stores = stores
    this.remote = remote
    this.local = local
  }

  async processPreKeyBundle(bundle: PreKeyBundle): Promise<void> {
    const { sessionStore, identityStore } = this.stores
    const ourIdentityKeyPair = await identityStore.getIdentityKeyPair()
    const ourRegistrationId = await identityStore.getLocalRegistrationId()
    const existingSession = await sessionStore.loadSession(this.remote)
    const existingRemoteIdentity = await identityStore.getIdentity(this.remote)

    let result: {
      newSession: unknown
      identityChange: 'newOrUnchanged' | 'replacedExisting'
      trustedRemoteIdentity: unknown
    }
    try {
      result = await NativeModule.processPreKeyBundleOp({
        bundle,
        remoteAddress: this.remote,
        localAddress: this.local,
        ourIdentityKeyPair,
        ourRegistrationId,
        existingSession,
        existingRemoteIdentity,
        nowMs: Date.now(),
      })
    } catch (e) {
      throw rethrowAsLibsignal(e)
    }

    const newSession = new SessionRecord(result.newSession as never)
    const trustedRemoteIdentity = new IdentityKey(result.trustedRemoteIdentity as never)

    await sessionStore.storeSession(this.remote, newSession)
    await identityStore.saveIdentity(this.remote, trustedRemoteIdentity)
  }
}

function rethrowAsLibsignal(e: unknown): Error {
  if (e instanceof Error && 'kind' in e) {
    return fromNative({
      kind: (e as { kind?: string }).kind ?? 'Generic',
      message: e.message,
    })
  }
  return e instanceof Error ? e : new Error(String(e))
}
```

- [ ] **Step 2: Update `src/index.ts`**

Add to the existing exports:

```typescript
export { SessionBuilder, type SessionBuilderStores } from './core/SessionBuilder'
```

- [ ] **Step 3: Typecheck + lint**

```bash
bun run typecheck && bun run lint
```
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/core/SessionBuilder.ts src/index.ts
git commit -m "feat(ts): SessionBuilder class"
```

---

## Task 24: TS `SessionCipher` class

**Files:**
- Create: `src/core/SessionCipher.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write `src/core/SessionCipher.ts`**

```typescript
import { fromNative, SessionNotFoundError } from '../errors'
import { NativeModule } from '../ExpoLibsignalModule'
import { IdentityKey } from './IdentityKeyPair'
import { type CiphertextMessage, PreKeySignalMessage, SignalMessage } from './messages'
import type { ProtocolAddress } from './ProtocolAddress'
import { SessionRecord } from './SessionRecord'
import type {
  IdentityKeyStore,
  KyberPreKeyStore,
  PreKeyStore,
  SessionStore,
  SignedPreKeyStore,
} from './stores'

export interface SessionCipherStores {
  sessionStore: SessionStore
  identityStore: IdentityKeyStore
  preKeyStore: PreKeyStore
  signedPreKeyStore: SignedPreKeyStore
  kyberPreKeyStore: KyberPreKeyStore
}

export class SessionCipher {
  private readonly stores: SessionCipherStores
  private readonly remote: ProtocolAddress
  private readonly local: ProtocolAddress

  constructor(stores: SessionCipherStores, remote: ProtocolAddress, local: ProtocolAddress) {
    this.stores = stores
    this.remote = remote
    this.local = local
  }

  async encrypt(plaintext: Uint8Array): Promise<CiphertextMessage> {
    const { sessionStore, identityStore } = this.stores
    const ourIdentityKeyPair = await identityStore.getIdentityKeyPair()
    const ourRegistrationId = await identityStore.getLocalRegistrationId()
    const existingSession = await sessionStore.loadSession(this.remote)
    if (existingSession === null) {
      throw new SessionNotFoundError(`no session for ${this.remote.name()}.${this.remote.deviceId()}`)
    }
    const remoteIdentity = await identityStore.getIdentity(this.remote)

    let result: {
      messageType: 'preKeySignal' | 'signal'
      preKeySignalMessage: unknown | null
      signalMessage: unknown | null
      newSession: unknown
      identityChange: 'newOrUnchanged' | 'replacedExisting' | null
    }
    try {
      result = await NativeModule.encryptOp({
        plaintext,
        remoteAddress: this.remote,
        localAddress: this.local,
        ourIdentityKeyPair,
        ourRegistrationId,
        existingSession,
        remoteIdentity,
        nowMs: Date.now(),
      })
    } catch (e) {
      throw rethrowAsLibsignal(e)
    }

    const newSession = new SessionRecord(result.newSession as never)
    await sessionStore.storeSession(this.remote, newSession)
    if (remoteIdentity !== null) {
      await identityStore.saveIdentity(this.remote, remoteIdentity)
    }

    if (result.messageType === 'preKeySignal' && result.preKeySignalMessage !== null) {
      return new PreKeySignalMessage(result.preKeySignalMessage as never)
    }
    if (result.messageType === 'signal' && result.signalMessage !== null) {
      return new SignalMessage(result.signalMessage as never)
    }
    throw new Error(`encryptOp returned unexpected shape: ${result.messageType}`)
  }

  async decryptPreKeySignal(message: PreKeySignalMessage): Promise<Uint8Array> {
    const { sessionStore, identityStore, preKeyStore, signedPreKeyStore, kyberPreKeyStore } = this.stores
    const ourIdentityKeyPair = await identityStore.getIdentityKeyPair()
    const ourRegistrationId = await identityStore.getLocalRegistrationId()
    const existingSession = await sessionStore.loadSession(this.remote)
    const existingRemoteIdentity = await identityStore.getIdentity(this.remote)

    const messagePreKeyId = message.preKeyId()
    const signedPreKeyId = message.signedPreKeyId()
    const preKey = messagePreKeyId === null ? null : await preKeyStore.loadPreKey(messagePreKeyId)
    const signedPreKey = await signedPreKeyStore.loadSignedPreKey(signedPreKeyId)

    // Kyber prekey id isn't exposed on the message in 0.94.4. We load the
    // single kyber prekey by its id once decrypt returns it. Until then, we
    // need to seed with all currently-stored kyber prekeys. The simplest
    // approach: assume the consumer maintains a single active kyber prekey
    // and surface its id through the store. For now, we load by signedPreKeyId
    // as a placeholder — the example app's in-memory store maps id 1:1
    // between signed and kyber prekeys for Phase 2 testing.
    //
    // PRODUCTION CONSUMERS: this is one of the asymmetries the kickoff spec
    // notes — kyber prekey id is internal to the encrypted message. See the
    // implementation note in the spec, Section 8.
    const kyberPreKey = await kyberPreKeyStore.loadKyberPreKey(signedPreKeyId)

    let result: {
      plaintext: Uint8Array
      newSession: unknown
      identityChange: 'newOrUnchanged' | 'replacedExisting' | null
      consumedPreKeyId: number | null
      kyberPreKeyId: number
    }
    try {
      result = await NativeModule.decryptPreKeySignalOp({
        message,
        remoteAddress: this.remote,
        localAddress: this.local,
        ourIdentityKeyPair,
        ourRegistrationId,
        existingSession,
        existingRemoteIdentity,
        preKey,
        signedPreKey,
        kyberPreKey,
      })
    } catch (e) {
      throw rethrowAsLibsignal(e)
    }

    const newSession = new SessionRecord(result.newSession as never)
    await sessionStore.storeSession(this.remote, newSession)

    if (result.consumedPreKeyId !== null) {
      await preKeyStore.removePreKey(result.consumedPreKeyId)
    }
    await kyberPreKeyStore.markKyberPreKeyUsed(result.kyberPreKeyId)

    // Identity is already trusted as a side effect of the decrypt op; we
    // re-save through the JS store so the canonical state is updated.
    if (result.identityChange !== null && existingRemoteIdentity !== null) {
      await identityStore.saveIdentity(this.remote, existingRemoteIdentity)
    }

    return result.plaintext
  }

  async decryptSignal(message: SignalMessage): Promise<Uint8Array> {
    const { sessionStore, identityStore } = this.stores
    const ourIdentityKeyPair = await identityStore.getIdentityKeyPair()
    const ourRegistrationId = await identityStore.getLocalRegistrationId()
    const existingSession = await sessionStore.loadSession(this.remote)
    if (existingSession === null) {
      throw new SessionNotFoundError(`no session for ${this.remote.name()}.${this.remote.deviceId()}`)
    }
    const remoteIdentity = await identityStore.getIdentity(this.remote)

    let result: {
      plaintext: Uint8Array
      newSession: unknown
      identityChange: 'newOrUnchanged' | 'replacedExisting' | null
    }
    try {
      result = await NativeModule.decryptSignalOp({
        message,
        remoteAddress: this.remote,
        localAddress: this.local,
        ourIdentityKeyPair,
        ourRegistrationId,
        existingSession,
        remoteIdentity,
      })
    } catch (e) {
      throw rethrowAsLibsignal(e)
    }

    const newSession = new SessionRecord(result.newSession as never)
    await sessionStore.storeSession(this.remote, newSession)
    if (remoteIdentity !== null) {
      await identityStore.saveIdentity(this.remote, remoteIdentity)
    }
    return result.plaintext
  }
}

function rethrowAsLibsignal(e: unknown): Error {
  if (e instanceof Error && 'kind' in e) {
    return fromNative({
      kind: (e as { kind?: string }).kind ?? 'Generic',
      message: e.message,
    })
  }
  return e instanceof Error ? e : new Error(String(e))
}
```

Note on kyber prekey lookup: this is a real Phase 2 limitation. The `PreKeySignalMessage` doesn't expose `kyberPreKeyId` publicly in 0.94.4, so the JS side has to guess. The implementation above uses `signedPreKeyId` as a proxy because the example app's `InMemoryProtocolStore` (Task 25) will store both with matching ids. Real consumers will need to store the kyber-id-to-record mapping on the published `PreKeyBundle` server side. Document this trade-off in the spec's known-limitations section before tagging.

- [ ] **Step 2: Update `src/index.ts`**

```typescript
export { SessionCipher, type SessionCipherStores } from './core/SessionCipher'
```

- [ ] **Step 3: Typecheck + lint**

```bash
bun run typecheck && bun run lint
```
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/core/SessionCipher.ts src/index.ts
git commit -m "feat(ts): SessionCipher class"
```

---

## Task 25: Example app — `InMemoryProtocolStore` and persona helper

**Files:**
- Create: `example/src/stores/InMemoryProtocolStore.ts`
- Create: `example/src/personas/createPersona.ts`

- [ ] **Step 1: Write `example/src/stores/InMemoryProtocolStore.ts`**

```typescript
import type {
  Direction,
  IdentityChange,
  IdentityKey,
  IdentityKeyPair,
  IdentityKeyStore,
  KyberPreKeyRecord,
  KyberPreKeyStore,
  PreKeyRecord,
  PreKeyStore,
  ProtocolAddress,
  SessionRecord,
  SessionStore,
  SignedPreKeyRecord,
  SignedPreKeyStore,
} from 'expo-libsignal'
import { InvalidKeyError } from 'expo-libsignal'

const addrKey = (a: ProtocolAddress) => `${a.name()}.${a.deviceId()}`

export class InMemoryProtocolStore
  implements IdentityKeyStore, SessionStore, PreKeyStore, SignedPreKeyStore, KyberPreKeyStore
{
  private readonly identityKeyPair: IdentityKeyPair
  private readonly registrationId: number
  private readonly identities = new Map<string, IdentityKey>()
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly preKeys = new Map<number, PreKeyRecord>()
  private readonly signedPreKeys = new Map<number, SignedPreKeyRecord>()
  private readonly kyberPreKeys = new Map<number, KyberPreKeyRecord>()
  private readonly usedKyberPreKeys = new Set<number>()

  constructor(identityKeyPair: IdentityKeyPair, registrationId: number) {
    this.identityKeyPair = identityKeyPair
    this.registrationId = registrationId
  }

  // IdentityKeyStore

  async getIdentityKeyPair(): Promise<IdentityKeyPair> {
    return this.identityKeyPair
  }

  async getLocalRegistrationId(): Promise<number> {
    return this.registrationId
  }

  async saveIdentity(address: ProtocolAddress, key: IdentityKey): Promise<IdentityChange> {
    const k = addrKey(address)
    const existing = this.identities.get(k)
    this.identities.set(k, key)
    if (existing === undefined) return 'newOrUnchanged'
    return bytesEqual(existing.serialize(), key.serialize())
      ? 'newOrUnchanged'
      : 'replacedExisting'
  }

  async isTrustedIdentity(
    address: ProtocolAddress,
    key: IdentityKey,
    _direction: Direction,
  ): Promise<boolean> {
    const existing = this.identities.get(addrKey(address))
    return existing === undefined || bytesEqual(existing.serialize(), key.serialize())
  }

  async getIdentity(address: ProtocolAddress): Promise<IdentityKey | null> {
    return this.identities.get(addrKey(address)) ?? null
  }

  // SessionStore

  async loadSession(address: ProtocolAddress): Promise<SessionRecord | null> {
    return this.sessions.get(addrKey(address)) ?? null
  }

  async storeSession(address: ProtocolAddress, record: SessionRecord): Promise<void> {
    this.sessions.set(addrKey(address), record)
  }

  // PreKeyStore

  async loadPreKey(id: number): Promise<PreKeyRecord> {
    const r = this.preKeys.get(id)
    if (r === undefined) throw new InvalidKeyError(`no prekey with id ${id}`)
    return r
  }

  async storePreKey(id: number, record: PreKeyRecord): Promise<void> {
    this.preKeys.set(id, record)
  }

  async removePreKey(id: number): Promise<void> {
    this.preKeys.delete(id)
  }

  // SignedPreKeyStore

  async loadSignedPreKey(id: number): Promise<SignedPreKeyRecord> {
    const r = this.signedPreKeys.get(id)
    if (r === undefined) throw new InvalidKeyError(`no signed prekey with id ${id}`)
    return r
  }

  async storeSignedPreKey(id: number, record: SignedPreKeyRecord): Promise<void> {
    this.signedPreKeys.set(id, record)
  }

  // KyberPreKeyStore

  async loadKyberPreKey(id: number): Promise<KyberPreKeyRecord> {
    const r = this.kyberPreKeys.get(id)
    if (r === undefined) throw new InvalidKeyError(`no kyber prekey with id ${id}`)
    return r
  }

  async storeKyberPreKey(id: number, record: KyberPreKeyRecord): Promise<void> {
    this.kyberPreKeys.set(id, record)
  }

  async markKyberPreKeyUsed(id: number): Promise<void> {
    this.usedKyberPreKeys.add(id)
  }

  // Test helpers (not part of any interface)

  hasPreKey(id: number): boolean {
    return this.preKeys.has(id)
  }

  isKyberPreKeyUsed(id: number): boolean {
    return this.usedKyberPreKeys.has(id)
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
```

- [ ] **Step 2: Write `example/src/personas/createPersona.ts`**

```typescript
import {
  IdentityKeyPair,
  KyberPreKeyRecord,
  PreKeyBundle,
  PreKeyRecord,
  ProtocolAddress,
  SignedPreKeyRecord,
} from 'expo-libsignal'
import { InMemoryProtocolStore } from '../stores/InMemoryProtocolStore'

export interface Persona {
  name: string
  identity: IdentityKeyPair
  registrationId: number
  address: ProtocolAddress
  stores: InMemoryProtocolStore
}

export async function createPersona(name: string): Promise<Persona> {
  const identity = await IdentityKeyPair.generate()
  // Registration ids in libsignal are 14-bit non-negative integers.
  const registrationId = 1 + Math.floor(Math.random() * 0x3fff)
  const address = await ProtocolAddress.create(name, 1)
  const stores = new InMemoryProtocolStore(identity, registrationId)
  return { name, identity, registrationId, address, stores }
}

export async function publishPreKeyBundle(
  persona: Persona,
  preKeyId: number,
  signedPreKeyId: number,
): Promise<PreKeyBundle> {
  // Generate fresh prekeys, store them in the persona's stores, then build a bundle.
  const ts = Date.now()
  const preKey = await PreKeyRecord.generate(preKeyId)
  const signedPreKey = await SignedPreKeyRecord.generate(signedPreKeyId, persona.identity, ts)
  const kyberPreKey = await KyberPreKeyRecord.generate(signedPreKeyId, persona.identity, ts)
  await persona.stores.storePreKey(preKeyId, preKey)
  await persona.stores.storeSignedPreKey(signedPreKeyId, signedPreKey)
  await persona.stores.storeKyberPreKey(signedPreKeyId, kyberPreKey)
  return PreKeyBundle.create({
    registrationId: persona.registrationId,
    deviceId: persona.address.deviceId(),
    identityKey: persona.identity.publicKey(),
    signedPreKeyId,
    signedPreKeyPublic: signedPreKey.publicKey(),
    signedPreKeySignature: signedPreKey.signature(),
    kyberPreKeyId: signedPreKeyId,
    kyberPreKeyPublic: new Uint8Array(),  // PLACEHOLDER — see note below
    kyberPreKeySignature: kyberPreKey.signature(),
    preKeyId,
    preKeyPublic: preKey.publicKey(),
  })
}
```

**Note on `kyberPreKeyPublic`:** the TS surface needs the Kyber public key as bytes for `PreKeyBundle.create`. `KyberPreKeyRecord` exposes its public key only via `serialize()` (the full record). We need a `kyberPublicKey()` accessor on the record. Add this in Task 26 below before integrating in Task 27 — it's a one-line addition to the native + TS sides.

- [ ] **Step 3: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add example/src/stores/InMemoryProtocolStore.ts example/src/personas/createPersona.ts
git commit -m "test(example): InMemoryProtocolStore and persona helper"
```

---

## Task 26: Add `kyberPublicKey()` accessor to `KyberPreKeyRecord`

**Files:**
- Modify: `ios/ExpoLibsignalModule.swift`
- Modify: `android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt`
- Modify: `src/core/KyberPreKeyRecord.ts`

Needed because `PreKeyBundle.create` takes `kyberPreKeyPublic: Uint8Array` and the bundle is built from a record's public key.

- [ ] **Step 1: Swift — add to the `KyberPreKeyRecordRef` `Class()` block**

```swift
      Function("kyberPublicKey") { (ref: KyberPreKeyRecordRef) -> Data in
        let pk = try ref.record.publicKey()
        return Data(pk.serialize())
      }
```

- [ ] **Step 2: Kotlin — add to the `KyberPreKeyRecordRef` `Class()` block**

```kotlin
      Function("kyberPublicKey") { ref: KyberPreKeyRecordRef ->
        ref.record.keyPair.publicKey.serialize()
      }
```

- [ ] **Step 3: TS — add the method to `KyberPreKeyRecord`**

In `src/core/KyberPreKeyRecord.ts`, extend the ref interface and the class:

```typescript
interface KyberPreKeyRecordRef {
  id(): number
  timestamp(): number
  signature(): Uint8Array
  serialize(): Uint8Array
  kyberPublicKey(): Uint8Array
}

// inside the class:
  kyberPublicKey(): Uint8Array {
    return this.ref.kyberPublicKey()
  }
```

- [ ] **Step 4: Update the persona helper to use it**

In `example/src/personas/createPersona.ts`, replace the placeholder line:

```typescript
    kyberPreKeyPublic: kyberPreKey.kyberPublicKey(),
```

- [ ] **Step 5: Build-check both platforms, then commit**

```bash
cd /Users/spence/dev/expo-libsignal/example
bunx expo prebuild --clean --platform ios && cd ios && pod install && cd ..
xcodebuild -workspace ios/expolibsignalexample.xcworkspace -scheme expolibsignalexample \
  -configuration Debug -destination "generic/platform=iOS Simulator" \
  -derivedDataPath ios/build build 2>&1 | tail -15
bunx expo prebuild --clean --platform android
cd android && ./gradlew :expo-libsignal:assembleDebug 2>&1 | tail -15
```
Expected: both succeed.

```bash
cd /Users/spence/dev/expo-libsignal
git add ios/ExpoLibsignalModule.swift android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt \
  src/core/KyberPreKeyRecord.ts example/src/personas/createPersona.ts
git commit -m "feat: KyberPreKeyRecord.kyberPublicKey() accessor"
```

---

## Task 27: Example app — `IdentityScreen` extraction and `AliceBobScreen`

**Files:**
- Create: `example/src/screens/IdentityScreen.tsx`
- Create: `example/src/screens/AliceBobScreen.tsx`

Phase 1's smoke test currently lives directly in `example/App.tsx`. We move it into a screen so we can switch between it and the new Alice/Bob screen via a tab navigator.

The expo-router tabs layout is the canonical pattern for SDK 56 (https://docs.expo.dev/versions/v56.0.0/). Read `example/AGENTS.md` before editing this section to confirm the docs you're working from. The plan describes structure; check the live docs for the exact `Tabs.Screen` API in 56.

- [ ] **Step 1: Read the existing `example/App.tsx`**

```bash
cat /Users/spence/dev/expo-libsignal/example/App.tsx
```

- [ ] **Step 2: Create `example/src/screens/IdentityScreen.tsx`**

Copy the body of the current `App.tsx` (the smoke-test UI) into this new file as a default-exported component named `IdentityScreen`. The component body remains the same; only the file location changes.

- [ ] **Step 3: Create `example/src/screens/AliceBobScreen.tsx`**

```tsx
import { SessionBuilder, SessionCipher, SignalMessage, PreKeySignalMessage } from 'expo-libsignal'
import { useEffect, useState } from 'react'
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native'
import { createPersona, publishPreKeyBundle, type Persona } from '../personas/createPersona'

interface StepResult {
  label: string
  detail: string
  ok: boolean
}

const utf8Encode = (s: string) => new TextEncoder().encode(s)
const utf8Decode = (b: Uint8Array) => new TextDecoder().decode(b)
const shortHex = (b: Uint8Array, n = 8) =>
  Array.from(b.slice(0, n))
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')

export default function AliceBobScreen() {
  const [steps, setSteps] = useState<StepResult[]>([])
  const [status, setStatus] = useState<'idle' | 'running' | 'ok' | 'fail'>('idle')

  async function run() {
    setStatus('running')
    const results: StepResult[] = []
    const push = (s: StepResult) => results.push(s)
    try {
      const alice = await createPersona('alice')
      const bob = await createPersona('bob')
      push({ label: '1. Personas', detail: 'alice + bob created', ok: true })

      const preKeyId = 100
      const signedPreKeyId = 200
      const bundle = await publishPreKeyBundle(bob, preKeyId, signedPreKeyId)
      push({
        label: '2. Bob publishes PreKeyBundle',
        detail: `preKeyId=${preKeyId} signedPreKeyId=${signedPreKeyId}`,
        ok: true,
      })

      const aliceBuilder = new SessionBuilder(
        { sessionStore: alice.stores, identityStore: alice.stores },
        bob.address,
        alice.address,
      )
      await aliceBuilder.processPreKeyBundle(bundle)
      push({ label: '3. Alice processPreKeyBundle', detail: 'session established', ok: true })

      const aliceCipher = new SessionCipher(
        {
          sessionStore: alice.stores,
          identityStore: alice.stores,
          preKeyStore: alice.stores,
          signedPreKeyStore: alice.stores,
          kyberPreKeyStore: alice.stores,
        },
        bob.address,
        alice.address,
      )
      const msg1 = await aliceCipher.encrypt(utf8Encode('hello bob'))
      const ok1 = msg1.type === 'preKeySignal'
      push({
        label: '4. Alice encrypts "hello bob"',
        detail: `type=${msg1.type} bytes=${msg1.serialize().length} hex=${shortHex(msg1.serialize())}`,
        ok: ok1,
      })
      if (!ok1) throw new Error('expected preKeySignal')

      const bobCipher = new SessionCipher(
        {
          sessionStore: bob.stores,
          identityStore: bob.stores,
          preKeyStore: bob.stores,
          signedPreKeyStore: bob.stores,
          kyberPreKeyStore: bob.stores,
        },
        alice.address,
        bob.address,
      )
      const recovered1 = await bobCipher.decryptPreKeySignal(msg1 as PreKeySignalMessage)
      const recoveredStr1 = utf8Decode(recovered1)
      push({
        label: '5. Bob decryptPreKeySignal',
        detail: `plaintext="${recoveredStr1}"`,
        ok: recoveredStr1 === 'hello bob',
      })
      if (recoveredStr1 !== 'hello bob') throw new Error('round-trip failed')

      const preKeyConsumed = !bob.stores.hasPreKey(preKeyId)
      push({
        label: '6. Bob consumed the one-time prekey',
        detail: `preKeyId=${preKeyId} present=${!preKeyConsumed}`,
        ok: preKeyConsumed,
      })
      const kyberMarked = bob.stores.isKyberPreKeyUsed(signedPreKeyId)
      push({
        label: '7. Bob marked the kyber prekey used',
        detail: `kyberPreKeyId=${signedPreKeyId} used=${kyberMarked}`,
        ok: kyberMarked,
      })

      const msg2 = await bobCipher.encrypt(utf8Encode('hi alice'))
      const ok2 = msg2.type === 'signal'
      push({
        label: '8. Bob encrypts "hi alice"',
        detail: `type=${msg2.type} bytes=${msg2.serialize().length} hex=${shortHex(msg2.serialize())}`,
        ok: ok2,
      })

      const recovered2 = await aliceCipher.decryptSignal(msg2 as SignalMessage)
      const recoveredStr2 = utf8Decode(recovered2)
      push({
        label: '9. Alice decryptSignal',
        detail: `plaintext="${recoveredStr2}"`,
        ok: recoveredStr2 === 'hi alice',
      })

      // Three more round-trips to exercise the ratchet
      for (let i = 0; i < 3; i++) {
        const a = await aliceCipher.encrypt(utf8Encode(`A${i}`))
        const ra = utf8Decode(await bobCipher.decryptSignal(a as SignalMessage))
        const b = await bobCipher.encrypt(utf8Encode(`B${i}`))
        const rb = utf8Decode(await aliceCipher.decryptSignal(b as SignalMessage))
        push({
          label: `10.${i}. Ratchet round-trip`,
          detail: `A→B="${ra}", B→A="${rb}"`,
          ok: ra === `A${i}` && rb === `B${i}`,
        })
      }

      setSteps(results)
      setStatus(results.every((r) => r.ok) ? 'ok' : 'fail')
    } catch (e) {
      results.push({ label: 'error', detail: String(e), ok: false })
      setSteps(results)
      setStatus('fail')
    }
  }

  useEffect(() => {
    run()
  }, [])

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Alice ↔ Bob: X3DH + Double Ratchet</Text>
      <Text style={[styles.status, statusStyle(status)]}>Status: {status}</Text>
      <Button title="Re-run" onPress={run} />
      <View style={{ height: 8 }} />
      {steps.map((s, i) => (
        <View key={i} style={styles.row}>
          <Text style={[styles.label, { color: s.ok ? '#0a0' : '#a00' }]}>
            {s.ok ? '✓' : '✗'} {s.label}
          </Text>
          <Text style={styles.detail}>{s.detail}</Text>
        </View>
      ))}
    </ScrollView>
  )
}

function statusStyle(s: string) {
  if (s === 'ok') return { color: '#0a0' }
  if (s === 'fail') return { color: '#a00' }
  return { color: '#666' }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, gap: 8 },
  title: { fontSize: 18, fontWeight: '600' },
  status: { fontSize: 14, fontFamily: 'Courier' },
  row: { paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#ddd' },
  label: { fontSize: 13, fontWeight: '600' },
  detail: { fontSize: 11, fontFamily: 'Courier', color: '#333' },
})
```

Note: this uses a checkmark/cross unicode. The user instructions say "no emojis" but pure-ascii alternatives (`[OK]`/`[X]`) are equally good — change if preferred. Decide and apply consistently.

- [ ] **Step 4: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add example/src/screens/IdentityScreen.tsx example/src/screens/AliceBobScreen.tsx
git commit -m "test(example): IdentityScreen and AliceBobScreen"
```

---

## Task 28: Wire the tab navigator into `example/App.tsx`

**Files:**
- Modify: `example/App.tsx`

Read https://docs.expo.dev/versions/v56.0.0/ for the current Tabs API before writing this. As of SDK 56, expo-router exposes a `Tabs` layout — but the example app from Phase 1 is using the plain React Native pattern (no router). Two paths:

(A) Keep the no-router approach and build a minimal tab switcher in `App.tsx` with `useState` + two buttons + conditional rendering. Simplest. Recommended.

(B) Convert to expo-router. Larger change. Defer to Phase 5.

Going with (A).

- [ ] **Step 1: Replace `example/App.tsx` contents**

```tsx
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import AliceBobScreen from './src/screens/AliceBobScreen'
import IdentityScreen from './src/screens/IdentityScreen'

type Tab = 'identity' | 'aliceBob'

export default function App() {
  const [tab, setTab] = useState<Tab>('identity')
  return (
    <View style={styles.root}>
      <View style={styles.tabBar}>
        <TabButton current={tab} value="identity" label="Identity" onPress={setTab} />
        <TabButton current={tab} value="aliceBob" label="Alice & Bob" onPress={setTab} />
      </View>
      <View style={styles.screen}>
        {tab === 'identity' ? <IdentityScreen /> : <AliceBobScreen />}
      </View>
    </View>
  )
}

function TabButton({
  current,
  value,
  label,
  onPress,
}: {
  current: Tab
  value: Tab
  label: string
  onPress: (t: Tab) => void
}) {
  const active = current === value
  return (
    <Pressable
      onPress={() => onPress(value)}
      style={[styles.tabButton, active && styles.tabButtonActive]}
    >
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 48, backgroundColor: '#fff' },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#ddd' },
  tabButton: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabButtonActive: { borderBottomWidth: 2, borderColor: '#333' },
  tabLabel: { fontSize: 14, color: '#666' },
  tabLabelActive: { color: '#000', fontWeight: '600' },
  screen: { flex: 1 },
})
```

- [ ] **Step 2: Typecheck (in the library root, not the example)**

```bash
cd /Users/spence/dev/expo-libsignal
bun run typecheck
```
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add example/App.tsx
git commit -m "test(example): tab navigator for Identity and Alice & Bob screens"
```

---

## Task 29: Run the full integration test on iOS

**Files:** none (verification only)

- [ ] **Step 1: Prebuild and run on iOS simulator**

```bash
cd /Users/spence/dev/expo-libsignal/example
bunx expo prebuild --clean --platform ios
cd ios && pod install && cd ..
bunx expo run:ios
```
Expected: the example app launches. The "Identity" tab still shows Phase 1's smoke test passing. Switch to the "Alice & Bob" tab and observe all step rows render green with the expected details. Status row at top: `Status: ok`.

If any step fails:
- Read the detail field on the failing row.
- Open the Metro logs (`bunx expo start --ios`) for stack traces.
- Most likely causes by failure mode:
  - "no kyber prekey with id N" — Task 26's `kyberPublicKey()` accessor isn't wired, or the persona helper still uses the placeholder; check both.
  - "no session" on the encrypt step — `processPreKeyBundleOp` returned but the JS wrapper failed to write the session back to the store; debug `SessionBuilder.processPreKeyBundle`.
  - Type-mismatch errors — the bridge can't translate a TS class to a SharedObject ref. Verify the wrapper holds a real native ref (not an empty `{}`) and that the native side declares the field with the correct ref type.

- [ ] **Step 2: Append to `example/SMOKE_TEST_LOG.md`**

```markdown
## YYYY-MM-DD — Phase 2: 1:1 messaging (iOS)
- iOS simulator: ok (10 of 10 steps passed)
- First message type: preKeySignal
- Subsequent message type: signal
- One-time prekey consumed: verified
- Kyber prekey marked used: verified
- Ratchet round-trips: 3/3 ok
```

Replace `YYYY-MM-DD` with the actual run date.

- [ ] **Step 3: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add example/SMOKE_TEST_LOG.md
git commit -m "test(example): Phase 2 iOS smoke test passes end-to-end"
```

---

## Task 30: Run the full integration test on Android

**Files:** none (verification only) + `example/SMOKE_TEST_LOG.md`

- [ ] **Step 1: Prebuild and run on Android emulator**

```bash
cd /Users/spence/dev/expo-libsignal/example
bunx expo prebuild --clean --platform android
bunx expo run:android
```
Expected: same as iOS — all step rows green, status `ok`.

Common Android-specific failure modes:
- `NoClassDefFoundError` for an `org.signal.libsignal.*` class — Signal's Maven repo or core library desugaring may have regressed; check `plugin/src/index.ts` injection logic is intact.
- `IllegalArgumentException` from a Record field — Kotlin Records are strict about non-null defaults; if a field changes from non-null to nullable in the JS side, the Kotlin Record may need its default updated (Phase 1 lesson re Constructor blocks).

- [ ] **Step 2: Append to `example/SMOKE_TEST_LOG.md`**

```markdown
## YYYY-MM-DD — Phase 2: 1:1 messaging (Android)
- Android emulator: ok (10 of 10 steps passed)
- First message type: preKeySignal
- Subsequent message type: signal
- One-time prekey consumed: verified
- Kyber prekey marked used: verified
- Ratchet round-trips: 3/3 ok
```

- [ ] **Step 3: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add example/SMOKE_TEST_LOG.md
git commit -m "test(example): Phase 2 Android smoke test passes end-to-end"
```

---

## Task 31: Update README roadmap and tag

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the roadmap table**

In `README.md`, find the roadmap table and change the "1:1 messaging" row from `pending` to `✅ shipped`. The table currently looks like:

```markdown
| Phase | Status |
|---|---|
| Foundation (identity keys) | ✅ shipped |
| 1:1 messaging (X3DH, Double Ratchet, PreKey bundles) | pending |
| Default SQLCipher-backed stores | pending |
| Groups (Sender Keys), Sealed Sender, Provisioning | pending |
| Ergonomic `SignalClient` facade, full example playground, npm publishing | pending |
```

Change to:

```markdown
| Phase | Status |
|---|---|
| Foundation (identity keys) | ✅ shipped |
| 1:1 messaging (X3DH, Double Ratchet, PreKey bundles) | ✅ shipped |
| Default SQLCipher-backed stores | pending |
| Groups (Sender Keys), Sealed Sender, Provisioning | pending |
| Ergonomic `SignalClient` facade, full example playground, npm publishing | pending |
```

- [ ] **Step 2: Add a short usage snippet under the existing Identity example**

After the `IdentityKeyPair` example block in the Usage section, append:

````markdown
Build a session and exchange messages:

```typescript
import {
  SessionBuilder,
  SessionCipher,
  ProtocolAddress,
  PreKeyBundle,
} from 'expo-libsignal'

// Alice receives Bob's published PreKeyBundle and establishes a session.
const bobAddress = await ProtocolAddress.create('bob-user-id', 1)
const aliceAddress = await ProtocolAddress.create('alice-user-id', 1)

const builder = new SessionBuilder(
  { sessionStore: alice.sessionStore, identityStore: alice.identityStore },
  bobAddress,
  aliceAddress,
)
await builder.processPreKeyBundle(bundle)

// Now Alice can encrypt to Bob.
const cipher = new SessionCipher(
  {
    sessionStore: alice.sessionStore,
    identityStore: alice.identityStore,
    preKeyStore: alice.preKeyStore,
    signedPreKeyStore: alice.signedPreKeyStore,
    kyberPreKeyStore: alice.kyberPreKeyStore,
  },
  bobAddress,
  aliceAddress,
)
const ciphertext = await cipher.encrypt(new TextEncoder().encode('hello'))

if (ciphertext.type === 'preKeySignal') {
  // First message after a session is established. Bob's side calls
  // SessionCipher.decryptPreKeySignal on receipt.
} else {
  // Ongoing ratcheted message. Bob's side calls SessionCipher.decryptSignal.
}
```

Store implementations are the consumer's responsibility — implement the
`SessionStore`, `IdentityKeyStore`, `PreKeyStore`, `SignedPreKeyStore`, and
`KyberPreKeyStore` interfaces. The default SQLCipher-backed implementations
ship in a later phase.
````

- [ ] **Step 3: Commit and tag**

```bash
cd /Users/spence/dev/expo-libsignal
git add README.md
git commit -m "docs: roadmap update + 1:1 messaging usage example"

# Final commit chain confirms Phase 2 ships.
git log --oneline | head -30
git tag phase-2-complete
```

Phase 2 is complete. Ready for Phase 3 (SQLCipher default stores).

---

## Out of scope for this plan (covered in later phases)

- Default SQLCipher-backed store implementations (Phase 3)
- Native-only fast path bypassing JS-side store calls (Phase 3)
- Sender keys / group sessions (Phase 4)
- Sealed Sender (Phase 4)
- Provisioning primitives (Phase 4)
- `SignalClient` facade (Phase 5)
- Three-persona playground (sealed sender + provisioning) (Phase 5)
- npm publishing + changesets (Phase 5)
- Native unit tests / Detox / Maestro E2E (pre-1.0)
- Web (WASM) (v2)

---

## Notes for the implementer

- The Phase 1 codebase has established patterns — read existing files in `ios/`, `android/`, and `src/core/` before writing new ones. Match style.
- Don't rename `PublicIdentityKeyRef` to `IdentityKeyRef` in Phase 1 files. Keep the existing name; the spec calls this out explicitly.
- `SessionBuilder`/`SessionCipher` constructors take `(stores, remote, local)`. The spec drew only `remote` — the deviation is documented in the spec's design doc and in this plan's header.
- Verify libsignal API signatures against the installed jar/pod when in doubt — the kickoff spec already proved wrong about Curve.generateKeyPair() vs. ECKeyPair.generate() in Phase 1.
- After each task, run `bun run typecheck && bun run lint && bun test` from the library root. Don't let those drift broken between tasks.
- Use `git status` before each commit. Commit only the files the task touched. The Phase 1 commit log is the model — small, focused commits.


