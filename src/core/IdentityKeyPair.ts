import { NativeModule } from '../ExpoLibsignalModule'

// Native SharedObject refs — opaque to consumers. They are real objects with
// methods registered by the native Class() definitions, but we only expose them
// via the typed wrappers below.
type IdentityKeyPairRef = object
type PublicIdentityKeyRef = object
type PrivateKeyRef = object

export class IdentityKey {
  private readonly ref: PublicIdentityKeyRef
  constructor(ref: PublicIdentityKeyRef) {
    this.ref = ref
  }
  serialize(): Uint8Array {
    return NativeModule.PublicIdentityKeyRef.serialize(this.ref)
  }
}

export class PrivateKey {
  private readonly ref: PrivateKeyRef
  constructor(ref: PrivateKeyRef) {
    this.ref = ref
  }
  serialize(): Uint8Array {
    return NativeModule.PrivateKeyRef.serialize(this.ref)
  }
}

export class IdentityKeyPair {
  private readonly ref: IdentityKeyPairRef

  private constructor(ref: IdentityKeyPairRef) {
    this.ref = ref
  }

  static async generate(): Promise<IdentityKeyPair> {
    const ref = await NativeModule.IdentityKeyPairRef.generate()
    return new IdentityKeyPair(ref)
  }

  static async deserialize(bytes: Uint8Array): Promise<IdentityKeyPair> {
    const ref = await NativeModule.IdentityKeyPairRef.deserialize(bytes)
    return new IdentityKeyPair(ref)
  }

  serialize(): Uint8Array {
    return NativeModule.IdentityKeyPairRef.serialize(this.ref)
  }

  publicKey(): IdentityKey {
    return new IdentityKey(NativeModule.IdentityKeyPairRef.publicKey(this.ref))
  }

  privateKey(): PrivateKey {
    return new PrivateKey(NativeModule.IdentityKeyPairRef.privateKey(this.ref))
  }
}
