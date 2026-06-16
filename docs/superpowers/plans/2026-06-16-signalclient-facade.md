# SignalClient Facade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an example-level `SignalClient` facade and a split-view chat demo that exercises 1:1 (with sealed-sender toggle) and groups (alice/bob/carol), smoked on both platforms.

**Architecture:** A thin stateful TypeScript class living in `example/src/client/`. Owns the `SQLCipherProtocolStore` + local address. Boundary types (`Address`, `Envelope`, `Received`, `PublishedBundle`) are plain objects so apps don't have to pass `ProtocolAddress` around. Library is unchanged.

**Tech Stack:** TypeScript + Jest, existing `expo-libsignal` package + its `SQLCipherProtocolStore`, React Native for the demo screen.

**Spec:** `docs/superpowers/specs/2026-06-16-signalclient-facade-design.md`.

---

## File Structure

New files:
- `example/src/client/SignalClient.ts` — facade class + boundary types
- `example/src/client/SignalGroupClient.ts` — group sub-facade
- `example/src/client/__tests__/SignalClient.test.ts` — unit tests
- `example/src/screens/SignalClientScreen.tsx` — split-view chat demo

Modified files:
- `example/App.tsx` — add the `'signalClient'` tab
- `example/SMOKE_TEST_LOG.md` — append dated entries per platform
- `README.md` — note the facade pattern lives in the example

The plan does NOT modify `src/`. The library stays unchanged for this phase.

---

## Task 1: Boundary types, SignalClient open/initialize/identity

**Why first:** Locks in the type vocabulary every subsequent task references. Smallest commit that's still tested.

**Files:**
- Create: `example/src/client/SignalClient.ts`
- Create: `example/src/client/__tests__/SignalClient.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { ProtocolAddress } from 'expo-libsignal'

jest.mock('expo-libsignal/stores', () => {
  const store = {
    hasLocalIdentity: jest.fn(async () => false),
    initializeLocalIdentity: jest.fn(async () => {}),
    getIdentityKeyPair: jest.fn(async () => ({
      publicKey: () => ({ serialize: () => new Uint8Array([1, 2, 3]) }),
    })),
    close: jest.fn(async () => {}),
  }
  return {
    SQLCipherProtocolStore: {
      open: jest.fn(async () => store),
    },
    __store: store,
  }
})
jest.mock('expo-libsignal', () => {
  const actual = jest.requireActual('expo-libsignal')
  return {
    ...actual,
    IdentityKeyPair: { generate: jest.fn(async () => ({ tag: 'kp' })) },
  }
})

import { SignalClient } from '../SignalClient'
const stores = jest.requireMock('expo-libsignal/stores')

describe('SignalClient — open + initialize', () => {
  beforeEach(() => jest.clearAllMocks())

  test('open creates a store and returns a client tied to self', async () => {
    const client = await SignalClient.open({
      databaseName: 'alice.db',
      keyAlias: 'alice.dbkey',
      self: { name: 'alice', deviceId: 1 },
    })
    expect(stores.SQLCipherProtocolStore.open).toHaveBeenCalledWith({
      databaseName: 'alice.db',
      keyAlias: 'alice.dbkey',
    })
    expect(client).toBeInstanceOf(SignalClient)
  })

  test('initializeIfNeeded generates an identity when none exists', async () => {
    const client = await SignalClient.open({
      databaseName: 'a.db',
      keyAlias: 'a.k',
      self: { name: 'alice', deviceId: 1 },
    })
    await client.initializeIfNeeded({ registrationId: 12345 })
    expect(stores.__store.initializeLocalIdentity).toHaveBeenCalledTimes(1)
    expect(stores.__store.initializeLocalIdentity.mock.calls[0][1]).toBe(12345)
  })

  test('initializeIfNeeded is a no-op when identity already exists', async () => {
    stores.__store.hasLocalIdentity.mockResolvedValueOnce(true)
    const client = await SignalClient.open({
      databaseName: 'a.db',
      keyAlias: 'a.k',
      self: { name: 'alice', deviceId: 1 },
    })
    await client.initializeIfNeeded({ registrationId: 12345 })
    expect(stores.__store.initializeLocalIdentity).not.toHaveBeenCalled()
  })

  test('hasIdentity delegates to the store', async () => {
    stores.__store.hasLocalIdentity.mockResolvedValueOnce(true)
    const client = await SignalClient.open({
      databaseName: 'a.db',
      keyAlias: 'a.k',
      self: { name: 'alice', deviceId: 1 },
    })
    expect(await client.hasIdentity()).toBe(true)
  })

  test('close delegates to the store', async () => {
    const client = await SignalClient.open({
      databaseName: 'a.db',
      keyAlias: 'a.k',
      self: { name: 'alice', deviceId: 1 },
    })
    await client.close()
    expect(stores.__store.close).toHaveBeenCalled()
  })
})
```

Run: `bun run test example/src/client/__tests__/SignalClient.test.ts`
Expected: FAIL — `SignalClient` does not exist.

- [ ] **Step 2: Create `example/src/client/SignalClient.ts`**

