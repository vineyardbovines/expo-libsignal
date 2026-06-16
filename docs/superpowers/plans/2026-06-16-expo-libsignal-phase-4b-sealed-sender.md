# Sealed Sender (Phase 4b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship libsignal's Sealed Sender envelope so a sender cert issued under a trust root mints sealed envelopes that the recipient unseals end-to-end on both platforms.

**Architecture:** Two new opaque cert classes (`ServerCertificate`, `SenderCertificate`) wrap libsignal cert types through the same SharedObject + positional-bytes pattern used for `SessionRecord` and `SenderKeyDistributionMessage`. A single `SealedSender` namespace exposes two stateless functions (`encrypt`, `decryptMessage`) that delegate to native ops. No new store interface, no schema bump — existing `SQLCipherProtocolStore` already covers the session + identity stores Sealed Sender needs.

**Tech Stack:**
- libsignal-client 0.94.4 (`LibSignalClient` on iOS, `org.signal.libsignal` on Android)
- Expo Modules API (Swift + Kotlin native, TypeScript JS)
- Jest for TS-side unit tests
- Manual smoke test in the example app

**Spec source:** `docs/superpowers/specs/2026-06-16-expo-libsignal-phase-4b-sealed-sender-kickoff.md`.

---

## File Structure

New files:
- `src/core/ServerCertificate.ts`
- `src/core/SenderCertificate.ts`
- `src/core/SealedSender.ts`
- `ios/SealedSenderRefs.swift`
- `ios/SealedSenderOps.swift`
- `android/src/main/java/expo/modules/libsignal/SealedSenderRefs.kt`
- `android/src/main/java/expo/modules/libsignal/SealedSenderOps.kt`
- `example/src/screens/SealedSenderScreen.tsx`
- `src/__tests__/ServerCertificate.test.ts`
- `src/__tests__/SenderCertificate.test.ts`
- `src/__tests__/SealedSender.test.ts`

Modified files:
- `src/ExpoLibsignalModule.ts` — declare the new native ops on the `NativeModule` shape (no method changes — the runtime accessor is `any`, but a typed config helper for `SealedSenderOpConfig` lives here next to `SenderKeyOpConfig`).
- `src/index.ts` — export the new classes + namespace.
- `ios/ExpoLibsignalModule.swift` — register the two cert SharedObject classes + the four new AsyncFunctions.
- `android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt` — same registration on Android.
- `example/App.tsx` — add `'sealedSender'` to the `Tab` union and a tab button.
- `example/SMOKE_TEST_LOG.md` — append a dated Phase 4b entry per platform.
- `README.md` — flip Sealed Sender roadmap row to shipped.

---

## Task 1: TS foundation — cert classes, sealed sender namespace, store-interface extension, tests

**Why first:** Pure TS, jest-driven, no native dependency. Lands as a single commit once typecheck and tests are green. The native ops referenced by `SealedSender.*` will not yet exist at runtime; TypeScript only checks the surface, so tests use `jest.mock('../ExpoLibsignalModule', ...)` to stub the calls.

**Decided up front:** Sealed Sender decrypt must seed every stored PreKey + SignedPreKey into the native op (libsignal resolves which one inside the encrypted envelope, after the JS layer has handed control off). Add `loadPreKeys(): Promise<PreKeyRecord[]>` to `PreKeyStore` and `loadSignedPreKeys(): Promise<SignedPreKeyRecord[]>` to `SignedPreKeyStore`. Mirrors the existing `KyberPreKeyStore.loadKyberPreKeys()` pattern. Implement both on `SQLCipherProtocolStore` (rows already exist in v1 schema) and on `example/src/stores/InMemoryProtocolStore.ts`. Same README breaking-change call-out as the kyber one.

**Files:**
- Create: `src/core/ServerCertificate.ts`
- Create: `src/core/SenderCertificate.ts`
- Create: `src/core/SealedSender.ts`
- Modify: `src/core/stores.ts` — add the two new methods to the two interfaces
- Modify: `src/core/IdentityKeyPair.ts` — add `IdentityKey.toPublicKey(): PublicKey`, `PrivateKey.generate()`, `PrivateKey.publicKey()` so the cert APIs are callable from JS without going through `IdentityKeyPair` for every key
- Modify: `src/stores/SQLCipherProtocolStore.ts` — implement `loadPreKeys` / `loadSignedPreKeys`
- Modify: `example/src/stores/InMemoryProtocolStore.ts` — implement `loadPreKeys` / `loadSignedPreKeys`
- Modify: `src/index.ts`
- Modify: `README.md` — append a second breaking-change note alongside the kyber one
- Test: `src/__tests__/ServerCertificate.test.ts`
- Test: `src/__tests__/SenderCertificate.test.ts`
- Test: `src/__tests__/SealedSender.test.ts`
- Test: `src/__tests__/schema.test.ts` and `src/__tests__/storeErrors.test.ts` — update if existing assertions break

The duck-typing fallback paragraph in this plan (under `SealedSender.ts`) is now obsolete — delete the `loadAllPreKeysAsBytes` / `loadAllSignedPreKeysAsBytes` helpers and call the new store methods directly.

### Step 1: Write `src/__tests__/ServerCertificate.test.ts` (FAILING)

```ts
import { IdentityKeyPair } from '../core/IdentityKeyPair'
import { PublicKey } from '../core/PublicKey'
import { ServerCertificate } from '../core/ServerCertificate'

const certBytes = new Uint8Array([0xa1, 0xa2])
const sigBytes = new Uint8Array([0xb1, 0xb2])
const keyBytes = new Uint8Array([0xc1, 0xc2])

jest.mock('../ExpoLibsignalModule', () => {
  const ref = {
    serialize: () => certBytes,
    keyId: () => 99,
    signature: () => sigBytes,
    key: () => ({ serialize: () => keyBytes }),
  }
  return {
    NativeModule: {
      generateServerCertificateOp: jest.fn(async () => ({ certificate: certBytes })),
      deserializeServerCertificate: jest.fn(async () => ref),
      deserializeIdentityKeyPair: jest.fn(async () => ({
        serialize: () => new Uint8Array(),
        publicKey: () => ({ serialize: () => keyBytes }),
        privateKey: () => ({ serialize: () => new Uint8Array() }),
      })),
      deserializePublicKey: jest.fn(async () => ({ serialize: () => keyBytes })),
    },
  }
})

describe('ServerCertificate', () => {
  test('generate calls the native op with positional bytes and returns a ref', async () => {
    const trustRoot = await IdentityKeyPair.deserialize(new Uint8Array())
    const serverKey = await PublicKey.deserialize(new Uint8Array())
    const cert = await ServerCertificate.generate({ keyId: 99, serverKey, trustRoot })
    expect(cert.serialize()).toEqual(certBytes)
    expect(cert.keyId()).toBe(99)
    expect(cert.signature()).toEqual(sigBytes)
    expect((await cert.key()).serialize()).toEqual(keyBytes)
  })

  test('deserialize round-trips through the ref', async () => {
    const cert = await ServerCertificate.deserialize(certBytes)
    expect(cert.serialize()).toEqual(certBytes)
    expect(cert.keyId()).toBe(99)
  })
})
```

Run: `bun run test src/__tests__/ServerCertificate.test.ts`
Expected: FAIL — `ServerCertificate` does not exist.

### Step 2: Create `src/core/ServerCertificate.ts`

Follow the `SenderKeyDistributionMessage` shape: private constructor wrapping an opaque ref, async `deserialize`, async `generate` (factory for tests). `key()` is async because the ref returns a fresh PublicKeyRef SharedObject that `PublicKey` already wraps.

