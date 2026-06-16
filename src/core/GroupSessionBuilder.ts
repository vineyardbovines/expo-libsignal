import { NativeModule } from '../ExpoLibsignalModule'
import { rethrowAsLibsignal } from '../errors'
import type { ProtocolAddress } from './ProtocolAddress'
import { SenderKeyDistributionMessage } from './SenderKeyDistributionMessage'
import { SenderKeyRecord } from './SenderKeyRecord'
import type { SenderKeyStore } from './stores'

export class GroupSessionBuilder {
  private readonly store: SenderKeyStore

  constructor(store: SenderKeyStore) {
    this.store = store
  }

  async createSenderKeyDistributionMessage(
    sender: ProtocolAddress,
    distributionId: string,
  ): Promise<SenderKeyDistributionMessage> {
    const existing = await this.store.loadSenderKey(sender, distributionId)
    let result: { message: Uint8Array; newRecord: Uint8Array }
    try {
      result = await NativeModule.createSenderKeyDistributionOp(
        senderOpConfig(sender),
        distributionId,
        existing ? existing.serialize() : null,
      )
    } catch (e) {
      throw rethrowAsLibsignal(e)
    }
    const newRecord = await SenderKeyRecord.deserialize(result.newRecord)
    await this.store.storeSenderKey(sender, distributionId, newRecord)
    return SenderKeyDistributionMessage.deserialize(result.message)
  }

  async processSenderKeyDistributionMessage(
    sender: ProtocolAddress,
    message: SenderKeyDistributionMessage,
  ): Promise<void> {
    const distributionId = message.distributionId()
    const existing = await this.store.loadSenderKey(sender, distributionId)
    let result: { newRecord: Uint8Array }
    try {
      result = await NativeModule.processSenderKeyDistributionOp(
        senderOpConfig(sender),
        distributionId,
        message.serialize(),
        existing ? existing.serialize() : null,
      )
    } catch (e) {
      throw rethrowAsLibsignal(e)
    }
    const newRecord = await SenderKeyRecord.deserialize(result.newRecord)
    await this.store.storeSenderKey(sender, distributionId, newRecord)
  }
}

function senderOpConfig(sender: ProtocolAddress) {
  return {
    senderName: sender.name(),
    senderDeviceId: sender.deviceId(),
    nowMs: Date.now(),
  }
}