```ts
import { IdentityKey, IdentityKeyPair, type PublicKey, ProtocolAddress, type SenderCertificate } from 'expo-libsignal'
import { SQLCipherProtocolStore } from 'expo-libsignal/stores'

// Plain-object boundary types. Apps never construct ProtocolAddress directly.
export type Address = { name: string; deviceId: number }

// Bundle shape an app would POST to / fetch from its server. Mirrors
// PreKeyBundle.create args; bytes are pre-serialized so the JSON round-trips.
export type PublishedBundle = {
  registrationId: number
  deviceId: number
  identityKey: Uint8Array
  signedPreKeyId: number
  signedPreKeyPublic: Uint8Array
  signedPreKeySignature: Uint8Array
  kyberPreKeyId: number
  kyberPreKeyPublic: Uint8Array
  kyberPreKeySignature: Uint8Array
  preKeyId?: number
  preKeyPublic?: Uint8Array
}

// Tagged transport union. Sender produces; receiver dispatches.
export type Envelope =
  | { type: 'preKeySignal' | 'signal'; from: Address; bytes: Uint8Array }
  | { type: 'sealed'; bytes: Uint8Array }
  | { type: 'sender-key-distribution'; from: Address; bytes: Uint8Array; distributionId: string }
  | { type: 'group'; from: Address; distributionId: string; bytes: Uint8Array }

// What receive() returns. App switches on `kind`.
export type Received =
  | { kind: 'message'; from: Address; plaintext: string; sealed: boolean }
  | { kind: 'group-message'; from: Address; distributionId: string; plaintext: string }
  | { kind: 'group-welcome'; from: Address; distributionId: string }

export class SignalClient {
  /** @internal */ readonly store: SQLCipherProtocolStore
  /** @internal */ readonly self: ProtocolAddress
  /** @internal */ readonly selfAddress: Address

  private constructor(store: SQLCipherProtocolStore, self: ProtocolAddress, selfAddress: Address) {
    this.store = store
    this.self = self
    this.selfAddress = selfAddress
  }

  static async open(opts: {
    databaseName: string
    keyAlias: string
    self: Address
  }): Promise<SignalClient> {
    const store = await SQLCipherProtocolStore.open({
      databaseName: opts.databaseName,
      keyAlias: opts.keyAlias,
    })
    const self = await ProtocolAddress.create(opts.self.name, opts.self.deviceId)
    return new SignalClient(store, self, opts.self)
  }

  async initializeIfNeeded(opts: { registrationId: number }): Promise<void> {
    if (await this.store.hasLocalIdentity()) return
    const identity = await IdentityKeyPair.generate()
    await this.store.initializeLocalIdentity(identity, opts.registrationId)
  }

  async hasIdentity(): Promise<boolean> {
    return this.store.hasLocalIdentity()
  }

  async identityKey(): Promise<IdentityKey> {
    const kp = await this.store.getIdentityKeyPair()
    return kp.publicKey()
  }

  async close(): Promise<void> {
    await this.store.close()
  }
}
```

- [ ] **Step 3: Run the tests**

Run: `bun run test example/src/client/__tests__/SignalClient.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add example/src/client/SignalClient.ts example/src/client/__tests__/SignalClient.test.ts
git commit -m "feat(example): SignalClient facade skeleton — open, initialize, identity"
```

---

## Task 2: publishOneTimePreKey, startSession, 1:1 send/receive