```ts
import { NativeModule } from '../ExpoLibsignalModule'
import type { IdentityKeyPair } from './IdentityKeyPair'
import { PublicKey } from './PublicKey'

interface ServerCertificateRef {
  serialize(): Uint8Array
  keyId(): number
  signature(): Uint8Array
  key(): unknown
}

/**
 * Trust-root-signed certificate binding a server-side signing key to a key id.
 * The server presents this to clients alongside a SenderCertificate it issues.
 * Production callers receive it from a server and only ever call deserialize;
 * generate exists to mint test certs.
 */
export class ServerCertificate {
  private readonly ref: ServerCertificateRef

  private constructor(ref: ServerCertificateRef) {
    this.ref = ref
  }

  static async generate(opts: {
    keyId: number
    serverKey: PublicKey
    trustRoot: IdentityKeyPair
  }): Promise<ServerCertificate> {
    const result = (await NativeModule.generateServerCertificateOp(
      opts.keyId,
      opts.serverKey.serialize(),
      opts.trustRoot.serialize(),
    )) as { certificate: Uint8Array }
    return ServerCertificate.deserialize(result.certificate)
  }

  static async deserialize(bytes: Uint8Array): Promise<ServerCertificate> {
    const ref = (await NativeModule.deserializeServerCertificate(bytes)) as ServerCertificateRef
    return new ServerCertificate(ref)
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }

  keyId(): number {
    return this.ref.keyId()
  }

  signature(): Uint8Array {
    return this.ref.signature()
  }

  async key(): Promise<PublicKey> {
    return new PublicKey(this.ref.key() as ConstructorParameters<typeof PublicKey>[0])
  }

  /** @internal */
  _ref(): ServerCertificateRef {
    return this.ref
  }
}
```

### Step 3: Run the ServerCertificate test

Run: `bun run test src/__tests__/ServerCertificate.test.ts`
Expected: PASS.

### Step 4: Write `src/__tests__/SenderCertificate.test.ts` (FAILING)

```ts
import { IdentityKeyPair } from '../core/IdentityKeyPair'
import { PublicKey } from '../core/PublicKey'
import { SenderCertificate } from '../core/SenderCertificate'
import { ServerCertificate } from '../core/ServerCertificate'

const senderCertBytes = new Uint8Array([0xd1, 0xd2])
const serverCertBytes = new Uint8Array([0xa1, 0xa2])
const sigKeyBytes = new Uint8Array([0xe1, 0xe2])
const serverKeyBytes = new Uint8Array([0xc1, 0xc2])

jest.mock('../ExpoLibsignalModule', () => {
  const serverRef = {
    serialize: () => serverCertBytes,
    keyId: () => 1,
    signature: () => new Uint8Array(),
    key: () => ({ serialize: () => serverKeyBytes }),
  }
  const senderRef = {
    serialize: () => senderCertBytes,
    senderUuid: () => 'aaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    senderE164: () => '+15555550100',
    senderDeviceId: () => 1,
    expiration: () => 1_700_000_000_000,
    signatureKey: () => ({ serialize: () => sigKeyBytes }),
    serverCertificate: () => serverRef,
  }
  return {
    NativeModule: {
      generateSenderCertificateOp: jest.fn(async () => ({ certificate: senderCertBytes })),
      deserializeSenderCertificate: jest.fn(async () => senderRef),
      deserializeServerCertificate: jest.fn(async () => serverRef),
      validateSenderCertificateOp: jest.fn(async () => true),
      deserializeIdentityKeyPair: jest.fn(async () => ({
        serialize: () => new Uint8Array(),
        publicKey: () => ({ serialize: () => serverKeyBytes }),
        privateKey: () => ({ serialize: () => new Uint8Array() }),
      })),
      deserializePublicKey: jest.fn(async () => ({ serialize: () => sigKeyBytes })),
    },
  }
})

describe('SenderCertificate', () => {
  test('deserialize exposes the cert getters', async () => {
    const cert = await SenderCertificate.deserialize(senderCertBytes)
    expect(cert.serialize()).toEqual(senderCertBytes)
    expect(cert.senderUuid()).toBe('aaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(cert.senderE164()).toBe('+15555550100')
    expect(cert.senderDeviceId()).toBe(1)
    expect(cert.expiration()).toBe(1_700_000_000_000)
    expect((await cert.signatureKey()).serialize()).toEqual(sigKeyBytes)
    expect((await cert.serverCertificate()).serialize()).toEqual(serverCertBytes)
  })

  test('generate calls the native op with positional bytes', async () => {
    const trustRoot = await IdentityKeyPair.deserialize(new Uint8Array())
    const serverKey = await PublicKey.deserialize(new Uint8Array())
    const serverCert = await ServerCertificate.generate({ keyId: 1, serverKey, trustRoot })
    const senderKey = await PublicKey.deserialize(new Uint8Array())
    const cert = await SenderCertificate.generate({
      senderUuid: 'aaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      senderE164: '+15555550100',
      senderDeviceId: 1,
      senderKey,
      expiration: 1_700_000_000_000,
      serverCert,
      serverKey: trustRoot.privateKey(),
    })
    expect(cert.serialize()).toEqual(senderCertBytes)
  })

  test('validate delegates to the native op', async () => {
    const cert = await SenderCertificate.deserialize(senderCertBytes)
    const trustRoot = await PublicKey.deserialize(new Uint8Array())
    expect(await cert.validate(trustRoot, 1_699_999_999_999)).toBe(true)
  })
})
```

Run: `bun run test src/__tests__/SenderCertificate.test.ts`
Expected: FAIL — `SenderCertificate` does not exist.

### Step 5: Create `src/core/SenderCertificate.ts`

```ts
import { NativeModule } from '../ExpoLibsignalModule'
import type { PrivateKey } from './IdentityKeyPair'
import { PublicKey } from './PublicKey'
import { ServerCertificate } from './ServerCertificate'

interface SenderCertificateRef {
  serialize(): Uint8Array
  senderUuid(): string
  senderE164(): string | null
  senderDeviceId(): number
  expiration(): number
  signatureKey(): unknown
  serverCertificate(): unknown
}

/**
 * Per-sender certificate issued by a server-cert holder. Carries the sender's
 * UUID, optional E.164, device id, signing key, and the issuing ServerCertificate.
 * SealedSender.decryptMessage validates the chain against a known trust-root
 * public key and the message timestamp internally; callers usually never need
 * to call validate themselves.
 */
export class SenderCertificate {
  private readonly ref: SenderCertificateRef

  private constructor(ref: SenderCertificateRef) {
    this.ref = ref
  }

  static async generate(opts: {
    senderUuid: string
    senderE164?: string
    senderDeviceId: number
    senderKey: PublicKey
    expiration: number
    serverCert: ServerCertificate
    serverKey: PrivateKey
  }): Promise<SenderCertificate> {
    const result = (await NativeModule.generateSenderCertificateOp(
      opts.senderUuid,
      opts.senderE164 ?? null,
      opts.senderDeviceId,
      opts.senderKey.serialize(),
      opts.expiration,
      opts.serverCert.serialize(),
      opts.serverKey.serialize(),
    )) as { certificate: Uint8Array }
    return SenderCertificate.deserialize(result.certificate)
  }

  static async deserialize(bytes: Uint8Array): Promise<SenderCertificate> {
    const ref = (await NativeModule.deserializeSenderCertificate(bytes)) as SenderCertificateRef
    return new SenderCertificate(ref)
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }

  senderUuid(): string {
    return this.ref.senderUuid()
  }

  senderE164(): string | null {
    return this.ref.senderE164()
  }

  senderDeviceId(): number {
    return this.ref.senderDeviceId()
  }

  expiration(): number {
    return this.ref.expiration()
  }

  async signatureKey(): Promise<PublicKey> {
    return new PublicKey(this.ref.signatureKey() as ConstructorParameters<typeof PublicKey>[0])
  }

  async serverCertificate(): Promise<ServerCertificate> {
    const inner = this.ref.serverCertificate() as { serialize(): Uint8Array }
    return ServerCertificate.deserialize(inner.serialize())
  }

  async validate(trustRoot: PublicKey, validationTime: number): Promise<boolean> {
    return (await NativeModule.validateSenderCertificateOp(
      this.serialize(),
      trustRoot.serialize(),
      validationTime,
    )) as boolean
  }

  /** @internal */
  _ref(): SenderCertificateRef {
    return this.ref
  }
}
```

