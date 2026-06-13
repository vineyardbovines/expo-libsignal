# expo-libsignal Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Default SQLCipher-backed implementations of the five store interfaces (pluggable, persisted, encrypted at rest), plus the kyber prekey id fix at the native boundary.

**Architecture:** JS-side `SQLCipherProtocolStore` over op-sqlite (JSI), exposed via a new `expo-libsignal/stores` subpath so the main entry never references the optional peers. Native ops stay stateless; `decryptPreKeySignalOp`'s single kyber arg becomes a length-prefixed blob of all kyber records, and a recording subclass of the per-call in-memory store captures the id libsignal actually used. DB key is 32 random bytes (new native `generateRandomBytes`), hex-encoded in expo-secure-store.

**Tech Stack:** TypeScript, Expo Modules (Swift/Kotlin), libsignal 0.94.4, @op-engineering/op-sqlite (SQLCipher build), expo-secure-store, jest + ts-jest, biome.

**Spec:** `docs/superpowers/specs/2026-06-12-expo-libsignal-phase-3-design.md`

**Standing gotchas (from Phases 1–2, all verified; do not relearn):**
- Incoming Records cross the Android boundary as plain maps: primitives only. Byte payloads are positional `Uint8Array` args. Result Records may carry bytes. Max 8 args per function; `decryptPreKeySignalOp` uses all 8.
- After `bun run build`, Metro serves stale bundles for the symlinked `build/`; restart with `bunx expo start --clear`.
- For local iOS builds, strip Homebrew gnubin from PATH first: `export PATH=$(echo "$PATH" | tr ':' '\n' | grep -v gnubin | paste -sd: -)`
- Kotlin `Class()` blocks need a throwing `Constructor { }`. Factories are module-level.
- Upstream asymmetry: `SessionBuilder(..., remote, local)` but `SessionCipher(..., local, remote)`.
- Run `bun run typecheck && bun run lint && bun test` between tasks.
- Do NOT start Metro, simulators, or emulators without an explicit go-ahead from spence (Task 15 requires one).

---

### Task 1: recordList framing helper

Length-prefixed framing so a variable number of kyber prekey records travels as one positional `Uint8Array`.

**Files:**
- Create: `src/core/recordList.ts`
- Test: `src/__tests__/recordList.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/recordList.test.ts
import { decodeRecordList, encodeRecordList } from '../core/recordList'

describe('encodeRecordList / decodeRecordList', () => {
  test('round-trips an empty list', () => {
    expect(encodeRecordList([])).toEqual(new Uint8Array(0))
    expect(decodeRecordList(new Uint8Array(0))).toEqual([])
  })

  test('encodes a single record with a big-endian u32 length prefix', () => {
    const r = new Uint8Array([1, 2, 3])
    const blob = encodeRecordList([r])
    expect(blob).toEqual(new Uint8Array([0, 0, 0, 3, 1, 2, 3]))
    expect(decodeRecordList(blob)).toEqual([r])
  })

  test('round-trips multiple records including an empty one', () => {
    const records = [new Uint8Array([9]), new Uint8Array(0), new Uint8Array([7, 8])]
    expect(decodeRecordList(encodeRecordList(records))).toEqual(records)
  })

  test('decode throws on truncated input', () => {
    expect(() => decodeRecordList(new Uint8Array([0, 0]))).toThrow('truncated')
    expect(() => decodeRecordList(new Uint8Array([0, 0, 0, 5, 1]))).toThrow('truncated')
  })
})
```

- [ ] **Step 2: Run it; expect failure**

Run: `bun test src/__tests__/recordList.test.ts`
Expected: FAIL (cannot find `../core/recordList`)

- [ ] **Step 3: Implement**

```ts
// src/core/recordList.ts

// Length-prefixed record framing for the native op boundary: byte payloads
// must be positional Uint8Array args and decryptPreKeySignalOp is at the
// 8-argument ceiling, so a variable number of kyber prekey records travels
// as a single blob. Each record is prefixed with a big-endian u32 length.
// Swift/Kotlin have matching decoders (decodeRecordList in SessionOps).

export function encodeRecordList(records: Uint8Array[]): Uint8Array {
  let total = 0
  for (const r of records) total += 4 + r.length
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  let offset = 0
  for (const r of records) {
    view.setUint32(offset, r.length, false)
    out.set(r, offset + 4)
    offset += 4 + r.length
  }
  return out
}

export function decodeRecordList(blob: Uint8Array): Uint8Array[] {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
  const records: Uint8Array[] = []
  let offset = 0
  while (offset < blob.length) {
    if (offset + 4 > blob.length) throw new Error('recordList: truncated length prefix')
    const len = view.getUint32(offset, false)
    offset += 4
    if (offset + len > blob.length) throw new Error('recordList: truncated record')
    records.push(blob.slice(offset, offset + len))
    offset += len
  }
  return records
}
```

- [ ] **Step 4: Run tests; expect pass**

Run: `bun test src/__tests__/recordList.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Full check and commit**

```bash
bun run typecheck && bun run lint && bun test
git add src/core/recordList.ts src/__tests__/recordList.test.ts
git commit -m "feat(ts): length-prefixed record list framing for the op boundary"
```

---

### Task 2: KyberPreKeyStore.loadKyberPreKeys + SessionCipher kyber fix (TS side)

Breaking interface change (0.x): kyber prekeys are loaded in bulk and the op returns the id actually used (nullable).

**Files:**
- Modify: `src/core/stores.ts` (KyberPreKeyStore)
- Modify: `src/core/SessionCipher.ts` (decryptPreKeySignal)
- Test: `src/__tests__/nativeBoundary.test.ts`

- [ ] **Step 1: Update the boundary test first**

In `src/__tests__/nativeBoundary.test.ts`:

Add a second kyber sentinel next to the existing ones (after line 47's `kyberPreKeyBytes`):

```ts
const kyberPreKey2Bytes = new Uint8Array([14])
```

and after `kyberPreKeyRef` (line 66):

```ts
const kyberPreKey2Ref = { serialize: () => kyberPreKey2Bytes }
```

Add the import of the framing helper at the top of the import block:

```ts
import { encodeRecordList } from '../core/recordList'
```

In `makeStores`, replace the `kyberPreKeyStore` object with:

```ts
    kyberPreKeyStore: {
      loadKyberPreKey: jest.fn(async () => new KyberPreKeyRecord(kyberPreKeyRef as never)),
      loadKyberPreKeys: jest.fn(async () => [
        new KyberPreKeyRecord(kyberPreKeyRef as never),
        new KyberPreKeyRecord(kyberPreKey2Ref as never),
      ]),
      storeKyberPreKey: jest.fn(async () => {}),
      markKyberPreKeyUsed: jest.fn(async () => {}),
    },
```

Replace the `decryptPreKeySignal sends bytes for message and prekeys` test body's kyber assertions: the mocked result keeps `kyberPreKeyId: 200`, and the arg assertions become:

```ts
    expect(preKeyArg).toBe(preKeyBytes)
    expect(spkArg).toBe(signedPreKeyBytes)
    expect(kyberArg).toEqual(encodeRecordList([kyberPreKeyBytes, kyberPreKey2Bytes]))
    expect(stores.kyberPreKeyStore.loadKyberPreKeys).toHaveBeenCalled()

    expect(stores.preKeyStore.removePreKey).toHaveBeenCalledWith(100)
    expect(stores.kyberPreKeyStore.markKyberPreKeyUsed).toHaveBeenCalledWith(200)
