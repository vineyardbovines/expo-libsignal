import { NativeModule } from '../ExpoLibsignalModule'
import { PublicKey } from './PublicKey'

interface PreKeyRecordRef {
  id(): number
  publicKey(): unknown
  serialize(): Uint8Array
}

export class PreKeyRecord {
  private readonly ref: PreKeyRecordRef

  constructor(ref: PreKeyRecordRef) {
    this.ref = ref
  }

  static async generate(id: number): Promise<PreKeyRecord> {
    if (!Number.isInteger(id) || id < 0) {
      throw new Error(`PreKeyRecord: id must be a non-negative integer, got ${id}`)
    }
    const ref = (await NativeModule.generatePreKeyRecord(id)) as PreKeyRecordRef
    return new PreKeyRecord(ref)
  }

  static async deserialize(bytes: Uint8Array): Promise<PreKeyRecord> {
    const ref = (await NativeModule.deserializePreKeyRecord(bytes)) as PreKeyRecordRef
    return new PreKeyRecord(ref)
  }

  id(): number {
    return this.ref.id()
  }

  publicKey(): PublicKey {
    return new PublicKey(this.ref.publicKey() as never)
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }

  /** @internal */
  _ref(): PreKeyRecordRef {
    return this.ref
  }
}
