import { NativeModule } from '../ExpoLibsignalModule'
import { IdentityKey } from './IdentityKeyPair'
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
    const hasId = 'preKeyId' in args
    const hasPub = 'preKeyPublic' in args
    if (hasId !== hasPub) {
      throw new Error(
        'PreKeyBundle: preKeyId and preKeyPublic must both be present or both be absent',
      )
    }
    // Keys and signatures cross the boundary as positional byte arguments —
    // Records cannot carry SharedObjects or typed arrays on Android.
    const ref = (await NativeModule.createPreKeyBundle(
      {
        registrationId: args.registrationId,
        deviceId: args.deviceId,
        signedPreKeyId: args.signedPreKeyId,
        kyberPreKeyId: args.kyberPreKeyId,
        preKeyId: args.preKeyId ?? null,
      },
      args.identityKey.serialize(),
      args.signedPreKeyPublic.serialize(),
      args.signedPreKeySignature,
      args.kyberPreKeyPublic,
      args.kyberPreKeySignature,
      args.preKeyPublic !== undefined ? args.preKeyPublic.serialize() : null,
    )) as PreKeyBundleRef
    return new PreKeyBundle(ref)
  }

  registrationId(): number {
    return this.ref.registrationId()
  }
  deviceId(): number {
    return this.ref.deviceId()
  }
  signedPreKeyId(): number {
    return this.ref.signedPreKeyId()
  }
  signedPreKeySignature(): Uint8Array {
    return this.ref.signedPreKeySignature()
  }
  kyberPreKeyId(): number {
    return this.ref.kyberPreKeyId()
  }
  kyberPreKeyPublic(): Uint8Array {
    return this.ref.kyberPreKeyPublic()
  }
  kyberPreKeySignature(): Uint8Array {
    return this.ref.kyberPreKeySignature()
  }
  preKeyId(): number | null {
    return this.ref.preKeyId()
  }

  identityKey(): IdentityKey {
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
