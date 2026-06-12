import { NativeModule } from '../ExpoLibsignalModule'

// Native SharedObject refs. These are real JS objects whose methods come from
// the `Class()` registrations in Swift/Kotlin — each method is auto-bound to
// the instance, so we call them as `ref.serialize()`, `ref.publicKey()`, etc.
//
// The exact shape isn't visible to TypeScript (the bridge resolves it at
// runtime), so we keep these typed as opaque objects with the methods we
// expect upstream to expose.

interface IdentityKeyPairRef {
  serialize(): Uint8Array
  publicKey(): PublicIdentityKeyRef
  privateKey(): PrivateKeyRef
}

interface PublicIdentityKeyRef {
  serialize(): Uint8Array
}

interface PrivateKeyRef {
  serialize(): Uint8Array
}

export class IdentityKey {
  private readonly ref: PublicIdentityKeyRef
  constructor(ref: PublicIdentityKeyRef) {
    this.ref = ref
  }

  static async deserialize(bytes: Uint8Array): Promise<IdentityKey> {
    const ref = (await NativeModule.deserializeIdentityKey(bytes)) as PublicIdentityKeyRef
    return new IdentityKey(ref)
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }

  /** @internal */
  _ref(): PublicIdentityKeyRef {
    return this.ref
  }
}

export class PrivateKey {
  private readonly ref: PrivateKeyRef
  constructor(ref: PrivateKeyRef) {
    this.ref = ref
  }
  serialize(): Uint8Array {
    return this.ref.serialize()
  }
}

export class IdentityKeyPair {
  private readonly ref: IdentityKeyPairRef

  private constructor(ref: IdentityKeyPairRef) {
    this.ref = ref
  }

  static async generate(): Promise<IdentityKeyPair> {
    const ref = (await NativeModule.generateIdentityKeyPair()) as IdentityKeyPairRef
    return new IdentityKeyPair(ref)
  }

  static async deserialize(bytes: Uint8Array): Promise<IdentityKeyPair> {
    const ref = (await NativeModule.deserializeIdentityKeyPair(bytes)) as IdentityKeyPairRef
    return new IdentityKeyPair(ref)
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }

  publicKey(): IdentityKey {
    return new IdentityKey(this.ref.publicKey())
  }

  privateKey(): PrivateKey {
    return new PrivateKey(this.ref.privateKey())
  }

  /** @internal */
  _ref(): IdentityKeyPairRef {
    return this.ref
  }
}
