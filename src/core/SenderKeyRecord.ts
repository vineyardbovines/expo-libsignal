import { NativeModule } from '../ExpoLibsignalModule'

interface SenderKeyRecordRef {
  serialize(): Uint8Array
}

/**
 * Persisted ratchet state for one (sender, distributionId) pair. Opaque
 * libsignal blob; the JS side only serializes / deserializes through the
 * native module so it can be written to a SenderKeyStore.
 */
export class SenderKeyRecord {
  private readonly ref: SenderKeyRecordRef

  private constructor(ref: SenderKeyRecordRef) {
    this.ref = ref
  }

  static async deserialize(bytes: Uint8Array): Promise<SenderKeyRecord> {
    const ref = (await NativeModule.deserializeSenderKeyRecord(bytes)) as SenderKeyRecordRef
    return new SenderKeyRecord(ref)
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }
}
