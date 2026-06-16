import { NativeModule } from '../ExpoLibsignalModule'

interface SenderKeyDistributionMessageRef {
  serialize(): Uint8Array
  distributionId(): string
  chainId(): number
  iteration(): number
}

/**
 * Over-the-wire bootstrap that lets a recipient set up the shared sender key
 * for one (sender, distributionId) pair. The sender produces one via
 * GroupSessionBuilder.createSenderKeyDistributionMessage and ships it to each
 * group member, typically wrapped in the existing 1:1 Signal session.
 */
export class SenderKeyDistributionMessage {
  private readonly ref: SenderKeyDistributionMessageRef

  private constructor(ref: SenderKeyDistributionMessageRef) {
    this.ref = ref
  }

  static async deserialize(bytes: Uint8Array): Promise<SenderKeyDistributionMessage> {
    const ref = (await NativeModule.deserializeSenderKeyDistributionMessage(
      bytes,
    )) as SenderKeyDistributionMessageRef
    return new SenderKeyDistributionMessage(ref)
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }

  distributionId(): string {
    return this.ref.distributionId()
  }

  chainId(): number {
    return this.ref.chainId()
  }

  iteration(): number {
    return this.ref.iteration()
  }
}
