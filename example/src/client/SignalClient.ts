import {
  type Address,
  type Envelope,
  GroupCipher,
  GroupSessionBuilder,
  IdentityKey,
  IdentityKeyPair,
  KyberPreKeyRecord,
  PreKeyBundle,
  PreKeyRecord,
  PreKeySignalMessage,
  ProtocolAddress,
  PublicKey,
  type Received,
  SealedSender,
  SenderKeyDistributionMessage,
  SessionBuilder,
  SessionCipher,
  SignalMessage,
  SignedPreKeyRecord,
} from 'expo-libsignal'
import type { SenderCertificate } from 'expo-libsignal'
import { SQLCipherProtocolStore } from 'expo-libsignal/stores'
import { SignalGroupClient } from './SignalGroupClient'

// Re-export the boundary types so existing consumers (chat code, screens) keep
// importing from this module. New code should import directly from
// 'expo-libsignal'.
export type { Address, Envelope, Received } from 'expo-libsignal'

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

export class SignalClient {
  /** @internal */ readonly store: SQLCipherProtocolStore
  /** @internal */ readonly self: ProtocolAddress
  /** @internal */ readonly selfAddress: Address
  private sealedConfig: { trustRoot: PublicKey; senderCert: SenderCertificate } | null = null

  private constructor(
    store: SQLCipherProtocolStore,
    self: ProtocolAddress,
    selfAddress: Address,
  ) {
    this.store = store
    this.self = self
    this.selfAddress = selfAddress
  }

  configureSealedSender(opts: {
    trustRoot: PublicKey
    senderCert: SenderCertificate
  }): void {
    this.sealedConfig = opts
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

  group(distributionId: string): SignalGroupClient {
    return new SignalGroupClient(this, distributionId)
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

  async send(
    to: Address,
    plaintext: string,
    opts?: { sealed?: boolean },
  ): Promise<Envelope> {
    if (opts?.sealed === true) {
      if (this.sealedConfig === null) {
        throw new Error(
          'SealedSender not configured — call configureSealedSender first',
        )
      }
      const remoteAddress = await ProtocolAddress.create(to.name, to.deviceId)
      const config = this.sealedConfig
      const bytes = await this.store.runExclusive(() =>
        SealedSender.encrypt({
          destination: remoteAddress,
          senderCert: config.senderCert,
          message: new TextEncoder().encode(plaintext),
          sessionStore: this.store,
          identityStore: this.store,
        }),
      )
      return { type: 'sealed', bytes }
    }
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
    if (envelope.type === 'sealed') {
      if (this.sealedConfig === null) {
        throw new Error(
          'SealedSender not configured — call configureSealedSender first',
        )
      }
      const config = this.sealedConfig
      const result = await this.store.runExclusive(() =>
        SealedSender.decryptMessage({
          ciphertext: envelope.bytes,
          trustRoot: config.trustRoot,
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
    if (envelope.type === 'sender-key-distribution') {
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
      let inner: Uint8Array
      try {
        const msg = await PreKeySignalMessage.deserialize(envelope.bytes)
        inner = await this.store.runExclusive(() =>
          cipher.decryptPreKeySignal(msg),
        )
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
      const remoteAddress = await ProtocolAddress.create(
        envelope.from.name,
        envelope.from.deviceId,
      )
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
    throw new Error(
      `SignalClient.receive: unsupported envelope type ${(envelope as Envelope).type}`,
    )
  }
}