**Files:**
- Modify: `example/src/client/SignalClient.ts`
- Modify: `example/src/client/__tests__/SignalClient.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `example/src/client/__tests__/SignalClient.test.ts`:

```ts
describe('SignalClient — 1:1 send/receive', () => {
  beforeEach(() => jest.clearAllMocks())

  test('publishOneTimePreKey persists records and returns a bundle', async () => {
    // Mock the generators on each Record class to return an object with
    // a stable serialize() + the accessors PreKeyBundle.create needs.
    const PreKeyRecord = require('expo-libsignal').PreKeyRecord
    PreKeyRecord.generate = jest.fn(async () => ({
      serialize: () => new Uint8Array([0xa]),
      publicKey: () => ({ serialize: () => new Uint8Array([0xb]) }),
    }))
    const SignedPreKeyRecord = require('expo-libsignal').SignedPreKeyRecord
    SignedPreKeyRecord.generate = jest.fn(async () => ({
      serialize: () => new Uint8Array([0xc]),
      publicKey: () => ({ serialize: () => new Uint8Array([0xd]) }),
      signature: () => new Uint8Array([0xe]),
    }))
    const KyberPreKeyRecord = require('expo-libsignal').KyberPreKeyRecord
    KyberPreKeyRecord.generate = jest.fn(async () => ({
      serialize: () => new Uint8Array([0xf]),
      kyberPublicKey: () => new Uint8Array([0x11]),
      signature: () => new Uint8Array([0x12]),
    }))
    stores.__store.storePreKey = jest.fn(async () => {})
    stores.__store.storeSignedPreKey = jest.fn(async () => {})
    stores.__store.storeKyberPreKey = jest.fn(async () => {})
    stores.__store.getLocalRegistrationId = jest.fn(async () => 42)
    stores.__store.getIdentityKeyPair = jest.fn(async () => ({
      publicKey: () => ({ serialize: () => new Uint8Array([0x99]) }),
    }))

    const client = await SignalClient.open({
      databaseName: 'a.db', keyAlias: 'a.k',
      self: { name: 'alice', deviceId: 1 },
    })
    const bundle = await client.publishOneTimePreKey({
      preKeyId: 100, signedPreKeyId: 200, kyberPreKeyId: 300,
    })
    expect(bundle.registrationId).toBe(42)
    expect(bundle.deviceId).toBe(1)
    expect(bundle.preKeyId).toBe(100)
    expect(bundle.signedPreKeyId).toBe(200)
    expect(bundle.kyberPreKeyId).toBe(300)
    expect(stores.__store.storePreKey).toHaveBeenCalledWith(100, expect.anything())
    expect(stores.__store.storeSignedPreKey).toHaveBeenCalledWith(200, expect.anything())
    expect(stores.__store.storeKyberPreKey).toHaveBeenCalledWith(300, expect.anything())
  })

  test('send returns a tagged envelope and persists session state', async () => {
    const encrypted = {
      type: 'preKeySignal',
      serialize: () => new Uint8Array([0xaa, 0xbb]),
    }
    const SessionCipher = require('expo-libsignal').SessionCipher
    SessionCipher.prototype.encrypt = jest.fn(async () => encrypted)

    const client = await SignalClient.open({
      databaseName: 'a.db', keyAlias: 'a.k',
      self: { name: 'alice', deviceId: 1 },
    })
    const env = await client.send({ name: 'bob', deviceId: 1 }, 'hi')
    expect(env.type).toBe('preKeySignal')
    expect(env).toMatchObject({ from: { name: 'alice', deviceId: 1 } })
    if (env.type === 'preKeySignal' || env.type === 'signal') {
      expect(env.bytes).toEqual(new Uint8Array([0xaa, 0xbb]))
    } else {
      throw new Error('wrong type')
    }
  })

  test('receive dispatches preKeySignal envelope to decryptPreKeySignal', async () => {
    const SessionCipher = require('expo-libsignal').SessionCipher
    SessionCipher.prototype.decryptPreKeySignal = jest.fn(async () =>
      new TextEncoder().encode('hi'),
    )
    const PreKeySignalMessage = require('expo-libsignal').PreKeySignalMessage
    PreKeySignalMessage.deserialize = jest.fn(async (b: Uint8Array) => ({ serialize: () => b }))

    const client = await SignalClient.open({
      databaseName: 'b.db', keyAlias: 'b.k',
      self: { name: 'bob', deviceId: 1 },
    })
    const received = await client.receive({
      type: 'preKeySignal',
      from: { name: 'alice', deviceId: 1 },
      bytes: new Uint8Array([0xaa, 0xbb]),
    })
    expect(received).toEqual({
      kind: 'message',
      from: { name: 'alice', deviceId: 1 },
      plaintext: 'hi',
      sealed: false,
    })
  })
})
```

Run: `bun run test example/src/client/__tests__/SignalClient.test.ts`
Expected: FAIL — new methods don't exist.

- [ ] **Step 2: Extend `SignalClient.ts`**

Add to the imports:

```ts
import {
  KyberPreKeyRecord,
  PreKeyBundle,
  PreKeyRecord,
  PreKeySignalMessage,
  SessionBuilder,
  SessionCipher,
  SignalMessage,
  SignedPreKeyRecord,
} from 'expo-libsignal'
```

Add inside the `SignalClient` class body (after `close`):

```ts
  async publishOneTimePreKey(opts: {
    preKeyId: number
    signedPreKeyId: number
    kyberPreKeyId: number
  }): Promise<PublishedBundle> {
    const identityKp = await this.store.getIdentityKeyPair()
    const registrationId = await this.store.getLocalRegistrationId()
    const ts = Date.now()
    const preKey = await PreKeyRecord.generate(opts.preKeyId)
    const signedPreKey = await SignedPreKeyRecord.generate(opts.signedPreKeyId, identityKp, ts)
    const kyberPreKey = await KyberPreKeyRecord.generate(opts.kyberPreKeyId, identityKp, ts)
    await this.store.runExclusive(async () => {
      await this.store.storePreKey(opts.preKeyId, preKey)
      await this.store.storeSignedPreKey(opts.signedPreKeyId, signedPreKey)
      await this.store.storeKyberPreKey(opts.kyberPreKeyId, kyberPreKey)
    })
    return {
      registrationId,
      deviceId: this.selfAddress.deviceId,
      identityKey: identityKp.publicKey().serialize(),
      signedPreKeyId: opts.signedPreKeyId,
      signedPreKeyPublic: signedPreKey.publicKey().serialize(),
      signedPreKeySignature: signedPreKey.signature(),
      kyberPreKeyId: opts.kyberPreKeyId,
      kyberPreKeyPublic: kyberPreKey.kyberPublicKey(),
      kyberPreKeySignature: kyberPreKey.signature(),
      preKeyId: opts.preKeyId,
      preKeyPublic: preKey.publicKey().serialize(),
    }
  }

  async startSession(remote: Address, bundle: PublishedBundle): Promise<void> {
    const remoteAddress = await ProtocolAddress.create(remote.name, remote.deviceId)
    const identityKey = await IdentityKey.deserialize(bundle.identityKey)
    const signedPreKeyPublic = await (await import('expo-libsignal')).PublicKey.deserialize(
      bundle.signedPreKeyPublic,
    )
    const preKeyPublic =
      bundle.preKeyPublic !== undefined
        ? await (await import('expo-libsignal')).PublicKey.deserialize(bundle.preKeyPublic)
        : undefined
    const preKeyBundle = await PreKeyBundle.create({
      registrationId: bundle.registrationId,
      deviceId: bundle.deviceId,
      identityKey,
      signedPreKeyId: bundle.signedPreKeyId,
      signedPreKeyPublic,
      signedPreKeySignature: bundle.signedPreKeySignature,
      kyberPreKeyId: bundle.kyberPreKeyId,
      kyberPreKeyPublic: bundle.kyberPreKeyPublic,
      kyberPreKeySignature: bundle.kyberPreKeySignature,
      preKeyId: bundle.preKeyId,
      preKeyPublic,
    })
    const builder = new SessionBuilder(
      { sessionStore: this.store, identityStore: this.store },
      remoteAddress,
      this.self,
    )
    await this.store.runExclusive(() => builder.processPreKeyBundle(preKeyBundle))
  }

  async send(to: Address, plaintext: string): Promise<Envelope> {
    const remoteAddress = await ProtocolAddress.create(to.name, to.deviceId)
    const cipher = new SessionCipher(
      {
        sessionStore: this.store,
        identityStore: this.store,
        preKeyStore: this.store,
        signedPreKeyStore: this.store,
        kyberPreKeyStore: this.store,
      },
      remoteAddress,
      this.self,
    )
    const msg = await this.store.runExclusive(() =>
      cipher.encrypt(new TextEncoder().encode(plaintext)),
    )
    const type: 'preKeySignal' | 'signal' = msg.type === 'preKeySignal' ? 'preKeySignal' : 'signal'
    return { type, from: this.selfAddress, bytes: msg.serialize() }
  }

  async receive(envelope: Envelope): Promise<Received> {
    if (envelope.type === 'preKeySignal' || envelope.type === 'signal') {
      const remoteAddress = await ProtocolAddress.create(envelope.from.name, envelope.from.deviceId)
      const cipher = new SessionCipher(
        {
          sessionStore: this.store,
          identityStore: this.store,
          preKeyStore: this.store,
          signedPreKeyStore: this.store,
          kyberPreKeyStore: this.store,
        },
        remoteAddress,
        this.self,
      )
      const plaintext =
        envelope.type === 'preKeySignal'
          ? await this.store.runExclusive(async () =>
              cipher.decryptPreKeySignal(await PreKeySignalMessage.deserialize(envelope.bytes)),
            )
          : await this.store.runExclusive(async () =>
              cipher.decryptSignal(await SignalMessage.deserialize(envelope.bytes)),
            )
      return {
        kind: 'message',
        from: envelope.from,
        plaintext: new TextDecoder().decode(plaintext),
        sealed: false,
      }
    }
    throw new Error(`SignalClient.receive: unsupported envelope type ${envelope.type}`)
  }
```

- [ ] **Step 3: Run the tests**

Run: `bun run test example/src/client/__tests__/SignalClient.test.ts`
Expected: PASS (8 tests total).

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add example/src/client/SignalClient.ts example/src/client/__tests__/SignalClient.test.ts
git commit -m "feat(example): SignalClient 1:1 — publish bundle, startSession, send, receive"
```

---

## Task 3: Sealed sender wiring

**Files:**
- Modify: `example/src/client/SignalClient.ts`
- Modify: `example/src/client/__tests__/SignalClient.test.ts`

- [ ] **Step 1: Write the failing tests**

Append:

