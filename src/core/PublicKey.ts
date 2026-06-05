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

  /** @internal */
  _ref(): PublicKeyRef {
    return this.ref
  }
}
