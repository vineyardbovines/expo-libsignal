import { NativeModule } from '../ExpoLibsignalModule'

interface ProtocolAddressRef {
  name(): string
  deviceId(): number
}

export class ProtocolAddress {
  private readonly ref: ProtocolAddressRef

  constructor(ref: ProtocolAddressRef) {
    this.ref = ref
  }

  static async create(name: string, deviceId: number): Promise<ProtocolAddress> {
    if (name.length === 0) {
      throw new Error('ProtocolAddress: name must be non-empty')
    }
    if (!Number.isInteger(deviceId) || deviceId < 1 || deviceId > 127) {
      throw new Error(`ProtocolAddress: deviceId must be an integer in [1, 127], got ${deviceId}`)
    }
    const ref = (await NativeModule.createProtocolAddress(name, deviceId)) as ProtocolAddressRef
    return new ProtocolAddress(ref)
  }

  name(): string {
    return this.ref.name()
  }

  deviceId(): number {
    return this.ref.deviceId()
  }

  /** @internal */
  _ref(): ProtocolAddressRef {
    return this.ref
  }
}