```ts
describe('SignalClient — sealed sender', () => {
  beforeEach(() => jest.clearAllMocks())

  test('send({sealed:true}) throws if configureSealedSender was not called', async () => {
    const client = await SignalClient.open({
      databaseName: 'a.db', keyAlias: 'a.k',
      self: { name: 'alice', deviceId: 1 },
    })
    await expect(
      client.send({ name: 'bob', deviceId: 1 }, 'hi', { sealed: true }),
    ).rejects.toThrow(/SealedSender not configured/)
  })

  test('configured sealed send returns a sealed envelope', async () => {
    const SealedSender = require('expo-libsignal').SealedSender
    SealedSender.encrypt = jest.fn(async () => new Uint8Array([0xc1, 0xc2]))
    const client = await SignalClient.open({
      databaseName: 'a.db', keyAlias: 'a.k',
      self: { name: 'alice', deviceId: 1 },
    })
    client.configureSealedSender({
      trustRoot: { serialize: () => new Uint8Array() } as never,
      senderCert: { serialize: () => new Uint8Array() } as never,
    })
    const env = await client.send({ name: 'bob', deviceId: 1 }, 'hi', { sealed: true })
    expect(env.type).toBe('sealed')
    if (env.type === 'sealed') expect(env.bytes).toEqual(new Uint8Array([0xc1, 0xc2]))
  })

  test('sealed receive returns the recovered sender', async () => {
    const SealedSender = require('expo-libsignal').SealedSender
    SealedSender.decryptMessage = jest.fn(async () => ({
      message: new TextEncoder().encode('hi'),
      senderUuid: 'alice-uuid',
      senderE164: null,
      senderDeviceId: 1,
    }))
    const client = await SignalClient.open({
      databaseName: 'b.db', keyAlias: 'b.k',
      self: { name: 'bob', deviceId: 1 },
    })
    client.configureSealedSender({
      trustRoot: { serialize: () => new Uint8Array() } as never,
      senderCert: { serialize: () => new Uint8Array() } as never,
    })
    const received = await client.receive({
      type: 'sealed',
      bytes: new Uint8Array([0xc1, 0xc2]),
    })
    expect(received).toEqual({
      kind: 'message',
      from: { name: 'alice-uuid', deviceId: 1 },
      plaintext: 'hi',
      sealed: true,
    })
  })
})
```

Run: `bun run test example/src/client/__tests__/SignalClient.test.ts`
Expected: FAIL — sealed methods missing.

- [ ] **Step 2: Extend `SignalClient.ts`**

Add to imports:

```ts
import type { PublicKey, SenderCertificate } from 'expo-libsignal'
import { SealedSender } from 'expo-libsignal'
```

Add fields + methods inside the class:

```ts
  private sealedConfig: { trustRoot: PublicKey; senderCert: SenderCertificate } | null = null

  configureSealedSender(opts: { trustRoot: PublicKey; senderCert: SenderCertificate }): void {
    this.sealedConfig = opts
  }
```

Update `send` to accept the sealed flag and dispatch:

```ts
  async send(to: Address, plaintext: string, opts?: { sealed?: boolean }): Promise<Envelope> {
    if (opts?.sealed === true) {
      if (this.sealedConfig === null) {
        throw new Error('SealedSender not configured — call configureSealedSender first')
      }
      const remoteAddress = await ProtocolAddress.create(to.name, to.deviceId)
      const bytes = await this.store.runExclusive(() =>
        SealedSender.encrypt({
          destination: remoteAddress,
          senderCert: this.sealedConfig!.senderCert,
          message: new TextEncoder().encode(plaintext),
          sessionStore: this.store,
          identityStore: this.store,
        }),
      )
      return { type: 'sealed', bytes }
    }
    // ... existing 1:1 path unchanged
  }
```

Update `receive` to handle `'sealed'`:

```ts
  async receive(envelope: Envelope): Promise<Received> {
    if (envelope.type === 'sealed') {
      if (this.sealedConfig === null) {
        throw new Error('SealedSender not configured — call configureSealedSender first')
      }
      const result = await this.store.runExclusive(() =>
        SealedSender.decryptMessage({
          ciphertext: envelope.bytes,
          trustRoot: this.sealedConfig!.trustRoot,
          timestamp: Date.now(),
          localUuid: this.selfAddress.name,
          localDeviceId: this.selfAddress.deviceId,
          stores: {
            sessionStore: this.store,
            identityStore: this.store,
            preKeyStore: this.store,
            signedPreKeyStore: this.store,
            kyberPreKeyStore: this.store,
          },
        }),
      )
      return {
        kind: 'message',
        from: { name: result.senderUuid, deviceId: result.senderDeviceId },
        plaintext: new TextDecoder().decode(result.message),
        sealed: true,
      }
    }
    // ... existing 1:1 path unchanged
  }
```

- [ ] **Step 3: Run the tests**

