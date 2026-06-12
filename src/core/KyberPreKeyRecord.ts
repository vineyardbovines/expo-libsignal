import { NativeModule } from '../ExpoLibsignalModule'
import type { IdentityKeyPair } from './IdentityKeyPair'

interface KyberPreKeyRecordRef {
  id(): number
  timestamp(): number
  signature(): Uint8Array
  serialize(): Uint8Array
  kyberPublicKey(): Uint8Array
}

export class KyberPreKeyRecord {
  private readonly ref: KyberPreKeyRecordRef

  constructor(ref: KyberPreKeyRecordRef) {
    this.ref = ref
  }

  static async generate(
    id: number,
    identityKeyPair: IdentityKeyPair,
    timestamp: number,
  ): Promise<KyberPreKeyRecord> {
    if (!Number.isInteger(id) || id < 0) {
      throw new Error(`KyberPreKeyRecord: id must be a non-negative integer, got ${id}`)
    }
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new Error(`KyberPreKeyRecord: timestamp must be a non-negative ms-since-epoch number`)
    }
    const ref = (await NativeModule.generateKyberPreKeyRecord(
      id,
      identityKeyPair._ref(),
      timestamp,
    )) as KyberPreKeyRecordRef
    return new KyberPreKeyRecord(ref)
  }

  static async deserialize(bytes: Uint8Array): Promise<KyberPreKeyRecord> {
    const ref = (await NativeModule.deserializeKyberPreKeyRecord(bytes)) as KyberPreKeyRecordRef
    return new KyberPreKeyRecord(ref)
  }

  id(): number {
    return this.ref.id()
  }

  timestamp(): number {
    return this.ref.timestamp()
  }

  signature(): Uint8Array {
    return this.ref.signature()
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }

  kyberPublicKey(): Uint8Array {
    return this.ref.kyberPublicKey()
  }

  /** @internal */
  _ref(): KyberPreKeyRecordRef {
    return this.ref
  }
}
