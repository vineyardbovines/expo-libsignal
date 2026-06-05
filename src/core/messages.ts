import { NativeModule } from '../ExpoLibsignalModule'

interface SignalMessageRef {
  serialize(): Uint8Array
}

interface PreKeySignalMessageRef {
  serialize(): Uint8Array
  registrationId(): number
  preKeyId(): number | null
  signedPreKeyId(): number
}

export class SignalMessage {
  readonly type = 'signal' as const
  private readonly ref: SignalMessageRef

  constructor(ref: SignalMessageRef) {
    this.ref = ref
  }

  static async deserialize(bytes: Uint8Array): Promise<SignalMessage> {
    const ref = (await NativeModule.deserializeSignalMessage(bytes)) as SignalMessageRef
    return new SignalMessage(ref)
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }

  /** @internal */
  _ref(): SignalMessageRef {
    return this.ref
  }
}

export class PreKeySignalMessage {
  readonly type = 'preKeySignal' as const
  private readonly ref: PreKeySignalMessageRef

  constructor(ref: PreKeySignalMessageRef) {
    this.ref = ref
  }

  static async deserialize(bytes: Uint8Array): Promise<PreKeySignalMessage> {
    const ref = (await NativeModule.deserializePreKeySignalMessage(bytes)) as PreKeySignalMessageRef
    return new PreKeySignalMessage(ref)
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }

  registrationId(): number {
    return this.ref.registrationId()
  }

  preKeyId(): number | null {
    return this.ref.preKeyId()
  }

  signedPreKeyId(): number {
    return this.ref.signedPreKeyId()
  }

  /** @internal */
  _ref(): PreKeySignalMessageRef {
    return this.ref
  }
}

export type CiphertextMessage = SignalMessage | PreKeySignalMessage