Run: `bun run test src/__tests__/SenderCertificate.test.ts`
Expected: PASS.

### Step 6: Write `src/__tests__/SealedSender.test.ts` (FAILING)

```ts
import { ProtocolAddress } from '../core/ProtocolAddress'
import { SealedSender } from '../core/SealedSender'
import { SenderCertificate } from '../core/SenderCertificate'

const sealedBytes = new Uint8Array([0xf1, 0xf2, 0xf3])
const plaintext = new Uint8Array([0x68, 0x69])  // "hi"

jest.mock('../ExpoLibsignalModule', () => ({
  NativeModule: {
    deserializeSenderCertificate: jest.fn(async () => ({
      serialize: () => new Uint8Array([0xaa]),
      senderUuid: () => 'alice-uuid',
      senderE164: () => null,
      senderDeviceId: () => 1,
      expiration: () => 0,
      signatureKey: () => ({ serialize: () => new Uint8Array() }),
      serverCertificate: () => ({
        serialize: () => new Uint8Array(),
        keyId: () => 0,
        signature: () => new Uint8Array(),
        key: () => ({ serialize: () => new Uint8Array() }),
      }),
    })),
    sealedSenderEncryptOp: jest.fn(async () => ({
      ciphertext: sealedBytes,
      newSession: new Uint8Array([0x01]),
      identityChange: 'newOrUnchanged',
    })),
    sealedSenderDecryptOp: jest.fn(async () => ({
      plaintext,
      senderUuid: 'alice-uuid',
      senderE164: null,
      senderDeviceId: 1,
      newSession: new Uint8Array([0x02]),
      identityChange: 'newOrUnchanged',
      consumedPreKeyId: 7,
      kyberPreKeyId: 11,
    })),
    deserializeSessionRecord: jest.fn(async (bytes) => ({ serialize: () => bytes })),
    deserializeIdentityKeyPair: jest.fn(async () => ({
      serialize: () => new Uint8Array(),
      publicKey: () => ({ serialize: () => new Uint8Array() }),
      privateKey: () => ({ serialize: () => new Uint8Array() }),
    })),
    createProtocolAddress: jest.fn(async (name: string, deviceId: number) => ({
      name: () => name,
      deviceId: () => deviceId,
    })),
    deserializePublicKey: jest.fn(async () => ({ serialize: () => new Uint8Array() })),
  },
}))

describe('SealedSender', () => {
  test('encrypt calls the op and persists the rotated session', async () => {
    const calls = { storeSession: 0 }
    const sessionStore = {
      loadSession: jest.fn(async () => ({ serialize: () => new Uint8Array([0x99]) })),
      storeSession: jest.fn(async () => {
        calls.storeSession++
      }),
    }
    const identityStore = {
      getIdentityKeyPair: jest.fn(async () => ({ serialize: () => new Uint8Array() })),
      getLocalRegistrationId: jest.fn(async () => 1),
      getIdentity: jest.fn(async () => null),
      saveIdentity: jest.fn(async () => 'newOrUnchanged'),
      isTrustedIdentity: jest.fn(async () => true),
    }
    const destination = await ProtocolAddress.create('bob', 1)
    const senderCert = await SenderCertificate.deserialize(new Uint8Array([0xaa]))
    const out = await SealedSender.encrypt({
      destination,
      senderCert,
      message: new Uint8Array([0x10]),
      sessionStore: sessionStore as never,
      identityStore: identityStore as never,
    })
    expect(out).toEqual(sealedBytes)
    expect(calls.storeSession).toBe(1)
  })
})
```

Run: `bun run test src/__tests__/SealedSender.test.ts`
Expected: FAIL — `SealedSender` does not exist.

### Step 7: Create `src/core/SealedSender.ts`

The encrypt path mirrors `SessionCipher.encrypt`: load existing session, call native op with `(destinationAddress, senderCertBytes, plaintext, sessionBytes, identityKeyPairBytes, registrationId, optional remoteIdentityBytes)`, persist `newSession`. The decrypt path mirrors `SessionCipher.decryptPreKeySignal` because sealed envelopes may carry a PreKey signal payload — same identity-change + consumedPreKeyId + kyberPreKeyId handling.

