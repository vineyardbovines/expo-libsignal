import { NativeModule } from '../ExpoLibsignalModule'

interface SessionRecordRef {
  serialize(): Uint8Array
}

export class SessionRecord {
  private readonly ref: SessionRecordRef

  constructor(ref: SessionRecordRef) {
    this.ref = ref
  }

  static async deserialize(bytes: Uint8Array): Promise<SessionRecord> {
    const ref = (await NativeModule.deserializeSessionRecord(bytes)) as SessionRecordRef
    return new SessionRecord(ref)
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }

  /** @internal */
  _ref(): SessionRecordRef {
    return this.ref
  }
}
