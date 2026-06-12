import { NativeModule } from '../ExpoLibsignalModule'
import type { IdentityKeyPair } from './IdentityKeyPair'
import { PublicKey } from './PublicKey'

interface SignedPreKeyRecordRef {
  id(): number
  timestamp(): number
  publicKey(): unknown
  signature(): Uint8Array
  serialize(): Uint8Array
}

export class SignedPreKeyRecord {
  private readonly ref: SignedPreKeyRecordRef

  constructor(ref: SignedPreKeyRecordRef) {
    this.ref = ref
  }

  static async generate(
    id: number,
    identityKeyPair: IdentityKeyPair,
    timestamp: number,
  ): Promise<SignedPreKeyRecord> {
    if (!Number.isInteger(id) || id < 0) {
      throw new Error(`SignedPreKeyRecord: id must be a non-negative integer, got ${id}`)
    }
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new Error(`SignedPreKeyRecord: timestamp must be a non-negative ms-since-epoch number`)
    }
    const ref = (await NativeModule.generateSignedPreKeyRecord(
      id,
      identityKeyPair._ref(),
      timestamp,
    )) as SignedPreKeyRecordRef
    return new SignedPreKeyRecord(ref)
  }

  static async deserialize(bytes: Uint8Array): Promise<SignedPreKeyRecord> {
    const ref = (await NativeModule.deserializeSignedPreKeyRecord(bytes)) as SignedPreKeyRecordRef
    return new SignedPreKeyRecord(ref)
  }

  id(): number {
    return this.ref.id()
  }

  timestamp(): number {
    return this.ref.timestamp()
  }

  publicKey(): PublicKey {
    return new PublicKey(this.ref.publicKey() as never)
  }

  signature(): Uint8Array {
    return this.ref.signature()
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }

  /** @internal */
  _ref(): SignedPreKeyRecordRef {
    return this.ref
  }
}