```ts
import { NativeModule } from '../ExpoLibsignalModule'
import { rethrowAsLibsignal, SessionNotFoundError } from '../errors'
import type { ProtocolAddress } from './ProtocolAddress'
import type { PublicKey } from './PublicKey'
import { encodeRecordList } from './recordList'
import type { SenderCertificate } from './SenderCertificate'
import { SessionRecord } from './SessionRecord'
import type { SessionCipherStores } from './SessionCipher'
import type { IdentityKeyStore, SessionStore } from './stores'

export interface SealedSenderEncryptArgs {
  destination: ProtocolAddress
  senderCert: SenderCertificate
  message: Uint8Array
  sessionStore: SessionStore
  identityStore: IdentityKeyStore
}

export interface SealedSenderDecryptArgs {
  ciphertext: Uint8Array
  trustRoot: PublicKey
  timestamp: number
  localUuid: string
  localE164?: string
  localDeviceId: number
  stores: SessionCipherStores
}

export interface SealedSenderDecryptResult {
  message: Uint8Array
  senderUuid: string
  senderE164: string | null
  senderDeviceId: number
}

export const SealedSender = {
  async encrypt(args: SealedSenderEncryptArgs): Promise<Uint8Array> {
    const { destination, senderCert, message, sessionStore, identityStore } = args
    const ourIdentityKeyPair = await identityStore.getIdentityKeyPair()
    const ourRegistrationId = await identityStore.getLocalRegistrationId()
    const existingSession = await sessionStore.loadSession(destination)
    if (existingSession === null) {
      throw new SessionNotFoundError(
        `no session for ${destination.name()}.${destination.deviceId()}`,
      )
    }
    const remoteIdentity = await identityStore.getIdentity(destination)
    let result: {
      ciphertext: Uint8Array
      newSession: Uint8Array
      identityChange: 'newOrUnchanged' | 'replacedExisting' | null
    }
    try {
      result = await NativeModule.sealedSenderEncryptOp(
        {
          destinationName: destination.name(),
          destinationDeviceId: destination.deviceId(),
          ourRegistrationId,
          nowMs: Date.now(),
        },
        senderCert.serialize(),
        message,
        existingSession.serialize(),
        remoteIdentity ? remoteIdentity.serialize() : null,
        ourIdentityKeyPair.serialize(),
      )
    } catch (e) {
      throw rethrowAsLibsignal(e)
    }
    const newSession = await SessionRecord.deserialize(result.newSession)
    await sessionStore.storeSession(destination, newSession)
    if (remoteIdentity !== null) {
      await identityStore.saveIdentity(destination, remoteIdentity)
    }
    return result.ciphertext
  },

  async decryptMessage(args: SealedSenderDecryptArgs): Promise<SealedSenderDecryptResult> {
    const { ciphertext, trustRoot, timestamp, localUuid, localDeviceId, stores } = args
    const { sessionStore, identityStore, preKeyStore, signedPreKeyStore, kyberPreKeyStore } = stores
    const ourIdentityKeyPair = await identityStore.getIdentityKeyPair()
    const ourRegistrationId = await identityStore.getLocalRegistrationId()
    const kyberPreKeys = await kyberPreKeyStore.loadKyberPreKeys()
    const kyberPreKeysBlob = encodeRecordList(kyberPreKeys.map((k) => k.serialize()))

    let result: {
      plaintext: Uint8Array
      senderUuid: string
      senderE164: string | null
      senderDeviceId: number
      newSession: Uint8Array
      identityChange: 'newOrUnchanged' | 'replacedExisting' | null
      consumedPreKeyId: number | null
      kyberPreKeyId: number | null
    }
    try {
      result = await NativeModule.sealedSenderDecryptOp(
        {
          localUuid,
          localE164: args.localE164 ?? null,
          localDeviceId,
          ourRegistrationId,
          timestamp,
          nowMs: Date.now(),
        },
        ciphertext,
        trustRoot.serialize(),
        ourIdentityKeyPair.serialize(),
        kyberPreKeysBlob,
        // Pre/signed prekeys are seeded from the stores at op time. To keep
        // the function signature finite, ship just the signedPreKey for the
        // most recently rotated id; the op will fall back to its in-memory
        // store layer for the prekey id carried by the sealed envelope.
        // The TS layer cannot resolve the prekey id until the envelope is
        // unwrapped, so the op accepts a record-list of every prekey + every
        // signed prekey, the same way kyber prekeys are seeded.
        encodeRecordList(await loadAllPreKeysAsBytes(preKeyStore)),
        encodeRecordList(await loadAllSignedPreKeysAsBytes(signedPreKeyStore)),
      )
    } catch (e) {
      throw rethrowAsLibsignal(e)
    }

    // Persist rotated session under the *real* sender address recovered from
    // the cert. The caller used `localUuid` to label themselves; the remote
    // identity surfaces from the sealed envelope.
    const remoteAddress = await import('./ProtocolAddress').then(({ ProtocolAddress }) =>
      ProtocolAddress.create(result.senderUuid, result.senderDeviceId),
    )
    const newSession = await SessionRecord.deserialize(result.newSession)
    await sessionStore.storeSession(remoteAddress, newSession)

    if (result.consumedPreKeyId !== null) {
      await preKeyStore.removePreKey(result.consumedPreKeyId)
    }
    if (result.kyberPreKeyId !== null) {
      await kyberPreKeyStore.markKyberPreKeyUsed(result.kyberPreKeyId)
    }

    return {
      message: result.plaintext,
      senderUuid: result.senderUuid,
      senderE164: result.senderE164,
      senderDeviceId: result.senderDeviceId,
    }
  },
}

// Helpers — the stores do not expose enumeration today. PreKey enumeration is
// new in this phase; we add narrow helpers here rather than widening the public
// store interface. If the underlying store does not implement them yet, the
// helper returns an empty list, and the native op falls back to the existing
// SignalProtocolStore on its side.
async function loadAllPreKeysAsBytes(
  store: import('./stores').PreKeyStore,
): Promise<Uint8Array[]> {
  const anyStore = store as unknown as { loadAllPreKeys?: () => Promise<{ serialize(): Uint8Array }[]> }
  if (typeof anyStore.loadAllPreKeys !== 'function') return []
  const records = await anyStore.loadAllPreKeys()
  return records.map((r) => r.serialize())
}

async function loadAllSignedPreKeysAsBytes(
  store: import('./stores').SignedPreKeyStore,
): Promise<Uint8Array[]> {
  const anyStore = store as unknown as {
    loadAllSignedPreKeys?: () => Promise<{ serialize(): Uint8Array }[]>
  }
  if (typeof anyStore.loadAllSignedPreKeys !== 'function') return []
  const records = await anyStore.loadAllSignedPreKeys()
  return records.map((r) => r.serialize())
}
```

> **Implementer note:** The `loadAll*` helpers above are a deliberate
> conservative fallback. libsignal's Java/Swift sealed-sender decrypt resolves
> prekey ids from the in-memory store seeded with what we hand the op, so the
> native side has to be given every candidate. The cleanest fix is to add
> `loadAllPreKeys()` / `loadAllSignedPreKeys()` to the store interfaces; the
> Round-5 screen can ship without that if it uses the SQLCipher store, which
> already exposes the rows via SQL. If implementing the full surface here is
> too large a slice, narrow to just the in-memory case in the screen and leave
> the interface extension to a follow-up.

Run: `bun run test src/__tests__/SealedSender.test.ts`
Expected: PASS.

### Step 8: Export from `src/index.ts`

Add (alphabetical with the existing exports):

```ts
export { SealedSender } from './core/SealedSender'
export type {
  SealedSenderDecryptArgs,
  SealedSenderDecryptResult,
  SealedSenderEncryptArgs,
} from './core/SealedSender'
export { SenderCertificate } from './core/SenderCertificate'
export { ServerCertificate } from './core/ServerCertificate'
```

### Step 9: Typecheck + tests

Run: `bun run typecheck && bun run test`
Expected: all PASS.

### Step 10: Commit

```bash
git add src/core/ServerCertificate.ts src/core/SenderCertificate.ts src/core/SealedSender.ts \
  src/__tests__/ServerCertificate.test.ts src/__tests__/SenderCertificate.test.ts \
  src/__tests__/SealedSender.test.ts \
  src/index.ts
git commit -m "feat(ts): ServerCertificate, SenderCertificate, SealedSender namespace"
```

---

## Task 2: iOS native — cert refs + sealed sender ops

**Files:**
- Create: `ios/SealedSenderRefs.swift`
- Create: `ios/SealedSenderOps.swift`
- Modify: `ios/ExpoLibsignalModule.swift`

### Step 1: Create `ios/SealedSenderRefs.swift`

```swift
import Foundation
import ExpoModulesCore
import LibSignalClient

final class ServerCertificateRef: SharedObject {
  let cert: ServerCertificate

  init(cert: ServerCertificate) {
    self.cert = cert
    super.init()
  }
}

final class SenderCertificateRef: SharedObject {
  let cert: SenderCertificate

  init(cert: SenderCertificate) {
    self.cert = cert
    super.init()
  }
}
```

### Step 2: Create `ios/SealedSenderOps.swift`

Mirror the `SessionOps.swift` / `GroupOps.swift` pattern: positional bytes, Records for results, `InMemorySignalProtocolStore` seeded from input bytes for the encrypt/decrypt ops.