Run: `bun run test example/src/client/__tests__/SignalClient.test.ts`
Expected: PASS (11 tests total).

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add example/src/client/SignalClient.ts example/src/client/__tests__/SignalClient.test.ts
git commit -m "feat(example): SignalClient sealed sender — configure, send sealed, receive sealed"
```

---

## Task 4: SignalGroupClient + group welcome/send/receive dispatch

**Files:**
- Create: `example/src/client/SignalGroupClient.ts`
- Modify: `example/src/client/SignalClient.ts`
- Modify: `example/src/client/__tests__/SignalClient.test.ts`

- [ ] **Step 1: Write the failing tests**

Append:

```ts
describe('SignalClient — groups', () => {
  beforeEach(() => jest.clearAllMocks())

  test('group(distId).welcome wraps SKDM in a 1:1 envelope per member', async () => {
    const skdmBytes = new Uint8Array([0xed, 0xed])
    const GroupSessionBuilder = require('expo-libsignal').GroupSessionBuilder
    GroupSessionBuilder.prototype.createSenderKeyDistributionMessage = jest.fn(async () => ({
      serialize: () => skdmBytes,
      distributionId: () => 'dist-1',
    }))
    const SessionCipher = require('expo-libsignal').SessionCipher
    SessionCipher.prototype.encrypt = jest.fn(async () => ({
      type: 'signal',
      serialize: () => new Uint8Array([0x77]),
    }))

    const alice = await SignalClient.open({
      databaseName: 'a.db', keyAlias: 'a.k',
      self: { name: 'alice', deviceId: 1 },
    })
    const out = await alice
      .group('11111111-2222-3333-4444-555555555555')
      .welcome([
        { name: 'bob', deviceId: 1 },
        { name: 'carol', deviceId: 1 },
      ])
    expect(out).toHaveLength(2)
    expect(out[0].to).toEqual({ name: 'bob', deviceId: 1 })
    expect(out[0].envelope.type).toBe('sender-key-distribution')
    if (out[0].envelope.type === 'sender-key-distribution') {
      expect(out[0].envelope.distributionId).toBe('11111111-2222-3333-4444-555555555555')
    }
  })

  test('group(distId).send returns a group envelope', async () => {
    const GroupCipher = require('expo-libsignal').GroupCipher
    GroupCipher.prototype.encrypt = jest.fn(async () => new Uint8Array([0xc0, 0xff, 0xee]))

    const alice = await SignalClient.open({
      databaseName: 'a.db', keyAlias: 'a.k',
      self: { name: 'alice', deviceId: 1 },
    })
    const env = await alice.group('11111111-2222-3333-4444-555555555555').send('hi all')
    expect(env.type).toBe('group')
    if (env.type === 'group') {
      expect(env.distributionId).toBe('11111111-2222-3333-4444-555555555555')
      expect(env.bytes).toEqual(new Uint8Array([0xc0, 0xff, 0xee]))
      expect(env.from).toEqual({ name: 'alice', deviceId: 1 })
    }
  })

  test('receive(sender-key-distribution) decrypts inner 1:1, processes SKDM, returns welcome', async () => {
    const SessionCipher = require('expo-libsignal').SessionCipher
    SessionCipher.prototype.decryptSignal = jest.fn(async () => new Uint8Array([0xed, 0xed]))
    const SenderKeyDistributionMessage = require('expo-libsignal').SenderKeyDistributionMessage
    SenderKeyDistributionMessage.deserialize = jest.fn(async () => ({
      distributionId: () => 'dist-1',
    }))
    const GroupSessionBuilder = require('expo-libsignal').GroupSessionBuilder
    GroupSessionBuilder.prototype.processSenderKeyDistributionMessage = jest.fn(async () => {})

    const bob = await SignalClient.open({
      databaseName: 'b.db', keyAlias: 'b.k',
      self: { name: 'bob', deviceId: 1 },
    })
    const received = await bob.receive({
      type: 'sender-key-distribution',
      from: { name: 'alice', deviceId: 1 },
      bytes: new Uint8Array([0x77]),
      distributionId: 'dist-1',
    })
    expect(received).toEqual({
      kind: 'group-welcome',
      from: { name: 'alice', deviceId: 1 },
      distributionId: 'dist-1',
    })
  })

  test('receive(group) returns the group-message kind', async () => {
    const GroupCipher = require('expo-libsignal').GroupCipher
    GroupCipher.prototype.decrypt = jest.fn(async () => new TextEncoder().encode('hi all'))

    const bob = await SignalClient.open({
      databaseName: 'b.db', keyAlias: 'b.k',
      self: { name: 'bob', deviceId: 1 },
    })
    const received = await bob.receive({
      type: 'group',
      from: { name: 'alice', deviceId: 1 },
      distributionId: 'dist-1',
      bytes: new Uint8Array([0xc0]),
    })
    expect(received).toEqual({
      kind: 'group-message',
      from: { name: 'alice', deviceId: 1 },
      distributionId: 'dist-1',
      plaintext: 'hi all',
    })
  })
})
```

Run: `bun run test example/src/client/__tests__/SignalClient.test.ts`
Expected: FAIL — `group` does not exist.

- [ ] **Step 2: Create `example/src/client/SignalGroupClient.ts`**

```ts
import {
  GroupCipher,
  GroupSessionBuilder,
  ProtocolAddress,
  SessionCipher,
} from 'expo-libsignal'
import type { Address, Envelope, SignalClient } from './SignalClient'

export class SignalGroupClient {
  private readonly client: SignalClient
  private readonly distributionId: string

  constructor(client: SignalClient, distributionId: string) {
    this.client = client
    this.distributionId = distributionId
  }

  /**
   * Mint an SKDM for this group + sender, wrap it in each member's 1:1
   * session, and return one envelope per member. Caller ships each.
   */
  async welcome(members: Address[]): Promise<Array<{ to: Address; envelope: Envelope }>> {
    const builder = new GroupSessionBuilder(this.client.store)
    const skdm = await this.client.store.runExclusive(() =>
      builder.createSenderKeyDistributionMessage(this.client.self, this.distributionId),
    )
    const skdmBytes = skdm.serialize()

    const out: Array<{ to: Address; envelope: Envelope }> = []
    for (const member of members) {
      const remote = await ProtocolAddress.create(member.name, member.deviceId)
      const cipher = new SessionCipher(
        {
          sessionStore: this.client.store,
          identityStore: this.client.store,
          preKeyStore: this.client.store,
          signedPreKeyStore: this.client.store,
          kyberPreKeyStore: this.client.store,
        },
        remote,
        this.client.self,
      )
      const wrapped = await this.client.store.runExclusive(() => cipher.encrypt(skdmBytes))
      out.push({
        to: member,
        envelope: {
          type: 'sender-key-distribution',
          from: this.client.selfAddress,
          bytes: wrapped.serialize(),
          distributionId: this.distributionId,
        },
      })
    }
    return out
  }

  async send(plaintext: string): Promise<Envelope> {
    const cipher = new GroupCipher(this.client.store, this.client.self)
    const bytes = await this.client.store.runExclusive(() =>
      cipher.encrypt(this.distributionId, new TextEncoder().encode(plaintext)),
    )
    return {
      type: 'group',
      from: this.client.selfAddress,
      distributionId: this.distributionId,
      bytes,
    }
  }
}
```

- [ ] **Step 3: Extend `SignalClient.ts`**

Add to imports:

```ts
import {
  GroupCipher,
  GroupSessionBuilder,
  SenderKeyDistributionMessage,
} from 'expo-libsignal'
import { SignalGroupClient } from './SignalGroupClient'
```

Make `store`, `self`, `selfAddress` accessible to `SignalGroupClient`. They are already declared on the class — keep them readable to internal collaborators.

Add the `group(distributionId)` method:

```ts
  group(distributionId: string): SignalGroupClient {
    return new SignalGroupClient(this, distributionId)
  }
