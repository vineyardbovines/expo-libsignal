import {
  IdentityKey,
  IdentityKeyPair,
  ProtocolAddress,
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
}