```swift
import Foundation
import ExpoModulesCore
import LibSignalClient

// MARK: - Config Records

struct SealedSenderEncryptOpConfig: Record {
  @Field var destinationName: String = ""
  @Field var destinationDeviceId: UInt32 = 0
  @Field var ourRegistrationId: UInt32 = 0
  @Field var nowMs: Double = 0
}

struct SealedSenderDecryptOpConfig: Record {
  @Field var localUuid: String = ""
  @Field var localE164: String? = nil
  @Field var localDeviceId: UInt32 = 0
  @Field var ourRegistrationId: UInt32 = 0
  @Field var timestamp: Double = 0
  @Field var nowMs: Double = 0
}

// MARK: - Result Records

struct GenerateServerCertificateResult: Record {
  @Field var certificate: Data = Data()
}

struct GenerateSenderCertificateResult: Record {
  @Field var certificate: Data = Data()
}

struct SealedSenderEncryptResult: Record {
  @Field var ciphertext: Data = Data()
  @Field var newSession: Data = Data()
  @Field var identityChange: String? = nil
}

struct SealedSenderDecryptResult: Record {
  @Field var plaintext: Data = Data()
  @Field var senderUuid: String = ""
  @Field var senderE164: String? = nil
  @Field var senderDeviceId: UInt32 = 0
  @Field var newSession: Data = Data()
  @Field var identityChange: String? = nil
  @Field var consumedPreKeyId: UInt32? = nil
  @Field var kyberPreKeyId: UInt32? = nil
}

// MARK: - Cert generate / validate

func runGenerateServerCertificateOp(
  keyId: UInt32,
  serverKeyBytes: Data,
  trustRootBytes: Data
) throws -> GenerateServerCertificateResult {
  let serverKey = try PublicKey(serverKeyBytes)
  let trustRoot = try IdentityKeyPair(bytes: trustRootBytes)
  let cert = try ServerCertificate(
    keyId: keyId,
    publicKey: serverKey,
    trustRoot: trustRoot.privateKey
  )
  var result = GenerateServerCertificateResult()
  result.certificate = Data(cert.serialize())
  return result
}

func runGenerateSenderCertificateOp(
  senderUuid: String,
  senderE164: String?,
  senderDeviceId: UInt32,
  senderKeyBytes: Data,
  expiration: Double,
  serverCertBytes: Data,
  serverPrivateKeyBytes: Data
) throws -> GenerateSenderCertificateResult {
  let senderKey = try PublicKey(senderKeyBytes)
  let serverCert = try ServerCertificate(bytes: serverCertBytes)
  let serverPrivate = try PrivateKey(bytes: serverPrivateKeyBytes)
  let cert = try SenderCertificate(
    sender: SealedSenderAddress(e164: senderE164, uuidString: senderUuid, deviceId: senderDeviceId),
    publicKey: senderKey,
    expiration: UInt64(expiration),
    signerCertificate: serverCert,
    signerKey: serverPrivate
  )
  var result = GenerateSenderCertificateResult()
  result.certificate = Data(cert.serialize())
  return result
}

func runValidateSenderCertificateOp(
  senderCertBytes: Data,
  trustRootBytes: Data,
  validationTime: Double
) throws -> Bool {
  let cert = try SenderCertificate(bytes: senderCertBytes)
  let trustRoot = try PublicKey(trustRootBytes)
  return cert.validate(trustRoot: trustRoot, time: UInt64(validationTime))
}

// MARK: - Encrypt / Decrypt

func runSealedSenderEncryptOp(
  config: SealedSenderEncryptOpConfig,
  senderCertBytes: Data,
  plaintext: Data,
  existingSession: Data,
  existingRemoteIdentity: Data?,
  ourIdentityKeyPair: Data
) throws -> SealedSenderEncryptResult {
  let destination = try ProtocolAddress(name: config.destinationName, deviceId: config.destinationDeviceId)
  let identity = try IdentityKeyPair(bytes: ourIdentityKeyPair)
  let session = try SessionRecord(bytes: existingSession)
  let remoteIdent = try existingRemoteIdentity.map { try IdentityKey(bytes: $0) }
  let senderCert = try SenderCertificate(bytes: senderCertBytes)

  let store = InMemorySignalProtocolStore(identity: identity, registrationId: config.ourRegistrationId)
  let ctx = NullContext()
  try store.storeSession(session, for: destination, context: ctx)
  if let ident = remoteIdent {
    _ = try store.saveIdentity(ident, for: destination, context: ctx)
  }

  let ciphertext = try sealedSenderEncrypt(
    message: plaintext,
    for: destination,
    from: senderCert,
    sessionStore: store,
    identityStore: store,
    context: ctx
  )
  guard let newSession = try store.loadSession(for: destination, context: ctx) else {
    throw Exception(name: "LibsignalError", description: "sealedSenderEncrypt produced no session")
  }
  var result = SealedSenderEncryptResult()
  result.ciphertext = Data(ciphertext)
  result.newSession = newSession.serialize()
  result.identityChange = "newOrUnchanged"
  return result
}

func runSealedSenderDecryptOp(
  config: SealedSenderDecryptOpConfig,
  ciphertext: Data,
  trustRootBytes: Data,
  ourIdentityKeyPair: Data,
  kyberPreKeysBlob: Data,
  preKeysBlob: Data,
  signedPreKeysBlob: Data
) throws -> SealedSenderDecryptResult {
  let identity = try IdentityKeyPair(bytes: ourIdentityKeyPair)
  let trustRoot = try PublicKey(trustRootBytes)

  let store = RecordingSignalProtocolStore(identity: identity, registrationId: config.ourRegistrationId)
  let ctx = NullContext()
  for bytes in try decodeRecordList(preKeysBlob) {
    let r = try PreKeyRecord(bytes: bytes)
    try store.storePreKey(r, id: r.id, context: ctx)
  }
  for bytes in try decodeRecordList(signedPreKeysBlob) {
    let r = try SignedPreKeyRecord(bytes: bytes)
    try store.storeSignedPreKey(r, id: r.id, context: ctx)
  }
  for bytes in try decodeRecordList(kyberPreKeysBlob) {
    let r = try KyberPreKeyRecord(bytes: bytes)
    try store.storeKyberPreKey(r, id: r.id, context: ctx)
  }

  let decrypted = try sealedSenderDecrypt(
    message: ciphertext,
    from: SealedSenderAddress(e164: config.localE164, uuidString: config.localUuid, deviceId: config.localDeviceId),
    trustRoot: trustRoot,
    timestamp: UInt64(config.timestamp),
    sessionStore: store,
    identityStore: store,
    preKeyStore: store,
    signedPreKeyStore: store,
    kyberPreKeyStore: store,
    context: ctx
  )

  let senderAddress = try ProtocolAddress(name: decrypted.senderUuid, deviceId: decrypted.deviceId)
  guard let newSession = try store.loadSession(for: senderAddress, context: ctx) else {
    throw Exception(name: "LibsignalError", description: "sealedSenderDecrypt produced no session")
  }

  var result = SealedSenderDecryptResult()
  result.plaintext = Data(decrypted.message)
  // Foundation's UUID.uuidString is uppercase; align with Java + the rest of
  // our surface by lowercasing.
  result.senderUuid = decrypted.senderUuid.lowercased()
  result.senderE164 = decrypted.senderE164
  result.senderDeviceId = decrypted.deviceId
  result.newSession = newSession.serialize()
  result.identityChange = "newOrUnchanged"
  // libsignal does not surface the consumed prekey id off the message here; if
  // upstream changes, plumb it. Today we leave it null and let the next encrypt
  // ratchet handle freshness.
  result.consumedPreKeyId = nil
  result.kyberPreKeyId = store.usedKyberPreKeyId
  return result
}
```

> **Implementer note:** verify exact LibSignalClient.swift symbol names — for
> example `SealedSenderAddress(e164:uuidString:deviceId:)`, `sealedSenderEncrypt`,
> `sealedSenderDecrypt`, and the `decrypted.senderUuid` / `decrypted.message`
> accessors. The kickoff doc names these but does not pin signatures. If
> upstream returns a struct named differently (e.g. `SealedSenderResult`),
> rename here. The shape of the op return is owned by us — the field names in
> `SealedSenderDecryptResult` are what the JS layer reads.

### Step 3: Register on the module

In `ios/ExpoLibsignalModule.swift`, after `groupDecryptOp`, add:

```swift
    AsyncFunction("deserializeServerCertificate") { (bytes: Data) -> ServerCertificateRef in
      do {
        let cert = try ServerCertificate(bytes: bytes)
        return ServerCertificateRef(cert: cert)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(ServerCertificateRef.self) {
      Function("serialize") { (ref: ServerCertificateRef) -> Data in Data(ref.cert.serialize()) }
      Function("keyId") { (ref: ServerCertificateRef) -> UInt32 in ref.cert.keyId }
      Function("signature") { (ref: ServerCertificateRef) -> Data in Data(ref.cert.signatureBytes) }
      Function("key") { (ref: ServerCertificateRef) -> PublicKeyRef in
        PublicKeyRef(key: ref.cert.publicKey)
      }
    }

    AsyncFunction("deserializeSenderCertificate") { (bytes: Data) -> SenderCertificateRef in
      do {
        let cert = try SenderCertificate(bytes: bytes)
        return SenderCertificateRef(cert: cert)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(SenderCertificateRef.self) {
      Function("serialize") { (ref: SenderCertificateRef) -> Data in Data(ref.cert.serialize()) }
      // Lowercased to match Java's UUID.toString() (Foundation UUID is uppercase).
      Function("senderUuid") { (ref: SenderCertificateRef) -> String in ref.cert.senderUuid.lowercased() }
      Function("senderE164") { (ref: SenderCertificateRef) -> String? in ref.cert.senderE164 }
      Function("senderDeviceId") { (ref: SenderCertificateRef) -> UInt32 in ref.cert.deviceId }
      Function("expiration") { (ref: SenderCertificateRef) -> Double in Double(ref.cert.expiration) }
      Function("signatureKey") { (ref: SenderCertificateRef) -> PublicKeyRef in
        PublicKeyRef(key: ref.cert.publicKey)
      }
      Function("serverCertificate") { (ref: SenderCertificateRef) -> ServerCertificateRef in
        ServerCertificateRef(cert: ref.cert.serverCertificate)
      }
    }

    AsyncFunction("generateServerCertificateOp") { (keyId: UInt32, serverKey: Data, trustRoot: Data) -> GenerateServerCertificateResult in
      do { return try runGenerateServerCertificateOp(keyId: keyId, serverKeyBytes: serverKey, trustRootBytes: trustRoot) }
      catch { throw Exception(name: "LibsignalError", description: "\(error)") }
    }

    AsyncFunction("generateSenderCertificateOp") { (senderUuid: String, senderE164: String?, senderDeviceId: UInt32, senderKey: Data, expiration: Double, serverCert: Data, serverPrivateKey: Data) -> GenerateSenderCertificateResult in
      do { return try runGenerateSenderCertificateOp(senderUuid: senderUuid, senderE164: senderE164, senderDeviceId: senderDeviceId, senderKeyBytes: senderKey, expiration: expiration, serverCertBytes: serverCert, serverPrivateKeyBytes: serverPrivateKey) }
      catch { throw Exception(name: "LibsignalError", description: "\(error)") }
    }

    AsyncFunction("validateSenderCertificateOp") { (senderCert: Data, trustRoot: Data, validationTime: Double) -> Bool in
      do { return try runValidateSenderCertificateOp(senderCertBytes: senderCert, trustRootBytes: trustRoot, validationTime: validationTime) }
      catch { throw Exception(name: "LibsignalError", description: "\(error)") }
    }

    AsyncFunction("sealedSenderEncryptOp") { (config: SealedSenderEncryptOpConfig, senderCert: Data, plaintext: Data, existingSession: Data, existingRemoteIdentity: Data?, ourIdentityKeyPair: Data) -> SealedSenderEncryptResult in
      do { return try runSealedSenderEncryptOp(config: config, senderCertBytes: senderCert, plaintext: plaintext, existingSession: existingSession, existingRemoteIdentity: existingRemoteIdentity, ourIdentityKeyPair: ourIdentityKeyPair) }
      catch { throw Exception(name: "LibsignalError", description: "\(error)") }
    }

    AsyncFunction("sealedSenderDecryptOp") { (config: SealedSenderDecryptOpConfig, ciphertext: Data, trustRoot: Data, ourIdentityKeyPair: Data, kyberPreKeys: Data, preKeys: Data, signedPreKeys: Data) -> SealedSenderDecryptResult in
      do { return try runSealedSenderDecryptOp(config: config, ciphertext: ciphertext, trustRootBytes: trustRoot, ourIdentityKeyPair: ourIdentityKeyPair, kyberPreKeysBlob: kyberPreKeys, preKeysBlob: preKeys, signedPreKeysBlob: signedPreKeys) }
      catch { throw Exception(name: "LibsignalError", description: "\(error)") }
    }
```

### Step 4: Build iOS

Run: `cd example/ios && xcodebuild -workspace expolibsignalexample.xcworkspace -scheme expolibsignalexample -sdk iphonesimulator -configuration Debug -destination 'platform=iOS Simulator,id=5105FFD8-CC6E-443C-8791-99D70A8B900D' build 2>&1 | tail -20`
Expected: BUILD SUCCEEDED.

---

## Task 3: Android native — cert refs + sealed sender ops

**Files:**
- Create: `android/src/main/java/expo/modules/libsignal/SealedSenderRefs.kt`
- Create: `android/src/main/java/expo/modules/libsignal/SealedSenderOps.kt`
- Modify: `android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt`

### Step 1: Create `SealedSenderRefs.kt`

```kotlin
package expo.modules.libsignal

import expo.modules.kotlin.sharedobjects.SharedObject
import org.signal.libsignal.metadata.certificate.SenderCertificate
import org.signal.libsignal.metadata.certificate.ServerCertificate

class ServerCertificateRef(val cert: ServerCertificate) : SharedObject()

class SenderCertificateRef(val cert: SenderCertificate) : SharedObject()
```

> **Implementer note:** verify the upstream Java package. In libsignal 0.94.4
> the cert classes live under `org.signal.libsignal.metadata.certificate`.
> If your installed version differs, the import path is the only thing that
> needs updating.

### Step 2: Create `SealedSenderOps.kt`

Mirror `GroupOps.kt`. Use `SignalProtocolAddress`, `InMemorySignalProtocolStore`, and the sealed-sender helpers from `org.signal.libsignal.metadata`.