```

Extend `receive` with the two new branches. The inner 1:1 unwrap for `sender-key-distribution` always uses `decryptSignal` because the welcome is shipped over an already-ratcheted 1:1 (the demo's mount sequence establishes the session before the group exists; production callers would do the same):

```ts
    if (envelope.type === 'sender-key-distribution') {
      const remoteAddress = await ProtocolAddress.create(envelope.from.name, envelope.from.deviceId)
      // The wrapped inner message can be preKeySignal or signal depending on
      // whether the 1:1 has been used yet. Probe by attempting to decode as
      // PreKeySignal first; if that fails, fall back to Signal.
      const cipher = new SessionCipher(
        {
          sessionStore: this.store,
          identityStore: this.store,
          preKeyStore: this.store,
          signedPreKeyStore: this.store,
          kyberPreKeyStore: this.store,
        },
        remoteAddress,
        this.self,
      )
      let inner: Uint8Array
      try {
        const msg = await PreKeySignalMessage.deserialize(envelope.bytes)
        inner = await this.store.runExclusive(() => cipher.decryptPreKeySignal(msg))
      } catch {
        const msg = await SignalMessage.deserialize(envelope.bytes)
        inner = await this.store.runExclusive(() => cipher.decryptSignal(msg))
      }
      const skdm = await SenderKeyDistributionMessage.deserialize(inner)
      const builder = new GroupSessionBuilder(this.store)
      await this.store.runExclusive(() =>
        builder.processSenderKeyDistributionMessage(remoteAddress, skdm),
      )
      return {
        kind: 'group-welcome',
        from: envelope.from,
        distributionId: skdm.distributionId(),
      }
    }
    if (envelope.type === 'group') {
      const remoteAddress = await ProtocolAddress.create(envelope.from.name, envelope.from.deviceId)
      const cipher = new GroupCipher(this.store, remoteAddress)
      const plaintext = await this.store.runExclusive(() =>
        cipher.decrypt(envelope.distributionId, envelope.bytes),
      )
      return {
        kind: 'group-message',
        from: envelope.from,
        distributionId: envelope.distributionId,
        plaintext: new TextDecoder().decode(plaintext),
      }
    }
```

- [ ] **Step 4: Run the tests**

Run: `bun run test example/src/client/__tests__/SignalClient.test.ts`
Expected: PASS (15 tests total).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add example/src/client/SignalClient.ts example/src/client/SignalGroupClient.ts example/src/client/__tests__/SignalClient.test.ts
git commit -m "feat(example): SignalClient groups — welcome (1:1 wrapped SKDM), send, receive"
```

---

## Task 5: Demo screen + smoke

**Files:**
- Create: `example/src/screens/SignalClientScreen.tsx`
- Modify: `example/App.tsx`
- Modify: `example/SMOKE_TEST_LOG.md`
- Modify: `README.md`

### Step 1: Create `example/src/screens/SignalClientScreen.tsx`

Split view with three persona panels. Auto-runs a scripted sequence on mount, then leaves the UI interactive. Emits `[SIGNALCLIENT-SUMMARY]` JSON for grep.

