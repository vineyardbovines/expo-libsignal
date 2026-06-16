import {
  IdentityKey,
  IdentityKeyPair,
  KyberPreKeyRecord,
  PreKeyBundle,
  PreKeyRecord,
  PreKeySignalMessage,
  ProtocolAddress,
  PublicKey,
  SessionBuilder,
  SessionCipher,
  SignalMessage,
  SignedPreKeyRecord,
} from 'expo-libsignal'
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
  | {
      type: 'sender-key-distribution'
      from: Address
      bytes: Uint8Array
      distributionId: string
    }
  | { type: 'group'; from: Address; distributionId: string; bytes: Uint8Array }

// What receive() returns. App switches on `kind`.
export type Received =
  | { kind: 'message'; from: Address; plaintext: string; sealed: boolean }
  | {
      kind: 'group-message'
      from: Address
      distributionId: string
      plaintext: string
    }
  | { kind: 'group-welcome'; from: Address; distributionId: string }

export class SignalClient {
  /** @internal */ readonly store: SQLCipherProtocolStore
  /** @internal */ readonly self: ProtocolAddress
  /** @internal */ readonly selfAddress: Address

  private constructor(
    store: SQLCipherProtocolStore,
    self: ProtocolAddress,
    selfAddress: Address,
  ) {
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

  async publishOneTimePreKey(opts: {
    preKeyId: number
    signedPreKeyId: number
    kyberPreKeyId: number
  }): Promise<PublishedBundle> {
    const identityKp = await this.store.getIdentityKeyPair()
    const registrationId = await this.store.getLocalRegistrationId()
    const ts = Date.now()
    const preKey = await PreKeyRecord.generate(opts.preKeyId)
    const signedPreKey = await SignedPreKeyRecord.generate(
      opts.signedPreKeyId,
      identityKp,
      ts,
    )
    const kyberPreKey = await KyberPreKeyRecord.generate(
      opts.kyberPreKeyId,
      identityKp,
      ts,
    )
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
    const signedPreKeyPublic = await PublicKey.deserialize(bundle.signedPreKeyPublic)
    const preKeyPublic =
      bundle.preKeyPublic !== undefined
        ? await PublicKey.deserialize(bundle.preKeyPublic)
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
      ...(bundle.preKeyId !== undefined && preKeyPublic !== undefined
        ? { preKeyId: bundle.preKeyId, preKeyPublic }
        : {}),
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
    const type: 'preKeySignal' | 'signal' =
      msg.type === 'preKeySignal' ? 'preKeySignal' : 'signal'
    return { type, from: this.selfAddress, bytes: msg.serialize() }
  }

  async receive(envelope: Envelope): Promise<Received> {
    if (envelope.type === 'preKeySignal' || envelope.type === 'signal') {
      const remoteAddress = await ProtocolAddress.create(
        envelope.from.name,
        envelope.from.deviceId,
      )
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
              cipher.decryptPreKeySignal(
                await PreKeySignalMessage.deserialize(envelope.bytes),
              ),
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
    throw new Error(
      `SignalClient.receive: unsupported envelope type ${envelope.type}`,
    )
  }
}