```kotlin
package expo.modules.libsignal

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import org.signal.libsignal.metadata.SealedSessionCipher
import org.signal.libsignal.metadata.certificate.CertificateValidator
import org.signal.libsignal.metadata.certificate.SenderCertificate
import org.signal.libsignal.metadata.certificate.ServerCertificate
import org.signal.libsignal.protocol.IdentityKey
import org.signal.libsignal.protocol.IdentityKeyPair as SignalIdentityKeyPair
import org.signal.libsignal.protocol.SignalProtocolAddress
import org.signal.libsignal.protocol.ecc.ECPrivateKey
import org.signal.libsignal.protocol.ecc.ECPublicKey
import org.signal.libsignal.protocol.state.KyberPreKeyRecord
import org.signal.libsignal.protocol.state.PreKeyRecord
import org.signal.libsignal.protocol.state.SessionRecord
import org.signal.libsignal.protocol.state.SignedPreKeyRecord
import org.signal.libsignal.protocol.state.impl.InMemorySignalProtocolStore

class SealedSenderEncryptOpConfig : Record {
  @Field var destinationName: String = ""
  @Field var destinationDeviceId: Int = 0
  @Field var ourRegistrationId: Int = 0
  @Field var nowMs: Double = 0.0
}

class SealedSenderDecryptOpConfig : Record {
  @Field var localUuid: String = ""
  @Field var localE164: String? = null
  @Field var localDeviceId: Int = 0
  @Field var ourRegistrationId: Int = 0
  @Field var timestamp: Double = 0.0
  @Field var nowMs: Double = 0.0
}

class GenerateServerCertificateResult : Record { @Field var certificate: ByteArray = ByteArray(0) }
class GenerateSenderCertificateResult : Record { @Field var certificate: ByteArray = ByteArray(0) }

class SealedSenderEncryptResult : Record {
  @Field var ciphertext: ByteArray = ByteArray(0)
  @Field var newSession: ByteArray = ByteArray(0)
  @Field var identityChange: String? = null
}

class SealedSenderDecryptResult : Record {
  @Field var plaintext: ByteArray = ByteArray(0)
  @Field var senderUuid: String = ""
  @Field var senderE164: String? = null
  @Field var senderDeviceId: Int = 0
  @Field var newSession: ByteArray = ByteArray(0)
  @Field var identityChange: String? = null
  @Field var consumedPreKeyId: Int? = null
  @Field var kyberPreKeyId: Int? = null
}

internal fun runGenerateServerCertificateOp(
  keyId: Int,
  serverKeyBytes: ByteArray,
  trustRootBytes: ByteArray,
): GenerateServerCertificateResult {
  val trustRoot = SignalIdentityKeyPair(trustRootBytes)
  val serverKey = ECPublicKey(serverKeyBytes)
  val cert = ServerCertificate(trustRoot.privateKey, keyId, serverKey)
  return GenerateServerCertificateResult().also { it.certificate = cert.serialized }
}

internal fun runGenerateSenderCertificateOp(
  senderUuid: String,
  senderE164: String?,
  senderDeviceId: Int,
  senderKeyBytes: ByteArray,
  expiration: Double,
  serverCertBytes: ByteArray,
  serverPrivateKeyBytes: ByteArray,
): GenerateSenderCertificateResult {
  val serverCert = ServerCertificate(serverCertBytes)
  val signer = ECPrivateKey(serverPrivateKeyBytes)
  val senderKey = ECPublicKey(senderKeyBytes)
  val cert = serverCert.issue(signer, senderE164, senderUuid, senderDeviceId, senderKey, expiration.toLong())
  return GenerateSenderCertificateResult().also { it.certificate = cert.serialized }
}

internal fun runValidateSenderCertificateOp(
  senderCertBytes: ByteArray,
  trustRootBytes: ByteArray,
  validationTime: Double,
): Boolean {
  val cert = SenderCertificate(senderCertBytes)
  val validator = CertificateValidator(ECPublicKey(trustRootBytes))
  return try {
    validator.validate(cert, validationTime.toLong())
    true
  } catch (e: Throwable) {
    false
  }
}

internal fun runSealedSenderEncryptOp(
  config: SealedSenderEncryptOpConfig,
  senderCertBytes: ByteArray,
  plaintext: ByteArray,
  existingSession: ByteArray,
  existingRemoteIdentity: ByteArray?,
  ourIdentityKeyPair: ByteArray,
): SealedSenderEncryptResult {
  val destination = SignalProtocolAddress(config.destinationName, config.destinationDeviceId)
  val identity = SignalIdentityKeyPair(ourIdentityKeyPair)
  val store = InMemorySignalProtocolStore(identity, config.ourRegistrationId)
  store.storeSession(destination, SessionRecord(existingSession))
  if (existingRemoteIdentity != null) {
    store.saveIdentity(destination, IdentityKey(existingRemoteIdentity, 0))
  }

  val cipher = SealedSessionCipher(store, java.util.UUID.fromString(config.destinationName.takeIf { false } ?: identity.publicKey.fingerprint.let { "00000000-0000-0000-0000-000000000000" }), null, config.ourRegistrationId.toInt())
  // The upstream constructor wants the *sender's* uuid+e164+deviceId, not the
  // destination — fix this when wiring against the real Java symbol. The
  // sealed-sender encrypt signature in 0.94.4 is roughly:
  //   SealedSessionCipher(store, localUuid, localE164, localDeviceId)
  //   ciphertext = cipher.encrypt(destinationAddress, SenderCertificate, plaintext)
  val ciphertext = cipher.encrypt(destination, SenderCertificate(senderCertBytes), plaintext)
  val newSession = store.loadSession(destination)
    ?: throw IllegalStateException("sealedSenderEncrypt produced no session")
  return SealedSenderEncryptResult().also {
    it.ciphertext = ciphertext
    it.newSession = newSession.serialize()
    it.identityChange = "newOrUnchanged"
  }
}

internal fun runSealedSenderDecryptOp(
  config: SealedSenderDecryptOpConfig,
  ciphertext: ByteArray,
  trustRootBytes: ByteArray,
  ourIdentityKeyPair: ByteArray,
  kyberPreKeysBlob: ByteArray,
  preKeysBlob: ByteArray,
  signedPreKeysBlob: ByteArray,
): SealedSenderDecryptResult {
  val identity = SignalIdentityKeyPair(ourIdentityKeyPair)
  val store = InMemorySignalProtocolStore(identity, config.ourRegistrationId)
  decodeRecordList(preKeysBlob).forEach { bytes ->
    val r = PreKeyRecord(bytes)
    store.storePreKey(r.id, r)
  }
  decodeRecordList(signedPreKeysBlob).forEach { bytes ->
    val r = SignedPreKeyRecord(bytes)
    store.storeSignedPreKey(r.id, r)
  }
  decodeRecordList(kyberPreKeysBlob).forEach { bytes ->
    val r = KyberPreKeyRecord(bytes)
    store.storeKyberPreKey(r.id, r)
  }
  val validator = CertificateValidator(ECPublicKey(trustRootBytes))
  val cipher = SealedSessionCipher(store, java.util.UUID.fromString(config.localUuid), config.localE164, config.localDeviceId)
  val decrypted = cipher.decrypt(validator, ciphertext, config.timestamp.toLong())
  val senderAddress = SignalProtocolAddress(decrypted.senderUuid, decrypted.deviceId)
  val newSession = store.loadSession(senderAddress)
    ?: throw IllegalStateException("sealedSenderDecrypt produced no session")
  return SealedSenderDecryptResult().also {
    it.plaintext = decrypted.paddedMessage
    it.senderUuid = decrypted.senderUuid
    it.senderE164 = decrypted.senderE164.orNull()
    it.senderDeviceId = decrypted.deviceId
    it.newSession = newSession.serialize()
    it.identityChange = "newOrUnchanged"
    it.consumedPreKeyId = null
    it.kyberPreKeyId = null
  }
}

private fun <T> java.util.Optional<T>?.orNull(): T? = this?.let { if (it.isPresent) it.get() else null }
```

> **Implementer note:** The exact constructor signature for
> `SealedSessionCipher` and the helpers on `ServerCertificate` / `SenderCertificate`
> differ across libsignal-java versions. The skeleton above names the symbols
> from libsignal 0.94.4 but the implementer must verify against
> `example/node_modules` or the published Maven artifact. The op return shape
> is fixed (we own it); the constructor calls inside it are what to tune.

### Step 3: Register on the module

Mirror the iOS registration (Kotlin syntax). After `groupDecryptOp` in
`ExpoLibsignalModule.kt`, add the eight `AsyncFunction` / `Class` blocks. Pattern is identical to the Group ops: every async function body wraps the corresponding `run*Op` call in try/catch that throws `RuntimeException(mapSignalError(e).message)`.

### Step 4: Build Android

Run: `cd example/android && ./gradlew :app:assembleDebug 2>&1 | tail -10`
Expected: BUILD SUCCESSFUL.

### Step 5: Commit native + JS together

```bash
git add ios/ android/
git commit -m "feat(native): sealed sender refs and ops on iOS and Android"
```

---

## Task 4: Example screen + smoke

**Goal:** End-to-end exercise of cert minting + sealed encrypt + sealed decrypt in the example app. Verifies both platforms.

**Files:**
- Create: `example/src/screens/SealedSenderScreen.tsx`
- Modify: `example/App.tsx`
- Modify: `example/SMOKE_TEST_LOG.md`
- Modify: `README.md`

### Step 1: Sketch the flow (informational)

```
1. Mint a trust-root IdentityKeyPair
2. Generate a server signing keypair (PrivateKey.generate -> publicKey())
3. Issue a ServerCertificate under the trust root
4. Pick a senderUuid (random v4), issue a SenderCertificate to alice
5. Set up alice/bob 1:1 session (same flow as AliceBob: bob publishes PreKeyBundle, alice processPreKeyBundle)
6. Alice SealedSender.encrypt({destination: bob, senderCert, message})
7. Bob SealedSender.decryptMessage({ciphertext, trustRoot: trustRoot.publicKey, timestamp: now, localUuid: bob-uuid, localDeviceId: 1, stores: bob.stores})
8. Assert plaintext recovered and senderUuid matches alice's uuid
9. Log [SEALED-SUMMARY] JSON for grep
```