```tsx
import {
  IdentityKeyPair,
  PublicKey,
  SenderCertificate,
  ServerCertificate,
} from 'expo-libsignal'
import { useEffect, useRef, useState } from 'react'
import { Button, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { SignalClient } from '../client/SignalClient'
import type { Address, Envelope, Received } from '../client/SignalClient'

type Persona = 'alice' | 'bob' | 'carol'
type Target = Persona | 'group'

interface ChatRow {
  who: Persona
  text: string
  kind: 'outgoing' | 'incoming' | 'system'
}

interface StepResult {
  label: string
  detail: string
  ok: boolean
}

const PERSONAS: Persona[] = ['alice', 'bob', 'carol']
const PEERS: Record<Persona, Persona[]> = {
  alice: ['bob', 'carol'],
  bob: ['alice', 'carol'],
  carol: ['alice', 'bob'],
}

const DISTRIBUTION_ID = '00000000-0000-4000-8000-0000000c0de1'

function randomUuidV4(): string {
  const hex = '0123456789abcdef'
  let out = ''
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-'
    else if (i === 14) out += '4'
    else if (i === 19) out += hex[8 + Math.floor(Math.random() * 4)]
    else out += hex[Math.floor(Math.random() * 16)]
  }
  return out
}

const addressOf = (p: Persona): Address => ({ name: p, deviceId: 1 })

export default function SignalClientScreen() {
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState<'idle' | 'running' | 'ok' | 'fail'>('idle')
  const [rows, setRows] = useState<ChatRow[]>([])
  const [composer, setComposer] = useState<Record<Persona, string>>({ alice: '', bob: '', carol: '' })
  const [target, setTarget] = useState<Record<Persona, Target>>({ alice: 'bob', bob: 'alice', carol: 'alice' })
  const [sealed, setSealed] = useState(false)
  const [groupStarted, setGroupStarted] = useState(false)

  const clients = useRef<Record<Persona, SignalClient | null>>({ alice: null, bob: null, carol: null })

  function appendRow(row: ChatRow) {
    setRows((prev) => [...prev, row])
  }

  function ship(env: Envelope, to: Address | 'group') {
    if (to === 'group') {
      // group envelope: fan out to every other persona
      const senderName = env.type === 'group' ? env.from.name : 'unknown'
      for (const p of PERSONAS) {
        if (p === senderName) continue
        clients.current[p]!
          .receive(env)
          .then((r) => recordReceive(p, r))
          .catch((e) => appendRow({ who: p, text: `error: ${String(e)}`, kind: 'system' }))
      }
    } else {
      const dest = to.name as Persona
      clients.current[dest]!
        .receive(env)
        .then((r) => recordReceive(dest, r))
        .catch((e) => appendRow({ who: dest, text: `error: ${String(e)}`, kind: 'system' }))
    }
  }

  function recordReceive(who: Persona, r: Received) {
    if (r.kind === 'message') {
      appendRow({ who, text: `${r.from.name}${r.sealed ? ' (sealed)' : ''}: ${r.plaintext}`, kind: 'incoming' })
    } else if (r.kind === 'group-message') {
      appendRow({ who, text: `${r.from.name} (group): ${r.plaintext}`, kind: 'incoming' })
    } else if (r.kind === 'group-welcome') {
      appendRow({ who, text: `joined group from ${r.from.name}`, kind: 'system' })
    }
  }

  async function mount() {
    const steps: StepResult[] = []
    setStatus('running')
    try {
      // 1. Open three clients
      for (const p of PERSONAS) {
        clients.current[p] = await SignalClient.open({
          databaseName: `${p}.client.db`,
          keyAlias: `expo-libsignal-example.${p}.client.dbkey`,
          self: addressOf(p),
        })
        await clients.current[p]!.initializeIfNeeded({ registrationId: 1000 + PERSONAS.indexOf(p) })
      }
      steps.push({ label: '1. Open clients + identities', detail: 'alice + bob + carol', ok: true })

      // 2. Six startSession calls — every ordered pair
      let preKeyId = 100
      for (const sender of PERSONAS) {
        for (const receiver of PEERS[sender]) {
          const bundle = await clients.current[receiver]!.publishOneTimePreKey({
            preKeyId: preKeyId++,
            signedPreKeyId: 200 + preKeyId,
            kyberPreKeyId: 300 + preKeyId,
          })
          await clients.current[sender]!.startSession(addressOf(receiver), bundle)
        }
      }
      steps.push({ label: '2. Six pairwise sessions', detail: 'startSession ×6', ok: true })

      // 3. Mint sealed-sender cert chain
      const trustRoot = await IdentityKeyPair.generate()
      const serverIdentity = await IdentityKeyPair.generate()
      const serverCert = await ServerCertificate.generate({
        keyId: 1,
        serverKey: serverIdentity.publicKey().toPublicKey(),
        trustRoot,
      })
      for (const p of PERSONAS) {
        const senderUuid = randomUuidV4()
        const senderIdentity = await clients.current[p]!.identityKey()
        const senderCert = await SenderCertificate.generate({
          senderUuid: p,  // use the persona name as the uuid so receive() resolves it
          senderDeviceId: 1,
          senderKey: senderIdentity.toPublicKey(),
          expiration: Date.now() + 5 * 60_000,
          serverCert,
          serverKey: serverIdentity.privateKey(),
        })
        clients.current[p]!.configureSealedSender({
          trustRoot: trustRoot.publicKey().toPublicKey(),
          senderCert,
        })
      }
      steps.push({ label: '3. Sealed sender cert chain', detail: 'trust-root + 3 sender certs', ok: true })
      setReady(true)

      // Scripted smoke
      // 4. alice → bob plain
      ship(await clients.current.alice!.send(addressOf('bob'), 'hi bob'), addressOf('bob'))
      appendRow({ who: 'alice', text: '→ bob: hi bob', kind: 'outgoing' })

      // 5. alice → bob sealed
      ship(
        await clients.current.alice!.send(addressOf('bob'), 'hi bob (sealed)', { sealed: true }),
        addressOf('bob'),
      )
      appendRow({ who: 'alice', text: '→ bob (sealed): hi bob (sealed)', kind: 'outgoing' })

      // 6. bob → alice plain
      ship(await clients.current.bob!.send(addressOf('alice'), 'hi alice'), addressOf('alice'))
      appendRow({ who: 'bob', text: '→ alice: hi alice', kind: 'outgoing' })

      // 7. Start group
      const welcomes = await clients.current.alice!
        .group(DISTRIBUTION_ID)
        .welcome([addressOf('bob'), addressOf('carol')])
      for (const w of welcomes) ship(w.envelope, w.to)
      setGroupStarted(true)
      appendRow({ who: 'alice', text: 'started group (sent SKDMs to bob, carol)', kind: 'system' })

      // 8. alice → group
      ship(await clients.current.alice!.group(DISTRIBUTION_ID).send('hello group'), 'group')
      appendRow({ who: 'alice', text: '→ group: hello group', kind: 'outgoing' })

      steps.push({ label: '4. Scripted sends ok', detail: 'plain + sealed + group', ok: true })

      const pass = steps.every((s) => s.ok)
      console.log(
        '[SIGNALCLIENT-SUMMARY]',
        JSON.stringify({
          status: pass ? 'ok' : 'fail',
          steps: steps.map((s) => ({ label: s.label, ok: s.ok, detail: s.detail })),
        }),
      )
      setStatus(pass ? 'ok' : 'fail')
    } catch (e) {
      steps.push({ label: 'error', detail: String(e), ok: false })
      console.log(
        '[SIGNALCLIENT-SUMMARY]',
        JSON.stringify({
          status: 'fail',
          steps: steps.map((s) => ({ label: s.label, ok: s.ok, detail: s.detail })),
        }),
      )
      setStatus('fail')
    }
  }

  async function unmount() {
    for (const p of PERSONAS) await clients.current[p]?.close().catch(() => {})
  }

  useEffect(() => {
    mount()
    return () => {
      unmount()
    }
  }, [])

  async function manualSend(p: Persona) {
    const text = composer[p]
    if (text.length === 0) return
    setComposer((c) => ({ ...c, [p]: '' }))
    const t = target[p]
    try {
      if (t === 'group') {
        if (!groupStarted) return
        const env = await clients.current[p]!.group(DISTRIBUTION_ID).send(text)
        ship(env, 'group')
        appendRow({ who: p, text: `→ group: ${text}`, kind: 'outgoing' })
      } else {
        const env = await clients.current[p]!.send(addressOf(t), text, { sealed })
        ship(env, addressOf(t))
        appendRow({
          who: p,
          text: `→ ${t}${sealed ? ' (sealed)' : ''}: ${text}`,
          kind: 'outgoing',
        })
      }
    } catch (e) {
      appendRow({ who: p, text: `error: ${String(e)}`, kind: 'system' })
    }
  }

  return (
    <View style={styles.root}>
      <Text style={[styles.status, statusStyle(status)]}>
        Status: {status} {ready ? '' : '(initializing)'}
      </Text>
      <View style={styles.toolbar}>
        <Text style={styles.toolbarLabel}>sealed</Text>
        <Switch value={sealed} onValueChange={setSealed} />
      </View>
      {PERSONAS.map((p) => (
        <View key={p} style={styles.panel}>
          <Text style={styles.panelHeader}>{p}</Text>
          <ScrollView style={styles.history} contentContainerStyle={styles.historyContent}>
            {rows.filter((r) => r.who === p).map((r, i) => (
              <Text key={i} style={[styles.row, rowStyle(r.kind)]}>
                {r.kind === 'outgoing' ? '› ' : r.kind === 'incoming' ? '‹ ' : '— '}
                {r.text}
              </Text>
            ))}
          </ScrollView>
          <View style={styles.targetRow}>
            {PEERS[p].map((peer) => (
              <Button
                key={peer}
                title={`→ ${peer}`}
                onPress={() => setTarget((t) => ({ ...t, [p]: peer }))}
              />
            ))}
            <Button
              title="→ group"
              onPress={() => setTarget((t) => ({ ...t, [p]: 'group' }))}
              disabled={!groupStarted}
            />
          </View>
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={composer[p]}
              onChangeText={(t) => setComposer((c) => ({ ...c, [p]: t }))}
              placeholder={`as ${p}, → ${target[p]}`}
            />
            <Button title="Send" onPress={() => manualSend(p)} disabled={!ready} />
          </View>
        </View>
      ))}
    </View>
  )
}

function statusStyle(s: string) {
  if (s === 'ok') return { color: '#0a0' }
  if (s === 'fail') return { color: '#a00' }
  return { color: '#666' }
}
function rowStyle(kind: ChatRow['kind']) {
  if (kind === 'outgoing') return { color: '#048' }
  if (kind === 'incoming') return { color: '#040' }
  return { color: '#666' }
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff', padding: 8 },
  status: { fontSize: 12, fontFamily: 'Courier', marginBottom: 4 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  toolbarLabel: { fontSize: 12 },
  panel: { flex: 1, borderTopWidth: 1, borderColor: '#ddd', paddingVertical: 4 },
  panelHeader: { fontSize: 13, fontWeight: '600', marginBottom: 2 },
  history: { flex: 1, backgroundColor: '#fafafa' },
  historyContent: { padding: 6 },
  row: { fontSize: 11, fontFamily: 'Courier', paddingVertical: 1 },
  targetRow: { flexDirection: 'row', gap: 4, marginVertical: 2 },
  composer: { flexDirection: 'row', gap: 4 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', padding: 6, fontSize: 12 },
})
```

