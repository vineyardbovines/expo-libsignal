import { NativeModule } from '../ExpoLibsignalModule'
import { rethrowAsLibsignal, SenderKeyNotFoundError } from '../errors'
import type { ProtocolAddress } from './ProtocolAddress'
import { SenderKeyRecord } from './SenderKeyRecord'
import type { SenderKeyStore } from './stores'

export class GroupCipher {
  private readonly store: SenderKeyStore
  private readonly sender: ProtocolAddress

  constructor(store: SenderKeyStore, sender: ProtocolAddress) {
    this.store = store
    this.sender = sender
  }

  private opConfig() {
    return {
      senderName: this.sender.name(),
      senderDeviceId: this.sender.deviceId(),
      nowMs: Date.now(),
    }
  }

  async encrypt(distributionId: string, plaintext: Uint8Array): Promise<Uint8Array> {
    const existing = await this.store.loadSenderKey(this.sender, distributionId)
    if (existing === null) {
      throw new SenderKeyNotFoundError(
        `no sender key for ${this.sender.name()}.${this.sender.deviceId()} distribution=${distributionId}`,
      )
    }
    let result: { ciphertext: Uint8Array; newRecord: Uint8Array }
    try {
      result = await NativeModule.groupEncryptOp(
        this.opConfig(),
        distributionId,
        plaintext,
        existing.serialize(),
      )
    } catch (e) {
      throw rethrowAsLibsignal(e)
    }
    const newRecord = await SenderKeyRecord.deserialize(result.newRecord)
    await this.store.storeSenderKey(this.sender, distributionId, newRecord)
    return result.ciphertext
  }

  async decrypt(distributionId: string, ciphertext: Uint8Array): Promise<Uint8Array> {
    const existing = await this.store.loadSenderKey(this.sender, distributionId)
    if (existing === null) {
      throw new SenderKeyNotFoundError(
        `no sender key for ${this.sender.name()}.${this.sender.deviceId()} distribution=${distributionId}`,
      )
    }
    let result: { plaintext: Uint8Array; newRecord: Uint8Array }
    try {
      result = await NativeModule.groupDecryptOp(this.opConfig(), ciphertext, existing.serialize())
    } catch (e) {
      throw rethrowAsLibsignal(e)
    }
    const newRecord = await SenderKeyRecord.deserialize(result.newRecord)
    await this.store.storeSenderKey(this.sender, distributionId, newRecord)
    return result.plaintext
  }
}