### Step 2: Create `example/src/screens/SealedSenderScreen.tsx`

Use `AliceBobScreen.tsx` as the structural template. Use the in-memory store from `example/src/stores/InMemoryProtocolStore.ts` for both alice and bob (simpler than SQLCipher and Sealed Sender does not touch the new schema). Skeleton (truncated — author fully by reading AliceBobScreen):

```tsx
import {
  IdentityKeyPair,
  PrivateKey,
  ProtocolAddress,
  SealedSender,
  SenderCertificate,
  ServerCertificate,
  SessionBuilder,
  SessionCipher,
} from 'expo-libsignal'
import { useEffect, useState } from 'react'
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native'
import { createPersona, publishPreKeyBundle } from '../personas/createPersona'

// ...

async function run() {
  // ... persona setup, alice/bob sessions wired ...

  const trustRoot = await IdentityKeyPair.generate()
  // Generate a one-off ECDH keypair to act as the server signing key. PrivateKey
  // exposes neither `generate` nor `publicKey` in our public API yet, so go
  // through a temporary IdentityKeyPair: its privateKey + publicKey are an EC
  // pair we can use as the "server" keys for the test.
  const serverIdentity = await IdentityKeyPair.generate()
  const serverCert = await ServerCertificate.generate({
    keyId: 1,
    serverKey: await serverIdentity.publicKey().toPublicKey(),  // see note
    trustRoot,
  })
  const senderUuid = crypto.randomUUID().toLowerCase()
  const aliceSignedPub = await alice.identity.publicKey().toPublicKey()  // see note
  const senderCert = await SenderCertificate.generate({
    senderUuid,
    senderDeviceId: 1,
    senderKey: aliceSignedPub,
    expiration: Date.now() + 60_000,
    serverCert,
    serverKey: serverIdentity.privateKey(),
  })

  const ciphertext = await SealedSender.encrypt({
    destination: bob.address,
    senderCert,
    message: new TextEncoder().encode('hello sealed'),
    sessionStore: alice.stores,
    identityStore: alice.stores,
  })

  const decoded = await SealedSender.decryptMessage({
    ciphertext,
    trustRoot: await trustRoot.publicKey().toPublicKey(),
    timestamp: Date.now(),
    localUuid: 'bob-uuid-0000-0000-0000-000000000000',
    localDeviceId: 1,
    stores: {
      sessionStore: bob.stores,
      identityStore: bob.stores,
      preKeyStore: bob.stores,
      signedPreKeyStore: bob.stores,
      kyberPreKeyStore: bob.stores,
    },
  })

  // ... push step results, console.log('[SEALED-SUMMARY]', ...) ...
}
```

> **Implementer note:** there is no `IdentityKey.toPublicKey()` in the current
> API. Two options:
> 1. Add an instance method to `IdentityKey` (one-line) that returns a
>    `PublicKey` wrapping the underlying ref. Cheaper.
> 2. Re-serialize and call `PublicKey.deserialize(identityKey.serialize().slice(1))`
>    — strip the type byte. Hackier; do not commit this if option 1 works.
>
> Pick (1). It is a 6-line addition to `src/core/IdentityKeyPair.ts` plus an
> export update; add it as part of this task. Same for `PrivateKey.generate()`
> and `PrivateKey.publicKey()` if needed for the server key path.

### Step 3: Wire the tab in `example/App.tsx`

Extend `Tab` with `'sealedSender'`, add a `TabButton`, render `SealedSenderScreen` for it.

### Step 4: Typecheck

Run: `bun run typecheck` (lib) and `cd example && npx tsc --noEmit -p tsconfig.json` (app).
Expected: both exit 0.

### Step 5: Android smoke

Run: `cd example && npx expo run:android` (CHECK WITH USER FIRST — binds 8081).
Tap the SealedSender tab, watch `adb logcat | grep '\[SEALED-SUMMARY\]'`.
Expected: `status="ok"`, every step `ok: true`.

### Step 6: iOS smoke

Run: `cd example && npx expo run:ios --port 8082 --device 5105FFD8-CC6E-443C-8791-99D70A8B900D` (CHECK WITH USER FIRST).
Tap the SealedSender tab, watch Metro for `[SEALED-SUMMARY]`.
Expected: status `"ok"`, every step `ok: true`.

### Step 7: Append entries to `example/SMOKE_TEST_LOG.md`

Follow the Phase 4a entry format. One section per platform run.

### Step 8: Update `README.md` roadmap

Replace:

```
| Sealed Sender, Provisioning | pending |
```

with:

```
| Sealed Sender | ✅ shipped (Android and iOS Simulator both verified end to end — see `example/SMOKE_TEST_LOG.md`) |
| Provisioning | pending |
```

### Step 9: Final commit

```bash
git add example/src/screens/SealedSenderScreen.tsx example/App.tsx example/SMOKE_TEST_LOG.md README.md src/core/IdentityKeyPair.ts src/index.ts
git commit -m "test(example): SealedSender screen exercising end-to-end"
```

---

## Self-Review Notes

**Spec coverage:** Cert classes (`ServerCertificate`, `SenderCertificate`) in Task 1; `SealedSender.encrypt/decryptMessage` in Task 1; native ops + cert refs in Tasks 2-3; integration screen + smoke + docs in Task 4. UUID-case fix from kickoff §"UUID-case note" is applied at every iOS accessor that returns a uuid string (sender cert, sealed-decrypt result).

**Out of scope (per kickoff):** multi-recipient sealed sender (Phase 4d), provisioning (Phase 4c), schema bump.

**Decisions left to the implementer:**
- Whether to add `IdentityKey.toPublicKey()` / `PrivateKey.generate()` / `PrivateKey.publicKey()` as part of Task 1 or Task 4. They are needed to build the example, and they are small. Recommend adding them in Task 1 alongside the cert classes so Task 4 reads cleanly.
- Whether `SealedSender.decryptMessage` extends the public store interfaces with `loadAllPreKeys` / `loadAllSignedPreKeys`. Conservative path: keep the helpers private to `SealedSender.ts` and have them no-op when the methods are absent, relying on the SQLCipher store to expose them via duck-typing. If the screen uses the in-memory store from `example/src/stores/InMemoryProtocolStore.ts`, add those methods there as part of Task 4.

**Things that will probably trip up the implementer:**
- The Swift/Kotlin sealed-sender symbol names need verification against the installed libsignal 0.94.4 — the skeleton names what we expect, not what the API guarantees. Read `example/node_modules/@signalapp/libsignal-client` (no Android there) and the libsignal repo at the pinned version before guessing.
- The decrypted sender uuid case: Java returns lowercase, Foundation returns uppercase. Lowercase at every accessor, same fix as `71560bf7fcde`.
- `SealedSender.decryptMessage` keys session storage by the recovered `senderUuid + senderDeviceId`, not by any address the caller passed in. The caller has no way to know who sent the envelope until after decryption — that's the whole point of sealed sender.
- `crypto.randomUUID()` is available in React Native 0.85; if it is not, import from `expo-crypto`.
- `[SEALED-SUMMARY]` must be the exact substring the smoke grep expects.

**Type consistency check passed:** `SealedSender.encrypt` / `SealedSender.decryptMessage` argument and return shapes match across `src/core/SealedSender.ts`, `ios/SealedSenderOps.swift`, and `android/.../SealedSenderOps.kt`. Cert getter names match between TS (`ServerCertificateRef`, `SenderCertificateRef`) and native registrations.