### Step 2: Wire the tab in `example/App.tsx`

- Extend the `Tab` union with `'signalClient'`.
- Add a `TabButton` for `'signalClient'` with label `"Client"`.
- Add the `case 'signalClient'` arm in `renderScreen`.
- Import the screen.

### Step 3: Typecheck

```
bun run typecheck && cd example && npx tsc --noEmit -p tsconfig.json
```

Expected: both exit 0.

### Step 4: Commit (pre-smoke)

```bash
git add example/src/screens/SignalClientScreen.tsx example/App.tsx
git commit -m "test(example): SignalClient demo screen — split view chat, scripted smoke"
```

### Step 5: Run iOS smoke

- Temporarily set `App.tsx` default tab to `'signalClient'` for the smoke run (DO NOT commit).
- Rebuild: `cd example && npx expo run:ios --port 8082 --device 5105FFD8-CC6E-443C-8791-99D70A8B900D` (CHECK WITH USER FIRST — binds port).
- Terminate + relaunch: `xcrun simctl terminate 5105FFD8-CC6E-443C-8791-99D70A8B900D expo.modules.libsignal.example && xcrun simctl launch 5105FFD8-CC6E-443C-8791-99D70A8B900D expo.modules.libsignal.example`
- Watch: `xcrun simctl spawn 5105FFD8-CC6E-443C-8791-99D70A8B900D log show --last 2m --predicate 'eventMessage CONTAINS "SIGNALCLIENT-SUMMARY"' --info | tail -5`
- Expected: `status="ok"`, 4 of 4 steps green.

### Step 6: Run Android smoke

- Same temp default tab.
- `cd example && npx expo run:android` (CHECK WITH USER FIRST — binds 8081).
- `adb shell am force-stop expo.modules.libsignal.example && adb shell monkey -p expo.modules.libsignal.example -c android.intent.category.LAUNCHER 1`
- Watch: `adb logcat -d 2>/dev/null | grep 'SIGNALCLIENT-SUMMARY' | tail -1`
- Expected: `status="ok"`, 4 of 4 steps green.

### Step 7: Revert temp default tab

Edit `App.tsx` to set `useState<Tab>('identity')` again.

### Step 8: Update `example/SMOKE_TEST_LOG.md`

Prepend a dated section. Format match the Phase 4b entry.

### Step 9: Update `README.md`

Add a short subsection under Usage:

```md
For an end-to-end facade example (one class wrapping identity + 1:1 + sealed + groups + persistence), see `example/src/client/SignalClient.ts` and `example/src/screens/SignalClientScreen.tsx`. The pattern lives in the example app for now; pieces may be lifted into the library in a follow-up.
```

### Step 10: Final commit

```bash
git add example/SMOKE_TEST_LOG.md README.md example/App.tsx
git commit -m "docs: SignalClient facade verified on Android and iOS Simulator"
```

---

## Self-Review Notes

**Spec coverage.** Tasks 1-2 implement open/initialize/identity/publishOneTimePreKey/startSession/send/receive (1:1 path). Task 3 adds configureSealedSender + sealed send/receive. Task 4 adds the group sub-facade + welcome/send + group dispatch on `receive`. Task 5 ships the demo and smoke.

**Spec sections not directly implemented as a task step:**
- Sealed-sender cert chain minting: lives in the demo screen (Task 5 Step 1 §3). Not in the facade per spec.
- Group membership tracking: out of scope per spec; demo screen just hard-codes the three personas.
- Identity-change UX: out per brainstorming.

**Pitfalls to watch for in execution:**
- The Task 4 receive branch for `sender-key-distribution` uses try/catch around `PreKeySignalMessage.deserialize` then falls back to `SignalMessage.deserialize`. In real native code, the deserialize is async and throws if bytes aren't valid. The fallback is fine but the test in Task 4 only exercises the signal path. If smoke fails on this branch, the implementer should add a test for the preKeySignal-wrapped welcome path.
- `IdentityKey.toPublicKey()` was added in Phase 4b commit 5f6d43117d18. Confirm it's still on `src/core/IdentityKeyPair.ts` before relying on it in Task 5.
- The smoke screen uses persona names (`'alice'`, `'bob'`, `'carol'`) as the sealed sender UUIDs. That's intentional so `receive` returns a `from.name` that matches the persona — round-trips cleanly through the demo UI. A production sender would pass real v4 UUIDs.
- The temporary "default tab = sealedSender / signalClient" trick from Phase 4b smoke applies here too — flip it for the smoke runs, revert before final commit.

**Type consistency check:** `Address = { name, deviceId }` is the boundary type everywhere. `Envelope` discriminator is `'preKeySignal' | 'signal' | 'sealed' | 'sender-key-distribution' | 'group'`. `Received.kind` is `'message' | 'group-message' | 'group-welcome'`. These names match across tasks.