```

(`toEqual`, not `toBe`: the blob is constructed by SessionCipher.)

Add a new test after it, inside the same `describe('SessionCipher ops')`:

```ts
  test('decryptPreKeySignal skips markKyberPreKeyUsed when kyberPreKeyId is null', async () => {
    const stores = makeStores({ existingSession: new SessionRecord(sessionRef as never) })
    NativeModule.decryptPreKeySignalOp.mockResolvedValueOnce({
      plaintext: new Uint8Array([1]),
      newSession: newSessionBytes,
      identityChange: null,
      consumedPreKeyId: null,
      kyberPreKeyId: null,
    })
    await makeCipher(stores).decryptPreKeySignal(
      new PreKeySignalMessage(preKeySignalMsgRef as never),
    )
    expect(stores.kyberPreKeyStore.markKyberPreKeyUsed).not.toHaveBeenCalled()
    expect(stores.preKeyStore.removePreKey).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run it; expect failure**

Run: `bun test src/__tests__/nativeBoundary.test.ts`
Expected: FAIL (kyberArg is still the single record's bytes; loadKyberPreKeys never called). Typecheck would also fail until Step 3.

- [ ] **Step 3: Change the interface**

In `src/core/stores.ts`, replace the `KyberPreKeyStore` interface:

```ts
export interface KyberPreKeyStore {
  loadKyberPreKey(id: number): Promise<KyberPreKeyRecord>
  /**
   * Return every stored kyber prekey. libsignal 0.94.4 does not expose the
   * kyber prekey id on PreKeySignalMessage, so decryptPreKeySignal seeds the
   * native op with all of them and libsignal resolves the id internally.
   * Matches upstream libsignal-java's KyberPreKeyStore.loadKyberPreKeys().
   */
  loadKyberPreKeys(): Promise<KyberPreKeyRecord[]>
  storeKyberPreKey(id: number, record: KyberPreKeyRecord): Promise<void>
  markKyberPreKeyUsed(id: number): Promise<void>
}
```

- [ ] **Step 4: Rewrite SessionCipher.decryptPreKeySignal**

In `src/core/SessionCipher.ts`:

Add the import:

```ts
import { encodeRecordList } from './recordList'
```

Replace the body of `decryptPreKeySignal` from the `messagePreKeyId` line through the `markKyberPreKeyUsed` call (this deletes the placeholder comment block and the `loadKyberPreKey(signedPreKeyId)` hack):

```ts
    const messagePreKeyId = message.preKeyId()
    const signedPreKeyId = message.signedPreKeyId()
    const preKey = messagePreKeyId === null ? null : await preKeyStore.loadPreKey(messagePreKeyId)
    const signedPreKey = await signedPreKeyStore.loadSignedPreKey(signedPreKeyId)

    // The kyber prekey id is not exposed on PreKeySignalMessage in libsignal
    // 0.94.4, so we seed the op with every stored kyber prekey (framed into
    // one positional blob) and libsignal resolves the id internally. The op
    // reports back which id it marked used; null means the decrypt completed
    // without consuming one (e.g. replay against an existing session).
    const kyberPreKeys = await kyberPreKeyStore.loadKyberPreKeys()
    const kyberPreKeysBlob = encodeRecordList(kyberPreKeys.map((k) => k.serialize()))

    let result: {
      plaintext: Uint8Array
      newSession: Uint8Array
      identityChange: 'newOrUnchanged' | 'replacedExisting' | null
      consumedPreKeyId: number | null
      kyberPreKeyId: number | null
    }
    try {
      result = await NativeModule.decryptPreKeySignalOp(
        this.opConfig(ourRegistrationId),
        message.serialize(),
        ourIdentityKeyPair.serialize(),
        existingSession ? existingSession.serialize() : null,
        existingRemoteIdentity ? existingRemoteIdentity.serialize() : null,
        preKey ? preKey.serialize() : null,
        signedPreKey.serialize(),
        kyberPreKeysBlob,
      )
    } catch (e) {
      throw rethrowAsLibsignal(e)
    }

    const newSession = await SessionRecord.deserialize(result.newSession)
    await sessionStore.storeSession(this.remote, newSession)

    if (result.consumedPreKeyId !== null) {
      await preKeyStore.removePreKey(result.consumedPreKeyId)
    }
    if (result.kyberPreKeyId !== null) {
      await kyberPreKeyStore.markKyberPreKeyUsed(result.kyberPreKeyId)
    }
```

Keep the identity re-save block and `return result.plaintext` that follow.

- [ ] **Step 5: Run tests; expect pass**

Run: `bun run typecheck && bun test`
Expected: PASS. Note: `example/` has its own tsconfig and is NOT covered by root typecheck; its `InMemoryProtocolStore` is updated in Task 11.

- [ ] **Step 6: Lint and commit**

```bash
bun run lint
git add src/core/stores.ts src/core/SessionCipher.ts src/__tests__/nativeBoundary.test.ts
git commit -m "feat(ts)!: KyberPreKeyStore.loadKyberPreKeys; decrypt seeds all kyber prekeys"
```

---

### Task 3: iOS decryptPreKeySignalOp revision

**Files:**
- Modify: `ios/SessionOps.swift`
- Modify: `ios/ExpoLibsignalModule.swift:356-371` (decryptPreKeySignalOp signature)

- [ ] **Step 1: Verify the override signature against the installed pod**

Run: `grep -n "open class InMemorySignalProtocolStore\|open func markKyberPreKeyUsed" example/ios/Pods/LibSignalClient/swift/Sources/LibSignalClient/DataStoreInMemory.swift`
Expected: the class is `open class`, and the method is `open func markKyberPreKeyUsed(id: UInt32, signedPreKeyId: UInt32, baseKey: PublicKey, context: StoreContext) throws`. If the signature differs, adapt the override in Step 3 to match exactly.

- [ ] **Step 2: Make the result field nullable**

In `ios/SessionOps.swift`, in `DecryptPreKeySignalResult` (line 43), change:

```swift
  @Field var kyberPreKeyId: UInt32? = nil
```

- [ ] **Step 3: Add the recording store and the decoder**

In `ios/SessionOps.swift`, after the `seedStore` function:

```swift
// Captures which kyber prekey libsignal marks used during PQ decrypt — the
// message does not expose the id in 0.94.4, so this callback is the only
// place the real id surfaces.
final class RecordingSignalProtocolStore: InMemorySignalProtocolStore {
  var usedKyberPreKeyId: UInt32?

  override func markKyberPreKeyUsed(id: UInt32, signedPreKeyId: UInt32, baseKey: PublicKey, context: StoreContext) throws {
    usedKyberPreKeyId = id
    try super.markKyberPreKeyUsed(id: id, signedPreKeyId: signedPreKeyId, baseKey: baseKey, context: context)
  }
}

// Mirror of src/core/recordList.ts: big-endian u32 length prefix per record.
func decodeRecordList(_ blob: Data) throws -> [Data] {
  let bytes = [UInt8](blob)
  var records: [Data] = []
  var offset = 0
  while offset < bytes.count {
    guard offset + 4 <= bytes.count else {
      throw Exception(name: "LibsignalError", description: "recordList: truncated length prefix")
    }
    let len = (Int(bytes[offset]) << 24) | (Int(bytes[offset + 1]) << 16) | (Int(bytes[offset + 2]) << 8) | Int(bytes[offset + 3])
    offset += 4
    guard offset + len <= bytes.count else {
      throw Exception(name: "LibsignalError", description: "recordList: truncated record")
    }
    records.append(Data(bytes[offset..<(offset + len)]))
    offset += len
  }
  return records
}
```

- [ ] **Step 4: Rewrite runDecryptPreKeySignalOp**

Replace the whole function with (changes: `kyberPreKey: Data` becomes `kyberPreKeys: Data`, the store is a `RecordingSignalProtocolStore` seeded inline, all kyber records are stored, and the result id comes from the recording):

```swift
func runDecryptPreKeySignalOp(
  config: SessionOpConfig,
  message: Data,
  ourIdentityKeyPair: Data,
  existingSession: Data?,
  existingRemoteIdentity: Data?,
  preKey: Data?,
  signedPreKey: Data,
  kyberPreKeys: Data
) throws -> DecryptPreKeySignalResult {
  let parsed = try parseSessionOpArgs(
    config: config,
    ourIdentityKeyPair: ourIdentityKeyPair,
    existingSession: existingSession,
    existingRemoteIdentity: existingRemoteIdentity
  )

  let parsedMessage = try PreKeySignalMessage(bytes: message)
  let parsedSignedPreKey = try SignedPreKeyRecord(bytes: signedPreKey)

  let ctx = NullContext()
  let store = RecordingSignalProtocolStore(
    identity: parsed.identityKeyPair,
    registrationId: config.ourRegistrationId
  )
  if let session = parsed.existingSession {
    try store.storeSession(session, for: parsed.remoteAddress, context: ctx)
  }
  if let ident = parsed.existingRemoteIdentity {
    _ = try store.saveIdentity(ident, for: parsed.remoteAddress, context: ctx)
  }

  if let preKeyData = preKey {
    let parsedPreKey = try PreKeyRecord(bytes: preKeyData)
    try store.storePreKey(parsedPreKey, id: parsedPreKey.id, context: ctx)
  }
  try store.storeSignedPreKey(parsedSignedPreKey, id: parsedSignedPreKey.id, context: ctx)
  for recordBytes in try decodeRecordList(kyberPreKeys) {
    let record = try KyberPreKeyRecord(bytes: recordBytes)
    try store.storeKyberPreKey(record, id: record.id, context: ctx)
  }

  // Read consumedPreKeyId before decrypt (the message carries it; libsignal removes the record during decrypt).
  let consumedPreKeyId: UInt32? = try parsedMessage.preKeyId()

  let plaintext = try signalDecryptPreKey(
    message: parsedMessage,
    from: parsed.remoteAddress,
    localAddress: parsed.localAddress,
    sessionStore: store,
    identityStore: store,
    preKeyStore: store,
    signedPreKeyStore: store,
    kyberPreKeyStore: store,
    context: ctx
  )

  guard let newSession = try store.loadSession(for: parsed.remoteAddress, context: ctx) else {
    throw Exception(name: "LibsignalError", description: "decryptPreKeySignalOp produced no session")
  }

  var result = DecryptPreKeySignalResult()
  result.plaintext = Data(plaintext)
  result.newSession = newSession.serialize()
  result.identityChange = try identityChangeString(
    store: store,
    remoteAddress: parsed.remoteAddress,
    existing: parsed.existingRemoteIdentity
  )
  result.consumedPreKeyId = consumedPreKeyId
  result.kyberPreKeyId = store.usedKyberPreKeyId
  return result
}
```

- [ ] **Step 5: Update the module signature**

In `ios/ExpoLibsignalModule.swift`, change the `decryptPreKeySignalOp` AsyncFunction's last parameter and forwarding from `kyberPreKey: Data` / `kyberPreKey: kyberPreKey` to:

```swift
    AsyncFunction("decryptPreKeySignalOp") { (config: SessionOpConfig, message: Data, ourIdentityKeyPair: Data, existingSession: Data?, existingRemoteIdentity: Data?, preKey: Data?, signedPreKey: Data, kyberPreKeys: Data) -> DecryptPreKeySignalResult in
      do {
        return try runDecryptPreKeySignalOp(
          config: config,
          message: message,
          ourIdentityKeyPair: ourIdentityKeyPair,
          existingSession: existingSession,
          existingRemoteIdentity: existingRemoteIdentity,
          preKey: preKey,
          signedPreKey: signedPreKey,
          kyberPreKeys: kyberPreKeys
        )
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }
```

- [ ] **Step 6: Commit** (compile verification happens in Task 6)

```bash
git add ios/SessionOps.swift ios/ExpoLibsignalModule.swift
git commit -m "feat(ios): decryptPreKeySignalOp seeds all kyber prekeys, records the used id"
```

---

### Task 4: Android decryptPreKeySignalOp revision

**Files:**
- Modify: `android/src/main/java/expo/modules/libsignal/SessionOps.kt`
- Modify: `android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt:356-362`

- [ ] **Step 1: Make the result field nullable**

In `SessionOps.kt`, in `DecryptPreKeySignalResult` (line 56):

```kotlin
  @Field var kyberPreKeyId: Int? = null
```

- [ ] **Step 2: Add the import, recording store, and decoder**

Add to the imports in `SessionOps.kt`:

```kotlin
import org.signal.libsignal.protocol.ecc.ECPublicKey
```

After `seedStore` add:

```kotlin
// Captures which kyber prekey libsignal marks used during PQ decrypt — the
// message does not expose the id in 0.94.4, so this callback is the only
// place the real id surfaces.
internal class RecordingSignalProtocolStore(
  identity: SignalIdentityKeyPair,
  registrationId: Int,
) : InMemorySignalProtocolStore(identity, registrationId) {
  var usedKyberPreKeyId: Int? = null

  override fun markKyberPreKeyUsed(kyberPreKeyId: Int, signedPreKeyId: Int, baseKey: ECPublicKey) {
    usedKyberPreKeyId = kyberPreKeyId
    super.markKyberPreKeyUsed(kyberPreKeyId, signedPreKeyId, baseKey)
  }
}

// Mirror of src/core/recordList.ts: big-endian u32 length prefix per record.
internal fun decodeRecordList(blob: ByteArray): List<ByteArray> {
  val records = mutableListOf<ByteArray>()
  var offset = 0
  while (offset < blob.size) {
    if (offset + 4 > blob.size) throw IllegalArgumentException("recordList: truncated length prefix")
    val len = ((blob[offset].toInt() and 0xff) shl 24) or
      ((blob[offset + 1].toInt() and 0xff) shl 16) or
      ((blob[offset + 2].toInt() and 0xff) shl 8) or
      (blob[offset + 3].toInt() and 0xff)
    offset += 4
    if (offset + len > blob.size) throw IllegalArgumentException("recordList: truncated record")
    records.add(blob.copyOfRange(offset, offset + len))
    offset += len
  }
  return records
}
```

Note: the Java method may declare a checked `ReusedBaseKeyException`; Kotlin overrides need no throws clause. If the override does not compile because the upstream parameter types differ, check with `javap -classpath <jar> org.signal.libsignal.protocol.state.impl.InMemorySignalProtocolStore` (the jar lives under `~/.gradle/caches/modules-2/files-2.1/org.signal/libsignal-client/0.94.4/`).

- [ ] **Step 3: Rewrite runDecryptPreKeySignalOp**

Replace the whole function:

```kotlin
internal fun runDecryptPreKeySignalOp(
  config: SessionOpConfig,
  message: ByteArray,
  ourIdentityKeyPair: ByteArray,
  existingSession: ByteArray?,
  existingRemoteIdentity: ByteArray?,
  preKey: ByteArray?,
  signedPreKey: ByteArray,
  kyberPreKeys: ByteArray,
): DecryptPreKeySignalResult {
  val parsed = parseSessionOpArgs(config, ourIdentityKeyPair, existingSession, existingRemoteIdentity)

  val msg = PreKeySignalMessage(message)
  val parsedSignedPreKey = SignedPreKeyRecord(signedPreKey)

  val store = RecordingSignalProtocolStore(parsed.identityKeyPair, config.ourRegistrationId)
  if (parsed.existingSession != null) {
    store.storeSession(parsed.remoteAddress, parsed.existingSession)
  }
  if (parsed.existingRemoteIdentity != null) {
    store.saveIdentity(parsed.remoteAddress, parsed.existingRemoteIdentity)
  }

  preKey?.let {
    val parsedPreKey = PreKeyRecord(it)
    store.storePreKey(parsedPreKey.id, parsedPreKey)
  }
  store.storeSignedPreKey(parsedSignedPreKey.id, parsedSignedPreKey)
  for (recordBytes in decodeRecordList(kyberPreKeys)) {
    val record = KyberPreKeyRecord(recordBytes)
    store.storeKyberPreKey(record.id, record)
  }

  // Note the upstream asymmetry: SessionBuilder's constructor takes
  // (remoteAddress, localAddress) but SessionCipher's takes
  // (localAddress, remoteAddress).
  val cipher = SessionCipher(store, store, store, store, store, parsed.localAddress, parsed.remoteAddress)
  val plaintext = cipher.decrypt(msg)

  val newSession = store.loadSession(parsed.remoteAddress)
    ?: throw IllegalStateException("decryptPreKeySignalOp produced no session")

  val msgPreKeyId = msg.preKeyId
  val consumed = if (msgPreKeyId.isPresent) msgPreKeyId.get() else null

  val result = DecryptPreKeySignalResult()
  result.plaintext = plaintext
  result.newSession = newSession.serialize()
  result.identityChange = identityChangeString(store, parsed.remoteAddress, parsed.existingRemoteIdentity)
  result.consumedPreKeyId = consumed
  result.kyberPreKeyId = store.usedKyberPreKeyId
  return result
}
```

- [ ] **Step 4: Update the module signature**

In `ExpoLibsignalModule.kt`, change the `decryptPreKeySignalOp` AsyncFunction's last parameter name and forwarding:

```kotlin
    AsyncFunction("decryptPreKeySignalOp") Coroutine { config: SessionOpConfig, message: ByteArray, ourIdentityKeyPair: ByteArray, existingSession: ByteArray?, existingRemoteIdentity: ByteArray?, preKey: ByteArray?, signedPreKey: ByteArray, kyberPreKeys: ByteArray ->
      try {
        runDecryptPreKeySignalOp(config, message, ourIdentityKeyPair, existingSession, existingRemoteIdentity, preKey, signedPreKey, kyberPreKeys)
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }
```

- [ ] **Step 5: Commit**

```bash
git add android/src/main/java/expo/modules/libsignal/SessionOps.kt android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt
git commit -m "feat(android): decryptPreKeySignalOp seeds all kyber prekeys, records the used id"
```

---

### Task 5: generateRandomBytes native primitive

OS CSPRNG for the database key; avoids a new JS dependency for randomness.

**Files:**
- Modify: `ios/ExpoLibsignalModule.swift` (new AsyncFunction + `import Security`)
- Modify: `android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt` (new AsyncFunction)

- [ ] **Step 1: iOS**

Add `import Security` under `import Foundation` in `ios/ExpoLibsignalModule.swift`, and add inside the module definition (after the `deserializeIdentityKeyPair` function, before the `Class(IdentityKeyPairRef.self)` block):

```swift
    AsyncFunction("generateRandomBytes") { (length: Int) -> Data in
      guard length > 0 && length <= 1024 else {
        throw Exception(name: "LibsignalError", description: "generateRandomBytes: length must be 1...1024, got \(length)")
      }
      var bytes = [UInt8](repeating: 0, count: length)
      let status = SecRandomCopyBytes(kSecRandomDefault, length, &bytes)
      guard status == errSecSuccess else {
        throw Exception(name: "LibsignalError", description: "SecRandomCopyBytes failed with status \(status)")
      }
      return Data(bytes)
    }
```

- [ ] **Step 2: Android**

Add inside the module definition in `ExpoLibsignalModule.kt` (after the `deserializeIdentityKeyPair` function):

```kotlin
    AsyncFunction("generateRandomBytes") Coroutine { length: Int ->
      if (length < 1 || length > 1024) {
        throw IllegalArgumentException("generateRandomBytes: length must be 1..1024, got $length")
      }
      val bytes = ByteArray(length)
      java.security.SecureRandom().nextBytes(bytes)
      bytes
    }
```

- [ ] **Step 3: Commit**

```bash
git add ios/ExpoLibsignalModule.swift android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt
git commit -m "feat(native): generateRandomBytes via SecRandomCopyBytes / SecureRandom"
```

---

### Task 6: Native compile verification

No simulators or Metro — compile only.

- [ ] **Step 1: iOS**

```bash
export PATH=$(echo "$PATH" | tr ':' '\n' | grep -v gnubin | paste -sd: -)
cd example/ios && xcodebuild -workspace expolibsignalexample.xcworkspace -scheme expolibsignalexample -configuration Debug -destination 'generic/platform=iOS Simulator' build 2>&1 | tail -20
```

Expected: `** BUILD SUCCEEDED **`. If the scheme name differs, list with `xcodebuild -list -workspace expolibsignalexample.xcworkspace`.

- [ ] **Step 2: Android**

```bash
cd example/android && ./gradlew :expo-libsignal:compileDebugKotlin 2>&1 | tail -10
```

Expected: `BUILD SUCCESSFUL`. If the project path differs, find it with `./gradlew projects | grep -i libsignal`.

- [ ] **Step 3: Fix anything that fails, amend the relevant Task 3/4/5 commit if trivial or add a fix commit, and re-run both builds until green.**

---

### Task 7: StoreError and SchemaTooNewError

**Files:**
- Modify: `src/errors.ts`
- Test: `src/__tests__/storeErrors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/storeErrors.test.ts
import { LibsignalError, SchemaTooNewError, StoreError } from '../errors'

describe('store errors', () => {
  test('StoreError extends LibsignalError', () => {
    const e = new StoreError('x')
    expect(e).toBeInstanceOf(StoreError)
    expect(e).toBeInstanceOf(LibsignalError)
    expect(e.name).toBe('StoreError')
  })

  test('SchemaTooNewError extends StoreError', () => {
    const e = new SchemaTooNewError('x')
    expect(e).toBeInstanceOf(SchemaTooNewError)
    expect(e).toBeInstanceOf(StoreError)
    expect(e.name).toBe('SchemaTooNewError')
  })
})
```

Run: `bun test src/__tests__/storeErrors.test.ts` — expected FAIL (no such exports).

- [ ] **Step 2: Implement**

Append to `src/errors.ts` after `DuplicateMessageError` (do NOT add these to `ERROR_REGISTRY`; they originate in JS, not native):

```ts
// Store-layer errors (JS-origin; never produced by fromNative).

export class StoreError extends LibsignalError {
  constructor(message: string) {
    super(message)
    this.name = 'StoreError'
  }
}

export class SchemaTooNewError extends StoreError {
  constructor(message: string) {
    super(message)
    this.name = 'SchemaTooNewError'
  }
}
```

- [ ] **Step 3: Verify and commit**

```bash
bun run typecheck && bun run lint && bun test
git add src/errors.ts src/__tests__/storeErrors.test.ts
git commit -m "feat(ts): StoreError and SchemaTooNewError"
```

---

### Task 8: Store scaffolding — op-sqlite types, schema, migrations

**Files:**
- Create: `src/stores/opSqliteTypes.ts`
- Create: `src/stores/schema.ts`
- Test: `src/__tests__/schema.test.ts`

- [ ] **Step 1: op-sqlite structural types**

```ts
// src/stores/opSqliteTypes.ts

// Minimal structural types for the op-sqlite surface we use. Local types
// instead of op-sqlite's own keep the optional peer dependency out of the
// library's type graph (and out of jest's module resolution).

export type SqlScalar = string | number | boolean | null | ArrayBuffer | ArrayBufferView

export interface SqlQueryResult {
  rows: Record<string, SqlScalar>[]
}

export interface SqlTransaction {
  execute(query: string, params?: SqlScalar[]): Promise<SqlQueryResult>
}

export interface SqlDatabase {
  execute(query: string, params?: SqlScalar[]): Promise<SqlQueryResult>
  transaction(fn: (tx: SqlTransaction) => Promise<void>): Promise<void>
  close(): void
  delete(): void
}

export interface OpSqliteModule {
  open(params: { name: string; location?: string; encryptionKey?: string }): SqlDatabase
}
```

- [ ] **Step 2: Write the failing schema test**

```ts
// src/__tests__/schema.test.ts
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
    const all = MIGRATIONS[0].join('\n')
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
    expect(executed.some((q) => q.includes("INSERT INTO schema_meta"))).toBe(true)
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
```

Run: `bun test src/__tests__/schema.test.ts` — expected FAIL (no schema module).

- [ ] **Step 3: Implement schema.ts**

```ts
// src/stores/schema.ts
import { SchemaTooNewError } from '../errors'
import type { SqlDatabase } from './opSqliteTypes'

export const SCHEMA_VERSION = 1

// MIGRATIONS[n] takes the schema from version n to n + 1. Forward-only: a
// library downgrade against a newer database throws SchemaTooNewError.
// During 0.x a release may replace migrations outright; release notes say so.
// Every record BLOB is the libsignal serialized form, so a future native
// fast path can read these tables directly (spec Section 10).
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
]

export async function runMigrations(db: SqlDatabase): Promise<void> {
  await db.execute('CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const res = await db.execute("SELECT value FROM schema_meta WHERE key = 'version'")
  const current = res.rows.length > 0 ? Number(res.rows[0].value) : 0
  if (current > SCHEMA_VERSION) {
    throw new SchemaTooNewError(
      `database schema is version ${current}, but this expo-libsignal supports up to ${SCHEMA_VERSION}; upgrade the library`,
    )
  }
  for (let v = current; v < SCHEMA_VERSION; v++) {
    await db.transaction(async (tx) => {
      for (const stmt of MIGRATIONS[v]) {
        await tx.execute(stmt)
      }
      await tx.execute(
        "INSERT INTO schema_meta (key, value) VALUES ('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [String(v + 1)],
      )
    })
  }
}
```

- [ ] **Step 4: Verify and commit**

```bash
bun run typecheck && bun run lint && bun test
git add src/stores/opSqliteTypes.ts src/stores/schema.ts src/__tests__/schema.test.ts
git commit -m "feat(ts): store schema v1 and forward-only migration runner"
```

---

### Task 9: Key management

**Files:**
- Create: `src/stores/optionalRequire.ts`
- Create: `src/stores/keys.ts`
- Test: `src/__tests__/keys.test.ts`

- [ ] **Step 1: optionalRequire**

```ts
// src/stores/optionalRequire.ts
import { StoreError } from '../errors'
import type { OpSqliteModule } from './opSqliteTypes'

// op-sqlite and expo-secure-store are optional peer dependencies, resolved
// lazily so the main package entry never references them. This module is only
// reachable from the 'expo-libsignal/stores' subpath.
declare const require: (id: string) => unknown

export interface SecureStoreModule {
  getItemAsync(key: string, options?: Record<string, unknown>): Promise<string | null>
  setItemAsync(key: string, value: string, options?: Record<string, unknown>): Promise<void>
  deleteItemAsync(key: string, options?: Record<string, unknown>): Promise<void>
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: number
}

export function requireOpSqlite(): OpSqliteModule {
  try {
    return require('@op-engineering/op-sqlite') as OpSqliteModule
  } catch {
    throw new StoreError(
      "SQLCipherProtocolStore requires '@op-engineering/op-sqlite'. Install it and add " +
        '{ "op-sqlite": { "sqlcipher": true } } to your app package.json, then rebuild.',
    )
  }
}

export function requireSecureStore(): SecureStoreModule {
  try {
    return require('expo-secure-store') as SecureStoreModule
  } catch {
    throw new StoreError(
      "SQLCipherProtocolStore requires 'expo-secure-store' for database key storage. " +
        'Install it, or pass a keyProvider in the options.',
    )
  }
}
```

- [ ] **Step 2: Write the failing keys test**

```ts
// src/__tests__/keys.test.ts
const getItemAsync = jest.fn<Promise<string | null>, [string, Record<string, unknown>?]>()
const setItemAsync = jest.fn<Promise<void>, [string, string, Record<string, unknown>?]>()
const deleteItemAsync = jest.fn<Promise<void>, [string, Record<string, unknown>?]>()

jest.mock(
  'expo-secure-store',
  () => ({
    getItemAsync,
    setItemAsync,
    deleteItemAsync,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
  }),
  { virtual: true },
)

jest.mock('../ExpoLibsignalModule', () => ({
  NativeModule: {
    generateRandomBytes: jest.fn(async (n: number) => new Uint8Array(n).fill(0xab)),
  },
}))

import { StoreError } from '../errors'
import { deleteDatabaseKey, resolveDatabaseKey, toHex } from '../stores/keys'

beforeEach(() => {
  jest.clearAllMocks()
  getItemAsync.mockResolvedValue(null)
  setItemAsync.mockResolvedValue(undefined)
  deleteItemAsync.mockResolvedValue(undefined)
})

describe('resolveDatabaseKey', () => {
  test('generates, hex-encodes, and stores a 32-byte key on first open', async () => {
    const key = await resolveDatabaseKey({ keyAlias: 'test.dbkey' })
    expect(key).toBe('ab'.repeat(32))
    expect(setItemAsync).toHaveBeenCalledWith('test.dbkey', 'ab'.repeat(32), {
      keychainService: 'test.dbkey',
      keychainAccessible: 7,
      requireAuthentication: false,
    })
  })

  test('returns the existing key without writing', async () => {
    getItemAsync.mockResolvedValue('deadbeef')
    const key = await resolveDatabaseKey({ keyAlias: 'test.dbkey' })
    expect(key).toBe('deadbeef')
    expect(setItemAsync).not.toHaveBeenCalled()
  })

  test('passes a keychainAccessible override through', async () => {
    await resolveDatabaseKey({ keyAlias: 'test.dbkey', keychainAccessible: 3 })
    expect(setItemAsync.mock.calls[0][2]).toMatchObject({ keychainAccessible: 3 })
  })

  test('keyProvider bypasses secure-store entirely', async () => {
    const key = await resolveDatabaseKey({
      keyAlias: 'unused',
      keyProvider: async () => 'from-provider',
    })
    expect(key).toBe('from-provider')
    expect(getItemAsync).not.toHaveBeenCalled()
    expect(setItemAsync).not.toHaveBeenCalled()
  })

  test('an empty keyProvider result throws StoreError', async () => {
    await expect(
      resolveDatabaseKey({ keyAlias: 'unused', keyProvider: async () => '' }),
    ).rejects.toBeInstanceOf(StoreError)
  })
})

describe('deleteDatabaseKey', () => {
  test('deletes under the same keychainService', async () => {
    await deleteDatabaseKey('test.dbkey')
    expect(deleteItemAsync).toHaveBeenCalledWith('test.dbkey', { keychainService: 'test.dbkey' })
  })
})

describe('toHex', () => {
  test('zero-pads bytes', () => {
    expect(toHex(new Uint8Array([0, 1, 255]))).toBe('0001ff')
  })
})
```

Run: `bun test src/__tests__/keys.test.ts` — expected FAIL (no keys module).

Note: if the runner rejects `jest.mock(..., { virtual: true })` (bun's test runner does not implement virtual mocks), run this file through the configured jest setup instead: `bunx jest src/__tests__/keys.test.ts`.

- [ ] **Step 3: Implement keys.ts**

```ts
// src/stores/keys.ts
import { NativeModule } from '../ExpoLibsignalModule'
import { StoreError } from '../errors'
import { requireSecureStore } from './optionalRequire'

export interface ResolveKeyOptions {
  keyAlias: string
  keyProvider?: () => Promise<string>
  keychainAccessible?: number
}

// The SQLCipher key: 32 random bytes from the OS CSPRNG, hex-encoded, stored
// in the platform keychain/keystore via expo-secure-store. The hex string is
// passed to op-sqlite's encryptionKey, i.e. SQLCipher passphrase semantics
// (the KDF runs over a string carrying 256 bits of entropy). A keyProvider
// bypasses secure-store for passphrase-derived keys.
export async function resolveDatabaseKey(options: ResolveKeyOptions): Promise<string> {
  if (options.keyProvider) {
    const key = await options.keyProvider()
    if (key.length === 0) throw new StoreError('keyProvider returned an empty key')
    return key
  }
  const SecureStore = requireSecureStore()
  const existing = await SecureStore.getItemAsync(options.keyAlias, {
    keychainService: options.keyAlias,
  })
  if (existing !== null) return existing
  const bytes: Uint8Array = await NativeModule.generateRandomBytes(32)
  const hex = toHex(bytes)
  await SecureStore.setItemAsync(options.keyAlias, hex, {
    keychainService: options.keyAlias,
    keychainAccessible: options.keychainAccessible ?? SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: false,
  })
  return hex
}

export async function deleteDatabaseKey(keyAlias: string): Promise<void> {
  const SecureStore = requireSecureStore()
  await SecureStore.deleteItemAsync(keyAlias, { keychainService: keyAlias })
}

export function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}
```

- [ ] **Step 4: Verify and commit**

```bash
bun run typecheck && bun run lint && bun test
git add src/stores/optionalRequire.ts src/stores/keys.ts src/__tests__/keys.test.ts
git commit -m "feat(ts): database key management via expo-secure-store with keyProvider escape hatch"
```

---

### Task 10: SQLCipherProtocolStore + packaging

**Files:**
- Create: `src/stores/SQLCipherProtocolStore.ts`
- Create: `src/stores/index.ts`
- Create: `stores.js`, `stores.d.ts` (package-root shims)
- Modify: `package.json` (exports, files, peers)

- [ ] **Step 1: Implement the store**

```ts
// src/stores/SQLCipherProtocolStore.ts
import { IdentityKey, IdentityKeyPair } from '../core/IdentityKeyPair'
import { KyberPreKeyRecord } from '../core/KyberPreKeyRecord'
import { PreKeyRecord } from '../core/PreKeyRecord'
import type { ProtocolAddress } from '../core/ProtocolAddress'
import { SessionRecord } from '../core/SessionRecord'
import { SignedPreKeyRecord } from '../core/SignedPreKeyRecord'
import type {
  Direction,
  IdentityChange,
  IdentityKeyStore,
  KyberPreKeyStore,
  PreKeyStore,
  SessionStore,
  SignedPreKeyStore,
} from '../core/stores'
import { InvalidKeyError, StoreError } from '../errors'
import { deleteDatabaseKey, resolveDatabaseKey } from './keys'
import { requireOpSqlite } from './optionalRequire'
import type { SqlDatabase, SqlScalar } from './opSqliteTypes'
import { runMigrations } from './schema'

export interface SQLCipherStoreOptions {
  /** Database file name. Default 'expo-libsignal.db'. */
  databaseName?: string
  /** op-sqlite location passthrough (directory). Default: op-sqlite's default. */
  location?: string
  /** Secure-store entry (and keychainService) for the database key. Default 'expo-libsignal.dbkey'. */
  keyAlias?: string
  /** Supplies the SQLCipher passphrase directly, bypassing secure-store. */
  keyProvider?: () => Promise<string>
  /** expo-secure-store keychainAccessible constant. Default WHEN_UNLOCKED_THIS_DEVICE_ONLY. */
  keychainAccessible?: number
}

function toBytes(value: SqlScalar | undefined): Uint8Array {
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

/**
 * Default SQLCipher-backed implementation of all five store interfaces over
 * one op-sqlite database. Stores are pluggable: this class is one
 * implementation of the interfaces, not a requirement.
 *
 * Concurrency: wrap each protocol operation (processPreKeyBundle, encrypt,
 * decryptPreKeySignal, decryptSignal) in runExclusive() so its store
 * reads/writes are atomic with respect to other operations on this store.
 * Do not open two stores on the same database file.
 */
export class SQLCipherProtocolStore
  implements SessionStore, IdentityKeyStore, PreKeyStore, SignedPreKeyStore, KyberPreKeyStore
{
  private readonly db: SqlDatabase
  private readonly keyAlias: string
  private readonly usedKeyProvider: boolean
  private queue: Promise<unknown> = Promise.resolve()

  private constructor(db: SqlDatabase, keyAlias: string, usedKeyProvider: boolean) {
    this.db = db
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
    const opSqlite = requireOpSqlite()
    const db = opSqlite.open({
      name: databaseName,
      ...(options.location === undefined ? {} : { location: options.location }),
      encryptionKey: key,
    })
    try {
      const cipher = await db.execute('PRAGMA cipher_version')
      if (cipher.rows.length === 0) {
        throw new StoreError(
          'op-sqlite was built without SQLCipher; the database would not be encrypted. ' +
            'Add { "op-sqlite": { "sqlcipher": true } } to your app package.json and rebuild.',
        )
      }
      try {
        await db.execute('SELECT count(*) FROM sqlite_master')
      } catch (e) {
        throw new StoreError(`cannot read database (wrong key or corrupted file): ${String(e)}`)
      }
      await db.execute('PRAGMA journal_mode = WAL')
      await runMigrations(db)
    } catch (e) {
      db.close()
      throw e
    }
    return new SQLCipherProtocolStore(db, keyAlias, options.keyProvider !== undefined)
  }

  // Local identity bootstrap

  async hasLocalIdentity(): Promise<boolean> {
    const res = await this.db.execute('SELECT 1 FROM local_identity WHERE id = 1')
    return res.rows.length > 0
  }

  async initializeLocalIdentity(identity: IdentityKeyPair, registrationId: number): Promise<void> {
    if (await this.hasLocalIdentity()) {
      throw new StoreError('local identity already initialized; wipe() the store to replace it')
    }
    await this.db.execute(
      'INSERT INTO local_identity (id, key_pair, registration_id) VALUES (1, ?, ?)',
      [identity.serialize(), registrationId],
    )
  }

  // IdentityKeyStore

  async getIdentityKeyPair(): Promise<IdentityKeyPair> {
    const res = await this.db.execute('SELECT key_pair FROM local_identity WHERE id = 1')
    if (res.rows.length === 0) {
      throw new StoreError('local identity not initialized; call initializeLocalIdentity() first')
    }
    return IdentityKeyPair.deserialize(toBytes(res.rows[0].key_pair))
  }

  async getLocalRegistrationId(): Promise<number> {
    const res = await this.db.execute('SELECT registration_id FROM local_identity WHERE id = 1')
    if (res.rows.length === 0) {
      throw new StoreError('local identity not initialized; call initializeLocalIdentity() first')
    }
    return Number(res.rows[0].registration_id)
  }

  async saveIdentity(address: ProtocolAddress, key: IdentityKey): Promise<IdentityChange> {
    const name = address.name()
    const deviceId = address.deviceId()
    const keyBytes = key.serialize()
    const now = Date.now()
    let change: IdentityChange = 'newOrUnchanged'
    await this.db.transaction(async (tx) => {
      const existing = await tx.execute(
        'SELECT identity_key FROM trusted_identities WHERE name = ? AND device_id = ?',
        [name, deviceId],
      )
      if (existing.rows.length > 0 && !bytesEqual(toBytes(existing.rows[0].identity_key), keyBytes)) {
        change = 'replacedExisting'
      }
      await tx.execute(
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
    const res = await this.db.execute(
      'SELECT identity_key FROM trusted_identities WHERE name = ? AND device_id = ?',
      [address.name(), address.deviceId()],
    )
    if (res.rows.length === 0) return null
    return IdentityKey.deserialize(toBytes(res.rows[0].identity_key))
  }

  // SessionStore

  async loadSession(address: ProtocolAddress): Promise<SessionRecord | null> {
    const res = await this.db.execute(
      'SELECT record FROM sessions WHERE name = ? AND device_id = ?',
      [address.name(), address.deviceId()],
    )
    if (res.rows.length === 0) return null
    return SessionRecord.deserialize(toBytes(res.rows[0].record))
  }

  async storeSession(address: ProtocolAddress, record: SessionRecord): Promise<void> {
    await this.db.execute(
      'INSERT INTO sessions (name, device_id, record, updated_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(name, device_id) DO UPDATE SET record = excluded.record, updated_at = excluded.updated_at',
      [address.name(), address.deviceId(), record.serialize(), Date.now()],
    )
  }

  // PreKeyStore

  async loadPreKey(id: number): Promise<PreKeyRecord> {
    const res = await this.db.execute('SELECT record FROM prekeys WHERE id = ?', [id])
    if (res.rows.length === 0) throw new InvalidKeyError(`no prekey with id ${id}`)
    return PreKeyRecord.deserialize(toBytes(res.rows[0].record))
  }

  async storePreKey(id: number, record: PreKeyRecord): Promise<void> {
    await this.db.execute(
      'INSERT INTO prekeys (id, record) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record',
      [id, record.serialize()],
    )
  }

  async removePreKey(id: number): Promise<void> {
    await this.db.execute('DELETE FROM prekeys WHERE id = ?', [id])
  }

  // SignedPreKeyStore

  async loadSignedPreKey(id: number): Promise<SignedPreKeyRecord> {
    const res = await this.db.execute('SELECT record FROM signed_prekeys WHERE id = ?', [id])
    if (res.rows.length === 0) throw new InvalidKeyError(`no signed prekey with id ${id}`)
    return SignedPreKeyRecord.deserialize(toBytes(res.rows[0].record))
  }

  async storeSignedPreKey(id: number, record: SignedPreKeyRecord): Promise<void> {
    await this.db.execute(
      'INSERT INTO signed_prekeys (id, record, created_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET record = excluded.record',
      [id, record.serialize(), Date.now()],
    )
  }

  // KyberPreKeyStore

  async loadKyberPreKey(id: number): Promise<KyberPreKeyRecord> {
    const res = await this.db.execute('SELECT record FROM kyber_prekeys WHERE id = ?', [id])
    if (res.rows.length === 0) throw new InvalidKeyError(`no kyber prekey with id ${id}`)
    return KyberPreKeyRecord.deserialize(toBytes(res.rows[0].record))
  }

  async loadKyberPreKeys(): Promise<KyberPreKeyRecord[]> {
    const res = await this.db.execute('SELECT record FROM kyber_prekeys ORDER BY id')
    return Promise.all(res.rows.map((row) => KyberPreKeyRecord.deserialize(toBytes(row.record))))
  }

  async storeKyberPreKey(id: number, record: KyberPreKeyRecord): Promise<void> {
    await this.db.execute(
      'INSERT INTO kyber_prekeys (id, record, created_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET record = excluded.record',
      [id, record.serialize(), Date.now()],
    )
  }

  // Records the use; retention is the consumer's policy. Used records stay
  // loadable because late-arriving PreKeySignalMessages may reference them.
  async markKyberPreKeyUsed(id: number): Promise<void> {
    await this.db.execute('UPDATE kyber_prekeys SET used_at = ? WHERE id = ?', [Date.now(), id])
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
    this.db.close()
  }

  /** Delete the database file and (unless a keyProvider was used) the stored key. */
  async wipe(): Promise<void> {
    this.db.delete()
    if (!this.usedKeyProvider) {
      await deleteDatabaseKey(this.keyAlias)
    }
  }
}
```

- [ ] **Step 2: Subpath entry + root shims**

```ts
// src/stores/index.ts
export { SQLCipherProtocolStore, type SQLCipherStoreOptions } from './SQLCipherProtocolStore'
```

```js
// stores.js (package root) — resolution shim for tools that ignore the
// package.json "exports" map.
module.exports = require('./build/stores/index.js')
```

```ts
// stores.d.ts (package root)
export * from './build/stores'
```

- [ ] **Step 3: package.json**

Add after `"types"`:

```json
  "exports": {
    ".": {
      "types": "./build/index.d.ts",
      "default": "./build/index.js"
    },
    "./stores": {
      "types": "./build/stores/index.d.ts",
      "default": "./build/stores/index.js"
    },
    "./app.plugin.js": "./app.plugin.js",
    "./package.json": "./package.json"
  },
```

Add to `peerDependencies` (keep existing entries):

```json
    "@op-engineering/op-sqlite": "*",
```

Add after `peerDependencies`:

```json
  "peerDependenciesMeta": {
    "@op-engineering/op-sqlite": {
      "optional": true
    },
    "expo-secure-store": {
      "optional": true
    }
  },
```

Add `"stores.js"` and `"stores.d.ts"` to the `files` array.

- [ ] **Step 4: Verify**

```bash
bun run typecheck && bun run lint && bun test && bun run build
ls build/stores/index.js build/stores/index.d.ts
```

Expected: all green; both build outputs exist. If `tsc` complains about `require` in `optionalRequire.ts` despite the local `declare const`, check no global Node types conflict (there should be none; jest types come from @types/jest).

- [ ] **Step 5: Commit**

```bash
git add src/stores/ stores.js stores.d.ts package.json
git commit -m "feat(ts): SQLCipherProtocolStore — default SQLCipher-backed store via expo-libsignal/stores"
```

---

### Task 11: Example app — interface update and kyber id decoupling

**Files:**
- Modify: `example/src/stores/InMemoryProtocolStore.ts`
- Modify: `example/src/personas/createPersona.ts`
- Modify: `example/src/screens/AliceBobScreen.tsx`

- [ ] **Step 1: InMemoryProtocolStore gains loadKyberPreKeys**

Add after `loadKyberPreKey`:

```ts
  async loadKyberPreKeys(): Promise<KyberPreKeyRecord[]> {
    return [...this.kyberPreKeys.values()]
  }
```

- [ ] **Step 2: Decouple kyber id from signed prekey id in publishPreKeyBundle**

In `example/src/personas/createPersona.ts`, replace `publishPreKeyBundle` with:

```ts
export async function publishPreKeyBundle(
  persona: Persona,
  preKeyId: number,
  signedPreKeyId: number,
  kyberPreKeyId: number,
): Promise<PreKeyBundle> {
  // Generate fresh prekeys, store them in the persona's stores, then build a bundle.
  const ts = Date.now()
  const preKey = await PreKeyRecord.generate(preKeyId)
  const signedPreKey = await SignedPreKeyRecord.generate(signedPreKeyId, persona.identity, ts)
  const kyberPreKey = await KyberPreKeyRecord.generate(kyberPreKeyId, persona.identity, ts)
  await persona.stores.storePreKey(preKeyId, preKey)
  await persona.stores.storeSignedPreKey(signedPreKeyId, signedPreKey)
  await persona.stores.storeKyberPreKey(kyberPreKeyId, kyberPreKey)
  return PreKeyBundle.create({
    registrationId: persona.registrationId,
    deviceId: persona.address.deviceId(),
    identityKey: persona.identity.publicKey(),
    signedPreKeyId,
    signedPreKeyPublic: signedPreKey.publicKey(),
    signedPreKeySignature: signedPreKey.signature(),
    kyberPreKeyId,
    kyberPreKeyPublic: kyberPreKey.kyberPublicKey(),
    kyberPreKeySignature: kyberPreKey.signature(),
    preKeyId,
    preKeyPublic: preKey.publicKey(),
  })
}
```

- [ ] **Step 3: AliceBobScreen uses a distinct kyber id plus a decoy**

In `example/src/screens/AliceBobScreen.tsx`:

Add `KyberPreKeyRecord` to the `expo-libsignal` import. Replace the bundle setup block (steps 2 and 7) with:

```ts
      const preKeyId = 100
      const signedPreKeyId = 200
      const kyberPreKeyId = 300
      // A decoy kyber prekey proves the used-id mapping is real: the store
      // holds two kyber records and the op must mark the bundle's (300), not
      // the decoy's (299) and not the signed prekey id (200).
      await bob.stores.storeKyberPreKey(
        299,
        await KyberPreKeyRecord.generate(299, bob.identity, Date.now()),
      )
      const bundle = await publishPreKeyBundle(bob, preKeyId, signedPreKeyId, kyberPreKeyId)
      push({
        label: '2. Bob publishes PreKeyBundle',
        detail: `preKeyId=${preKeyId} signedPreKeyId=${signedPreKeyId} kyberPreKeyId=${kyberPreKeyId} (+decoy 299)`,
        ok: true,
      })
```

and step 7:

```ts
      const kyberMarked = bob.stores.isKyberPreKeyUsed(kyberPreKeyId)
      const decoyUntouched = !bob.stores.isKyberPreKeyUsed(299)
      push({
        label: '7. Bob marked the right kyber prekey used',
        detail: `kyberPreKeyId=${kyberPreKeyId} used=${kyberMarked} decoyUsed=${!decoyUntouched}`,
        ok: kyberMarked && decoyUntouched,
      })
```

- [ ] **Step 4: Typecheck the example and commit**

```bash
cd example && bunx tsc --noEmit && cd ..
git add example/src/stores/InMemoryProtocolStore.ts example/src/personas/createPersona.ts example/src/screens/AliceBobScreen.tsx
git commit -m "test(example): loadKyberPreKeys; Alice & Bob proves kyber id mapping with a decoy"
```

---

### Task 12: Example app — op-sqlite + expo-secure-store + prebuild

**Files:**
- Modify: `example/package.json`
- Regenerate: `example/ios/`, `example/android/` (prebuild artifacts, committed per repo convention)

- [ ] **Step 1: Add dependencies**

```bash
cd example
bunx expo install expo-secure-store
bun add @op-engineering/op-sqlite@16.2.1
```

- [ ] **Step 2: Enable SQLCipher**

Add a top-level key to `example/package.json` (sibling of `"dependencies"`):

```json
  "op-sqlite": {
    "sqlcipher": true
  }
```

op-sqlite's build scripts walk up from `node_modules/@op-engineering/op-sqlite` and read this from the first package.json found, i.e. the app's. The library cannot ship it.

- [ ] **Step 3: Prebuild**

```bash
export PATH=$(echo "$PATH" | tr ':' '\n' | grep -v gnubin | paste -sd: -)
cd example && bunx expo prebuild --clean
```

Verify SQLCipher took effect: `grep -ri "sqlcipher\|OpenSSL" example/ios/Podfile.lock | head -5` should show op-sqlite's SQLCipher/OpenSSL-Universal pods.

- [ ] **Step 4: Compile both platforms** (no simulators)

```bash
cd example/ios && xcodebuild -workspace expolibsignalexample.xcworkspace -scheme expolibsignalexample -configuration Debug -destination 'generic/platform=iOS Simulator' build 2>&1 | tail -5
cd ../android && ./gradlew assembleDebug 2>&1 | tail -5
```

Expected: both succeed. **Fallback (spec risk 1):** if op-sqlite 16.2.1 fails to build against RN 0.85, `bun add @op-engineering/op-sqlite@15.2.14` and repeat from Step 3.

- [ ] **Step 5: Commit**

```bash
git add example/package.json example/bun.lock example/ios example/android
git commit -m "chore(example): op-sqlite (SQLCipher) + expo-secure-store; prebuild artifacts"
```

---

### Task 13: Example app — Persistence screen

**Files:**
- Create: `example/src/screens/PersistenceScreen.tsx`
- Modify: `example/App.tsx`

- [ ] **Step 1: Write the screen**

```tsx
// example/src/screens/PersistenceScreen.tsx
import {
  IdentityKeyPair,
  KyberPreKeyRecord,
  PreKeyBundle,
  PreKeyRecord,
  type PreKeySignalMessage,
  ProtocolAddress,
  SessionBuilder,
  SessionCipher,
  type SignalMessage,
  SignedPreKeyRecord,
} from 'expo-libsignal'
import { SQLCipherProtocolStore } from 'expo-libsignal/stores'
import { useEffect, useState } from 'react'
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native'

interface StepResult {
  label: string
  detail: string
  ok: boolean
}

const utf8Encode = (s: string) => new TextEncoder().encode(s)
const utf8Decode = (b: Uint8Array) => new TextDecoder().decode(b)

const PRE_KEY_ID = 11
const SIGNED_PRE_KEY_ID = 7
const KYBER_PRE_KEY_ID = 101
const DECOY_KYBER_PRE_KEY_ID = 100

interface PersistedPersona {
  store: SQLCipherProtocolStore
  address: ProtocolAddress
}

async function openPersona(name: string): Promise<PersistedPersona> {
  const store = await SQLCipherProtocolStore.open({
    databaseName: `${name}.db`,
    keyAlias: `expo-libsignal-example.${name}.dbkey`,
  })
  const address = await ProtocolAddress.create(`${name}-persisted`, 1)
  return { store, address }
}

function cipherStores(store: SQLCipherProtocolStore) {
  return {
    sessionStore: store,
    identityStore: store,
    preKeyStore: store,
    signedPreKeyStore: store,
    kyberPreKeyStore: store,
  }
}

export default function PersistenceScreen() {
  const [steps, setSteps] = useState<StepResult[]>([])
  const [status, setStatus] = useState<'idle' | 'running' | 'ok' | 'fail'>('idle')
  const [runKind, setRunKind] = useState<'fresh' | 'resumed' | null>(null)

  async function run() {
    setStatus('running')
    const results: StepResult[] = []
    const push = (s: StepResult) => results.push(s)
    let alice: PersistedPersona | null = null
    let bob: PersistedPersona | null = null
    let kind: 'fresh' | 'resumed' = 'fresh'
    let kyberUsedId: number | null = null
    try {
      alice = await openPersona('alice')
      bob = await openPersona('bob')
      push({ label: '1. Open SQLCipher stores', detail: 'alice.db + bob.db (WAL, migrated)', ok: true })

      const resumed =
        (await alice.store.hasLocalIdentity()) &&
        (await bob.store.hasLocalIdentity()) &&
        (await alice.store.loadSession(bob.address)) !== null
      kind = resumed ? 'resumed' : 'fresh'
      setRunKind(kind)

      // Observe which kyber id the decrypt marks used, via an interface-level
      // wrapper around Bob's store (the library needs no debug surface).
      const recordingKyberStore = {
        loadKyberPreKey: (id: number) => bob!.store.loadKyberPreKey(id),
        loadKyberPreKeys: () => bob!.store.loadKyberPreKeys(),
        storeKyberPreKey: (id: number, r: KyberPreKeyRecord) => bob!.store.storeKyberPreKey(id, r),
        markKyberPreKeyUsed: async (id: number) => {
          kyberUsedId = id
          await bob!.store.markKyberPreKeyUsed(id)
        },
      }

      const aliceCipher = new SessionCipher(cipherStores(alice.store), bob.address, alice.address)
      const bobCipher = new SessionCipher(
        { ...cipherStores(bob.store), kyberPreKeyStore: recordingKyberStore },
        alice.address,
        bob.address,
      )

      if (!resumed) {
        const aliceIdentity = await IdentityKeyPair.generate()
        const bobIdentity = await IdentityKeyPair.generate()
        await alice.store.initializeLocalIdentity(aliceIdentity, 1 + Math.floor(Math.random() * 0x3fff))
        await bob.store.initializeLocalIdentity(bobIdentity, 1 + Math.floor(Math.random() * 0x3fff))
        push({ label: '2. Initialize identities', detail: 'persisted to local_identity', ok: true })

        const ts = Date.now()
        const preKey = await PreKeyRecord.generate(PRE_KEY_ID)
        const signedPreKey = await SignedPreKeyRecord.generate(SIGNED_PRE_KEY_ID, bobIdentity, ts)
        const kyberPreKey = await KyberPreKeyRecord.generate(KYBER_PRE_KEY_ID, bobIdentity, ts)
        const decoy = await KyberPreKeyRecord.generate(DECOY_KYBER_PRE_KEY_ID, bobIdentity, ts)
        await bob.store.storePreKey(PRE_KEY_ID, preKey)
        await bob.store.storeSignedPreKey(SIGNED_PRE_KEY_ID, signedPreKey)
        await bob.store.storeKyberPreKey(KYBER_PRE_KEY_ID, kyberPreKey)
        await bob.store.storeKyberPreKey(DECOY_KYBER_PRE_KEY_ID, decoy)
        const bundle = await PreKeyBundle.create({
          registrationId: await bob.store.getLocalRegistrationId(),
          deviceId: bob.address.deviceId(),
          identityKey: bobIdentity.publicKey(),
          signedPreKeyId: SIGNED_PRE_KEY_ID,
          signedPreKeyPublic: signedPreKey.publicKey(),
          signedPreKeySignature: signedPreKey.signature(),
          kyberPreKeyId: KYBER_PRE_KEY_ID,
          kyberPreKeyPublic: kyberPreKey.kyberPublicKey(),
          kyberPreKeySignature: kyberPreKey.signature(),
          preKeyId: PRE_KEY_ID,
          preKeyPublic: preKey.publicKey(),
        })
        push({
          label: '3. Bob publishes bundle',
          detail: `kyber=${KYBER_PRE_KEY_ID}, decoy=${DECOY_KYBER_PRE_KEY_ID}, signed=${SIGNED_PRE_KEY_ID}`,
          ok: true,
        })

        const builder = new SessionBuilder(
          { sessionStore: alice.store, identityStore: alice.store },
          bob.address,
          alice.address,
        )
        await alice.store.runExclusive(() => builder.processPreKeyBundle(bundle))
        push({ label: '4. Alice processPreKeyBundle', detail: 'session persisted', ok: true })

        const msg1 = await alice.store.runExclusive(() => aliceCipher.encrypt(utf8Encode('hello bob')))
        const ok1 = msg1.type === 'preKeySignal'
        push({ label: '5. Alice encrypts', detail: `type=${msg1.type}`, ok: ok1 })
        if (!ok1) throw new Error('expected preKeySignal')

        const recovered = await bob.store.runExclusive(() =>
          bobCipher.decryptPreKeySignal(msg1 as PreKeySignalMessage),
        )
        push({
          label: '6. Bob decryptPreKeySignal',
          detail: `plaintext="${utf8Decode(recovered)}"`,
          ok: utf8Decode(recovered) === 'hello bob',
        })

        const kyberOk = kyberUsedId === KYBER_PRE_KEY_ID
        push({
          label: '7. Kyber id mapping',
          detail: `marked used: ${kyberUsedId} (expected ${KYBER_PRE_KEY_ID}, decoy ${DECOY_KYBER_PRE_KEY_ID} present)`,
          ok: kyberOk,
        })
        if (!kyberOk) throw new Error('wrong kyber prekey marked used')

        const msg2 = await bob.store.runExclusive(() => bobCipher.encrypt(utf8Encode('hi alice')))
        const recovered2 = await alice.store.runExclusive(() =>
          aliceCipher.decryptSignal(msg2 as SignalMessage),
        )
        push({
          label: '8. Bob replies, Alice decrypts',
          detail: `type=${msg2.type} plaintext="${utf8Decode(recovered2)}"`,
          ok: msg2.type === 'signal' && utf8Decode(recovered2) === 'hi alice',
        })
        push({
          label: '9. Restart the app to test persistence',
          detail: 'next run should report run=resumed',
          ok: true,
        })
      } else {
        // No handshake: the session must already be on disk, so the first
        // message is an ordinary ratcheted 'signal' message.
        const msg = await alice.store.runExclusive(() => aliceCipher.encrypt(utf8Encode('persisted hello')))
        const okType = msg.type === 'signal'
        push({ label: '2. Alice encrypts with persisted session', detail: `type=${msg.type}`, ok: okType })
        if (!okType) throw new Error('expected signal (session should be persisted)')

        const recovered = await bob.store.runExclusive(() =>
          bobCipher.decryptSignal(msg as SignalMessage),
        )
        push({
          label: '3. Bob decrypts with persisted session',
          detail: `plaintext="${utf8Decode(recovered)}"`,
          ok: utf8Decode(recovered) === 'persisted hello',
        })

        const reply = await bob.store.runExclusive(() => bobCipher.encrypt(utf8Encode('still here')))
        const recovered2 = await alice.store.runExclusive(() =>
          aliceCipher.decryptSignal(reply as SignalMessage),
        )
        push({
          label: '4. Bob replies, Alice decrypts',
          detail: `plaintext="${utf8Decode(recovered2)}"`,
          ok: utf8Decode(recovered2) === 'still here',
        })
      }

      const pass = results.every((r) => r.ok)
      console.log(
        '[SQLCIPHER-SUMMARY]',
        JSON.stringify({
          run: kind,
          pass,
          kyberUsedId,
          steps: results.map((r) => ({ label: r.label, ok: r.ok, detail: r.detail })),
        }),
      )
      setSteps(results)
      setStatus(pass ? 'ok' : 'fail')
    } catch (e) {
      results.push({ label: 'error', detail: String(e), ok: false })
      console.log(
        '[SQLCIPHER-SUMMARY]',
        JSON.stringify({
          run: kind,
          pass: false,
          kyberUsedId,
          steps: results.map((r) => ({ label: r.label, ok: r.ok, detail: r.detail })),
        }),
      )
      setSteps(results)
      setStatus('fail')
    } finally {
      await alice?.store.close().catch(() => {})
      await bob?.store.close().catch(() => {})
    }
  }

  async function wipe() {
    setStatus('running')
    try {
      const alice = await openPersona('alice')
      await alice.store.wipe()
      const bob = await openPersona('bob')
      await bob.store.wipe()
      setSteps([{ label: 'wiped', detail: 'both stores and keys deleted; re-run for a fresh handshake', ok: true }])
      setRunKind(null)
      setStatus('idle')
    } catch (e) {
      setSteps([{ label: 'wipe failed', detail: String(e), ok: false }])
      setStatus('fail')
    }
  }

  useEffect(() => {
    run()
  }, [])

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Persistence: SQLCipher stores</Text>
      <Text style={[styles.status, statusStyle(status)]}>
        Status: {status}
        {runKind ? ` (run=${runKind})` : ''}
      </Text>
      <Button title="Re-run" onPress={run} />
      <Button title="Wipe both stores" onPress={wipe} />
      <View style={{ height: 8 }} />
      {steps.map((s, i) => (
        <View key={i} style={styles.row}>
          <Text style={[styles.label, { color: s.ok ? '#0a0' : '#a00' }]}>
            {s.ok ? '[OK]' : '[X]'} {s.label}
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

Note for the engineer: the re-run path after a fresh run in the same launch is also `resumed` (sessions are on disk), which is correct; true restart verification is the smoke test's job. `bob!.store` non-null assertions inside `recordingKyberStore` are safe because the wrapper is created after `bob` is assigned.

- [ ] **Step 2: Add the tab**

In `example/App.tsx`: extend the `Tab` type and the bar:

```tsx
type Tab = 'identity' | 'aliceBob' | 'persistence'
```

```tsx
        <TabButton current={tab} value="identity" label="Identity" onPress={setTab} />
        <TabButton current={tab} value="aliceBob" label="Alice & Bob" onPress={setTab} />
        <TabButton current={tab} value="persistence" label="Persistence" onPress={setTab} />
```

```tsx
      <View style={styles.screen}>
        {tab === 'identity' ? <IdentityScreen /> : tab === 'aliceBob' ? <AliceBobScreen /> : <PersistenceScreen />}
      </View>
```

with the import `import PersistenceScreen from './src/screens/PersistenceScreen'`.

- [ ] **Step 3: Typecheck and commit**

```bash
cd example && bunx tsc --noEmit && cd ..
git add example/src/screens/PersistenceScreen.tsx example/App.tsx
git commit -m "test(example): Persistence tab exercising SQLCipher stores across restarts"
```

---

### Task 14: Docs — README and SECURITY.md

**Files:**
- Modify: `README.md`
- Modify: `SECURITY.md`

- [ ] **Step 1: README**

Replace the "Store implementations are the consumer's responsibility..." paragraph with a default-store section:

````markdown
Store implementations are pluggable. Implement the `SessionStore`,
`IdentityKeyStore`, `PreKeyStore`, `SignedPreKeyStore`, and `KyberPreKeyStore`
interfaces yourself, or use the default SQLCipher-backed store:

```typescript
import { SQLCipherProtocolStore } from 'expo-libsignal/stores'

const store = await SQLCipherProtocolStore.open()
if (!(await store.hasLocalIdentity())) {
  await store.initializeLocalIdentity(await IdentityKeyPair.generate(), registrationId)
}

// One object implements all five interfaces.
const cipher = new SessionCipher(
  {
    sessionStore: store,
    identityStore: store,
    preKeyStore: store,
    signedPreKeyStore: store,
    kyberPreKeyStore: store,
  },
  remoteAddress,
  localAddress,
)

// Wrap each protocol operation so its store reads/writes are atomic.
const ciphertext = await store.runExclusive(() => cipher.encrypt(plaintext))
```

The default store requires two optional peer dependencies:

```bash
bunx expo install expo-secure-store
bun add @op-engineering/op-sqlite
```

and SQLCipher enabled in **your app's** package.json (op-sqlite reads this
from the app root; a library cannot set it):

```json
"op-sqlite": { "sqlcipher": true }
```

The store refuses to open if op-sqlite was built without SQLCipher. The
database key is 32 random bytes, hex-encoded, kept in the iOS Keychain /
Android Keystore via expo-secure-store (`WHEN_UNLOCKED_THIS_DEVICE_ONLY` by
default; override `keychainAccessible`, or supply your own `keyProvider`).
Schema migrations are forward-only; during 0.x a release may change the
schema without a data migration path, and the release notes will say so.
````

Also add a 0.x breaking-change note near the roadmap:

```markdown
**Breaking change (unreleased 0.x):** `KyberPreKeyStore` gained
`loadKyberPreKeys(): Promise<KyberPreKeyRecord[]>`. libsignal 0.94.4 does not
expose the kyber prekey id on `PreKeySignalMessage`, so decryption seeds all
stored kyber prekeys and reports back the id actually used.
```

(Roadmap row flips to shipped in Task 15, after on-device verification.)

- [ ] **Step 2: SECURITY.md**

Add a short "Known limitations" entry:

```markdown
- Kyber base-key replay detection (`ReusedBaseKeyException` in upstream
  libsignal stores) is not yet enforced: the stateless native ops cannot see
  base keys from prior decrypts. Tracked for the native fast path
  (design spec 2026-06-12, Section 10). The default store records `used_at`
  for kyber prekeys, but a replayed first message that reuses a base key
  against a last-resort kyber prekey is not rejected on that basis alone.
```

- [ ] **Step 3: Commit**

```bash
git add README.md SECURITY.md
git commit -m "docs: default SQLCipher store usage, kyber interface breaking note, replay limitation"
```

---

### Task 15: On-device verification, smoke log, roadmap, tag

**STOP: ask spence for a go-ahead before this task — it starts Metro and simulators.** Check `lsof -nP -iTCP -sTCP:LISTEN` for port collisions first.

- [ ] **Step 1: Rebuild library and restart Metro clean** (stale-bundle gotcha)

```bash
bun run build
cd example && bunx expo start --clear   # in background; grep its logs
```

- [ ] **Step 2: iOS** — build + launch on the iPhone simulator (`bunx expo run:ios` or Xcode). In the app: Alice & Bob tab (regression), then Persistence tab. Grep Metro logs for `[ALICEBOB-SUMMARY]` (expect `"status":"ok"`, kyber step shows id 300 used, decoy untouched) and `[SQLCIPHER-SUMMARY]` (expect `"run":"fresh","pass":true,"kyberUsedId":101`). Kill the app fully, relaunch, grep for `[SQLCIPHER-SUMMARY]` with `"run":"resumed","pass":true`.

- [ ] **Step 3: Android** — same flow on the emulator (`bunx expo run:android`), same four greps.

- [ ] **Step 4: Append `example/SMOKE_TEST_LOG.md`** (newest first), one entry per platform:

```markdown
## YYYY-MM-DD — Phase 3: SQLCipher stores (<platform>)

- <simulator/emulator description>: ok
- Alice & Bob regression: ok (kyber id 300 marked used; decoy 299 untouched)
- Persistence fresh run: ok (kyberUsedId=101 with decoy 100 present, signed id 7)
- Persistence resumed run after app restart: ok (first message type: signal)
- Wipe + fresh handshake: ok
```

- [ ] **Step 5: Flip the README roadmap row** for "Default SQLCipher-backed stores" to shipped.

- [ ] **Step 6: Final check, commit, tag**

```bash
bun run typecheck && bun run lint && bun test
git add example/SMOKE_TEST_LOG.md README.md
git commit -m "test(example): Phase 3 smoke test passes on iOS and Android"
git tag phase-3-complete
```
