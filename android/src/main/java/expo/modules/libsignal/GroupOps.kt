package expo.modules.libsignal

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.UUID
import org.signal.libsignal.protocol.SignalProtocolAddress
import org.signal.libsignal.protocol.groups.GroupCipher
import org.signal.libsignal.protocol.groups.GroupSessionBuilder
import org.signal.libsignal.protocol.groups.state.SenderKeyRecord
import org.signal.libsignal.protocol.groups.state.SenderKeyStore
import org.signal.libsignal.protocol.message.SenderKeyDistributionMessage
import org.signal.libsignal.protocol.message.SenderKeyMessage

class SenderKeyOpConfig : Record {
  @Field var senderName: String = ""
  @Field var senderDeviceId: Int = 0
  @Field var nowMs: Double = 0.0
}

class CreateSenderKeyDistributionResult : Record {
  @Field var message: ByteArray = ByteArray(0)
  @Field var newRecord: ByteArray = ByteArray(0)
}

class ProcessSenderKeyDistributionResult : Record {
  @Field var newRecord: ByteArray = ByteArray(0)
}

class GroupEncryptResult : Record {
  @Field var ciphertext: ByteArray = ByteArray(0)
  @Field var newRecord: ByteArray = ByteArray(0)
}

class GroupDecryptResult : Record {
  @Field var plaintext: ByteArray = ByteArray(0)
  @Field var newRecord: ByteArray = ByteArray(0)
}

// Captures the post-op SenderKeyRecord for (sender, distributionId). libsignal
// stores after createSKDM / processSKDM / groupEncrypt / groupDecrypt; this
// wrapper reads it back so the JS layer can persist it to the real store.
private class CapturingSenderKeyStore : SenderKeyStore {
  private val records = mutableMapOf<String, SenderKeyRecord>()
  private fun key(sender: SignalProtocolAddress, id: UUID) = "${sender.name}.${sender.deviceId}.$id"
  override fun storeSenderKey(sender: SignalProtocolAddress, distributionId: UUID, record: SenderKeyRecord) {
    records[key(sender, distributionId)] = record
  }
  override fun loadSenderKey(sender: SignalProtocolAddress, distributionId: UUID): SenderKeyRecord? {
    return records[key(sender, distributionId)]
  }
}

private fun makeStore(sender: SignalProtocolAddress, id: UUID, existing: ByteArray?): CapturingSenderKeyStore {
  val store = CapturingSenderKeyStore()
  if (existing != null) {
    store.storeSenderKey(sender, id, SenderKeyRecord(existing))
  }
  return store
}

private fun senderAddress(config: SenderKeyOpConfig) =
  SignalProtocolAddress(config.senderName, config.senderDeviceId)

private fun loadNewRecord(store: CapturingSenderKeyStore, sender: SignalProtocolAddress, id: UUID): ByteArray {
  val rec = store.loadSenderKey(sender, id)
    ?: throw IllegalStateException("expected store to contain a new SenderKeyRecord after op")
  return rec.serialize()
}

internal fun runCreateSenderKeyDistributionOp(
  config: SenderKeyOpConfig,
  distributionId: String,
  existingRecord: ByteArray?,
): CreateSenderKeyDistributionResult {
  val id = UUID.fromString(distributionId)
  val sender = senderAddress(config)
  val store = makeStore(sender, id, existingRecord)
  val builder = GroupSessionBuilder(store)
  val skdm = builder.create(sender, id)
  val result = CreateSenderKeyDistributionResult()
  result.message = skdm.serialize()
  result.newRecord = loadNewRecord(store, sender, id)
  return result
}

internal fun runProcessSenderKeyDistributionOp(
  config: SenderKeyOpConfig,
  distributionId: String,
  message: ByteArray,
  existingRecord: ByteArray?,
): ProcessSenderKeyDistributionResult {
  val id = UUID.fromString(distributionId)
  val sender = senderAddress(config)
  val store = makeStore(sender, id, existingRecord)
  val builder = GroupSessionBuilder(store)
  val skdm = SenderKeyDistributionMessage(message)
  builder.process(sender, skdm)
  val result = ProcessSenderKeyDistributionResult()
  result.newRecord = loadNewRecord(store, sender, id)
  return result
}

internal fun runGroupEncryptOp(
  config: SenderKeyOpConfig,
  distributionId: String,
  plaintext: ByteArray,
  existingRecord: ByteArray,
): GroupEncryptResult {
  val id = UUID.fromString(distributionId)
  val sender = senderAddress(config)
  val store = makeStore(sender, id, existingRecord)
  val cipher = GroupCipher(store, sender)
  val ciphertext = cipher.encrypt(id, plaintext)
  val result = GroupEncryptResult()
  result.ciphertext = ciphertext.serialize()
  result.newRecord = loadNewRecord(store, sender, id)
  return result
}

internal fun runGroupDecryptOp(
  config: SenderKeyOpConfig,
  ciphertext: ByteArray,
  existingRecord: ByteArray,
): GroupDecryptResult {
  // distributionId is on the ciphertext, not the config — the in-memory store
  // is keyed by (sender, distributionId) and the existing record was looked up
  // by the JS layer from the same SenderKeyMessage, so we re-derive the id.
  val parsed = SenderKeyMessage(ciphertext)
  val sender = senderAddress(config)
  val id = parsed.distributionId
  val store = makeStore(sender, id, existingRecord)
  val cipher = GroupCipher(store, sender)
  // GroupCipher.decrypt on Android takes the raw bytes (not the parsed message).
  val plaintext = cipher.decrypt(ciphertext)
  val result = GroupDecryptResult()
  result.plaintext = plaintext
  result.newRecord = loadNewRecord(store, sender, id)
  return result
}
