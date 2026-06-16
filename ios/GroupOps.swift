import Foundation
import ExpoModulesCore
import LibSignalClient

// MARK: - Records

struct SenderKeyOpConfig: Record {
  @Field var senderName: String = ""
  @Field var senderDeviceId: UInt32 = 0
  @Field var nowMs: Double = 0
}

struct CreateSenderKeyDistributionResult: Record {
  @Field var message: Data = Data()
  @Field var newRecord: Data = Data()
}

struct ProcessSenderKeyDistributionResult: Record {
  @Field var newRecord: Data = Data()
}

struct GroupEncryptResult: Record {
  @Field var ciphertext: Data = Data()
  @Field var newRecord: Data = Data()
}

struct GroupDecryptResult: Record {
  @Field var plaintext: Data = Data()
  @Field var newRecord: Data = Data()
}

// MARK: - Capturing store

// Captures the post-op SenderKeyRecord for (sender, distributionId). libsignal
// stores after createSKDM / processSKDM / groupEncrypt / groupDecrypt; this
// wrapper reads it back so the JS layer can persist it to the real store.
private final class CapturingSenderKeyStore: SenderKeyStore {
  private var records: [String: SenderKeyRecord] = [:]

  private static func key(_ sender: ProtocolAddress, _ id: UUID) -> String {
    return "\(sender.name).\(sender.deviceId).\(id.uuidString)"
  }

  func storeSenderKey(from sender: ProtocolAddress, distributionId: UUID, record: SenderKeyRecord, context: StoreContext) throws {
    records[Self.key(sender, distributionId)] = record
  }

  func loadSenderKey(from sender: ProtocolAddress, distributionId: UUID, context: StoreContext) throws -> SenderKeyRecord? {
    return records[Self.key(sender, distributionId)]
  }
}

// MARK: - Helpers

private func makeStore(senderAddress: ProtocolAddress, distributionId: UUID, existingRecord: Data?) throws -> CapturingSenderKeyStore {
  let store = CapturingSenderKeyStore()
  if let bytes = existingRecord {
    let record = try SenderKeyRecord(bytes: bytes)
    try store.storeSenderKey(from: senderAddress, distributionId: distributionId, record: record, context: NullContext())
  }
  return store
}

private func uuidOrThrow(_ s: String) throws -> UUID {
  guard let id = UUID(uuidString: s) else {
    throw Exception(name: "LibsignalError", description: "invalid distributionId \(s)")
  }
  return id
}

private func senderAddress(_ config: SenderKeyOpConfig) throws -> ProtocolAddress {
  return try ProtocolAddress(name: config.senderName, deviceId: config.senderDeviceId)
}

private func loadNewRecord(_ store: CapturingSenderKeyStore, _ sender: ProtocolAddress, _ id: UUID) throws -> Data {
  guard let rec = try store.loadSenderKey(from: sender, distributionId: id, context: NullContext()) else {
    throw Exception(name: "LibsignalError", description: "expected store to contain a new SenderKeyRecord after op")
  }
  return rec.serialize()
}

// MARK: - createSenderKeyDistributionOp

func runCreateSenderKeyDistributionOp(
  config: SenderKeyOpConfig,
  distributionId: String,
  existingRecord: Data?
) throws -> CreateSenderKeyDistributionResult {
  let id = try uuidOrThrow(distributionId)
  let sender = try senderAddress(config)
  let store = try makeStore(senderAddress: sender, distributionId: id, existingRecord: existingRecord)
  let skdm = try SenderKeyDistributionMessage(from: sender, distributionId: id, store: store, context: NullContext())
  var result = CreateSenderKeyDistributionResult()
  result.message = skdm.serialize()
  result.newRecord = try loadNewRecord(store, sender, id)
  return result
}

// MARK: - processSenderKeyDistributionOp

func runProcessSenderKeyDistributionOp(
  config: SenderKeyOpConfig,
  distributionId: String,
  message: Data,
  existingRecord: Data?
) throws -> ProcessSenderKeyDistributionResult {
  let id = try uuidOrThrow(distributionId)
  let sender = try senderAddress(config)
  let store = try makeStore(senderAddress: sender, distributionId: id, existingRecord: existingRecord)
  let skdm = try SenderKeyDistributionMessage(bytes: message)
  try processSenderKeyDistributionMessage(skdm, from: sender, store: store, context: NullContext())
  var result = ProcessSenderKeyDistributionResult()
  result.newRecord = try loadNewRecord(store, sender, id)
  return result
}

// MARK: - groupEncryptOp

func runGroupEncryptOp(
  config: SenderKeyOpConfig,
  distributionId: String,
  plaintext: Data,
  existingRecord: Data
) throws -> GroupEncryptResult {
  let id = try uuidOrThrow(distributionId)
  let sender = try senderAddress(config)
  let store = try makeStore(senderAddress: sender, distributionId: id, existingRecord: existingRecord)
  let ciphertext = try groupEncrypt(plaintext, from: sender, distributionId: id, store: store, context: NullContext())
  var result = GroupEncryptResult()
  result.ciphertext = Data(ciphertext.serialize())
  result.newRecord = try loadNewRecord(store, sender, id)
  return result
}

// MARK: - groupDecryptOp

func runGroupDecryptOp(
  config: SenderKeyOpConfig,
  ciphertext: Data,
  existingRecord: Data
) throws -> GroupDecryptResult {
  // distributionId is on the ciphertext, not the config — the in-memory store
  // is keyed by (sender, distributionId) and the existing record was looked up
  // by the JS layer from the same SenderKeyMessage, so we re-derive the id.
  let parsed = try SenderKeyMessage(bytes: ciphertext)
  let sender = try senderAddress(config)
  let id = parsed.distributionId
  let store = try makeStore(senderAddress: sender, distributionId: id, existingRecord: existingRecord)
  let plaintext = try groupDecrypt(ciphertext, from: sender, store: store, context: NullContext())
  var result = GroupDecryptResult()
  result.plaintext = Data(plaintext)
  result.newRecord = try loadNewRecord(store, sender, id)
  return result
}
