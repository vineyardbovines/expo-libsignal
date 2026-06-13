import Foundation
import ExpoModulesCore
import LibSignalClient

// The op boundary: argument Records carry only primitives (Expo Modules on
// Android converts incoming Records via plain maps, which cannot carry
// SharedObjects or typed arrays), every byte payload is a positional
// Uint8Array argument (max 8 args per function — decryptPreKeySignalOp uses
// all 8), and PreKeyBundle — which has no serialized form in libsignal — is
// a positional SharedObject. Result Records may carry bytes: the return path
// converts ByteArray/Data fields correctly on both platforms.

// MARK: - Records

struct SessionOpConfig: Record {
  @Field var remoteName: String = ""
  @Field var remoteDeviceId: UInt32 = 0
  @Field var localName: String = ""
  @Field var localDeviceId: UInt32 = 0
  @Field var ourRegistrationId: UInt32 = 0
  @Field var nowMs: Double = 0
}

struct ProcessPreKeyBundleResult: Record {
  @Field var newSession: Data = Data()
  @Field var identityChange: String = ""
  @Field var trustedRemoteIdentity: Data = Data()
}

struct EncryptResult: Record {
  @Field var messageType: String = ""
  @Field var preKeySignalMessage: Data? = nil
  @Field var signalMessage: Data? = nil
  @Field var newSession: Data = Data()
  @Field var identityChange: String? = nil
}

struct DecryptPreKeySignalResult: Record {
  @Field var plaintext: Data = Data()
  @Field var newSession: Data = Data()
  @Field var identityChange: String? = nil
  @Field var consumedPreKeyId: UInt32? = nil
  @Field var kyberPreKeyId: UInt32? = nil
}

struct DecryptSignalResult: Record {
  @Field var plaintext: Data = Data()
  @Field var newSession: Data = Data()
  @Field var identityChange: String? = nil
}

// MARK: - Helpers

private struct ParsedSessionOpArgs {
  let remoteAddress: ProtocolAddress
  let localAddress: ProtocolAddress
  let identityKeyPair: IdentityKeyPair
  let existingSession: SessionRecord?
  let existingRemoteIdentity: IdentityKey?
}

private func parseSessionOpArgs(
  config: SessionOpConfig,
  ourIdentityKeyPair: Data,
  existingSession: Data?,
  existingRemoteIdentity: Data?
) throws -> ParsedSessionOpArgs {
  return ParsedSessionOpArgs(
    remoteAddress: try ProtocolAddress(name: config.remoteName, deviceId: config.remoteDeviceId),
    localAddress: try ProtocolAddress(name: config.localName, deviceId: config.localDeviceId),
    identityKeyPair: try IdentityKeyPair(bytes: ourIdentityKeyPair),
    existingSession: try existingSession.map { try SessionRecord(bytes: $0) },
    existingRemoteIdentity: try existingRemoteIdentity.map { try IdentityKey(bytes: $0) }
  )
}

func seedStore(
  identityKeyPair: IdentityKeyPair,
  registrationId: UInt32,
  remoteAddress: ProtocolAddress? = nil,
  existingSession: SessionRecord? = nil,
  existingRemoteIdentity: IdentityKey? = nil
) throws -> InMemorySignalProtocolStore {
  let store = InMemorySignalProtocolStore(identity: identityKeyPair, registrationId: registrationId)
  let ctx = NullContext()
  if let session = existingSession, let addr = remoteAddress {
    try store.storeSession(session, for: addr, context: ctx)
  }
  if let ident = existingRemoteIdentity, let addr = remoteAddress {
    _ = try store.saveIdentity(ident, for: addr, context: ctx)
  }
  return store
}

// Captures which kyber prekey libsignal marks used during PQ decrypt — the
// message does not expose the id in 0.94.4, so this callback is the only
// place the real id surfaces.
final class RecordingSignalProtocolStore: InMemorySignalProtocolStore {
  var usedKyberPreKeyId: UInt32?

  override func markKyberPreKeyUsed(id: UInt32, signedPreKeyId: UInt32, baseKey: PublicKey, context: StoreContext) throws {
    usedKyberPreKeyId = id
    try super.markKyberPreKeyUsed(id: id, signedPreKeyId: signedPreKeyId, baseKey: baseKey, context: context)
  }
}

// Mirror of src/core/recordList.ts: big-endian u32 length prefix per record.
func decodeRecordList(_ blob: Data) throws -> [Data] {
  let bytes = [UInt8](blob)
  var records: [Data] = []
  var offset = 0
  while offset < bytes.count {
    guard offset + 4 <= bytes.count else {
      throw Exception(name: "LibsignalError", description: "recordList: truncated length prefix")
    }
    let len = (Int(bytes[offset]) << 24) | (Int(bytes[offset + 1]) << 16) | (Int(bytes[offset + 2]) << 8) | Int(bytes[offset + 3])
    offset += 4
    guard offset + len <= bytes.count else {
      throw Exception(name: "LibsignalError", description: "recordList: truncated record")
    }
    records.append(Data(bytes[offset..<(offset + len)]))
    offset += len
  }
  return records
}

func identityChangeString(
  store: InMemorySignalProtocolStore,
  remoteAddress: ProtocolAddress,
  existing: IdentityKey?
) throws -> String {
  let now = try store.identity(for: remoteAddress, context: NullContext())
  if let now = now, let existing = existing, now == existing {
    return "newOrUnchanged"
  }
  return existing == nil ? "newOrUnchanged" : "replacedExisting"
}

// MARK: - processPreKeyBundleOp

func runProcessPreKeyBundleOp(
  config: SessionOpConfig,
  bundle: PreKeyBundleRef,
  ourIdentityKeyPair: Data,
  existingSession: Data?,
  existingRemoteIdentity: Data?
) throws -> ProcessPreKeyBundleResult {
  let parsed = try parseSessionOpArgs(
    config: config,
    ourIdentityKeyPair: ourIdentityKeyPair,
    existingSession: existingSession,
    existingRemoteIdentity: existingRemoteIdentity
  )

  let ctx = NullContext()
  let store = try seedStore(
    identityKeyPair: parsed.identityKeyPair,
    registrationId: config.ourRegistrationId,
    remoteAddress: parsed.remoteAddress,
    existingSession: parsed.existingSession,
    existingRemoteIdentity: parsed.existingRemoteIdentity
  )

  try processPreKeyBundle(
    bundle.bundle,
    for: parsed.remoteAddress,
    ourAddress: parsed.localAddress,
    sessionStore: store,
    identityStore: store,
    now: Date(timeIntervalSince1970: config.nowMs / 1000.0),
    context: ctx
  )

  guard let newSession = try store.loadSession(for: parsed.remoteAddress, context: ctx) else {
    throw Exception(name: "LibsignalError", description: "processPreKeyBundle did not produce a session")
  }
  let trustedRemoteIdentity = try store.identity(for: parsed.remoteAddress, context: ctx)
    ?? bundle.bundle.identityKey
  let change = try identityChangeString(
    store: store,
    remoteAddress: parsed.remoteAddress,
    existing: parsed.existingRemoteIdentity
  )

  var result = ProcessPreKeyBundleResult()
  result.newSession = newSession.serialize()
  result.identityChange = change
  result.trustedRemoteIdentity = trustedRemoteIdentity.serialize()
  return result
}

// MARK: - encryptOp

func runEncryptOp(
  config: SessionOpConfig,
  plaintext: Data,
  ourIdentityKeyPair: Data,
  existingSession: Data,
  remoteIdentity: Data?
) throws -> EncryptResult {
  let parsed = try parseSessionOpArgs(
    config: config,
    ourIdentityKeyPair: ourIdentityKeyPair,
    existingSession: existingSession,
    existingRemoteIdentity: remoteIdentity
  )

  let ctx = NullContext()
  let store = try seedStore(
    identityKeyPair: parsed.identityKeyPair,
    registrationId: config.ourRegistrationId,
    remoteAddress: parsed.remoteAddress,
    existingSession: parsed.existingSession,
    existingRemoteIdentity: parsed.existingRemoteIdentity
  )

  let ciphertext = try signalEncrypt(
    message: plaintext,
    for: parsed.remoteAddress,
    localAddress: parsed.localAddress,
    sessionStore: store,
    identityStore: store,
    now: Date(timeIntervalSince1970: config.nowMs / 1000.0),
    context: ctx
  )

  guard let newSession = try store.loadSession(for: parsed.remoteAddress, context: ctx) else {
    throw Exception(name: "LibsignalError", description: "encryptOp produced no session")
  }

  var result = EncryptResult()
  result.newSession = newSession.serialize()
  result.identityChange = "newOrUnchanged"

  switch ciphertext.messageType {
  case .preKey:
    result.messageType = "preKeySignal"
    result.preKeySignalMessage = Data(ciphertext.serialize())
  case .whisper:
    result.messageType = "signal"
    result.signalMessage = Data(ciphertext.serialize())
  default:
    throw Exception(name: "LibsignalError", description: "encryptOp produced unexpected ciphertext type \(ciphertext.messageType.rawValue)")
  }
  return result
}

// MARK: - decryptPreKeySignalOp

func runDecryptPreKeySignalOp(
  config: SessionOpConfig,
  message: Data,
  ourIdentityKeyPair: Data,
  existingSession: Data?,
  existingRemoteIdentity: Data?,
  preKey: Data?,
  signedPreKey: Data,
  kyberPreKeys: Data
) throws -> DecryptPreKeySignalResult {
  let parsed = try parseSessionOpArgs(
    config: config,
    ourIdentityKeyPair: ourIdentityKeyPair,
    existingSession: existingSession,
    existingRemoteIdentity: existingRemoteIdentity
  )

  let parsedMessage = try PreKeySignalMessage(bytes: message)
  let parsedSignedPreKey = try SignedPreKeyRecord(bytes: signedPreKey)

  let ctx = NullContext()
  let store = RecordingSignalProtocolStore(
    identity: parsed.identityKeyPair,
    registrationId: config.ourRegistrationId
  )
  if let session = parsed.existingSession {
    try store.storeSession(session, for: parsed.remoteAddress, context: ctx)
  }
  if let ident = parsed.existingRemoteIdentity {
    _ = try store.saveIdentity(ident, for: parsed.remoteAddress, context: ctx)
  }

  if let preKeyData = preKey {
    let parsedPreKey = try PreKeyRecord(bytes: preKeyData)
    try store.storePreKey(parsedPreKey, id: parsedPreKey.id, context: ctx)
  }
  try store.storeSignedPreKey(parsedSignedPreKey, id: parsedSignedPreKey.id, context: ctx)
  for recordBytes in try decodeRecordList(kyberPreKeys) {
    let record = try KyberPreKeyRecord(bytes: recordBytes)
    try store.storeKyberPreKey(record, id: record.id, context: ctx)
  }

  // Read consumedPreKeyId before decrypt (the message carries it; libsignal removes the record during decrypt).
  let consumedPreKeyId: UInt32? = try parsedMessage.preKeyId()

  let plaintext = try signalDecryptPreKey(
    message: parsedMessage,
    from: parsed.remoteAddress,
    localAddress: parsed.localAddress,
    sessionStore: store,
    identityStore: store,
    preKeyStore: store,
    signedPreKeyStore: store,
    kyberPreKeyStore: store,
    context: ctx
  )

  guard let newSession = try store.loadSession(for: parsed.remoteAddress, context: ctx) else {
    throw Exception(name: "LibsignalError", description: "decryptPreKeySignalOp produced no session")
  }

  var result = DecryptPreKeySignalResult()
  result.plaintext = Data(plaintext)
  result.newSession = newSession.serialize()
  result.identityChange = try identityChangeString(
    store: store,
    remoteAddress: parsed.remoteAddress,
    existing: parsed.existingRemoteIdentity
  )
  result.consumedPreKeyId = consumedPreKeyId
  result.kyberPreKeyId = store.usedKyberPreKeyId
  return result
}

// MARK: - decryptSignalOp

func runDecryptSignalOp(
  config: SessionOpConfig,
  message: Data,
  ourIdentityKeyPair: Data,
  existingSession: Data,
  remoteIdentity: Data?
) throws -> DecryptSignalResult {
  let parsed = try parseSessionOpArgs(
    config: config,
    ourIdentityKeyPair: ourIdentityKeyPair,
    existingSession: existingSession,
    existingRemoteIdentity: remoteIdentity
  )

  let parsedMessage = try SignalMessage(bytes: message)

  let ctx = NullContext()
  let store = try seedStore(
    identityKeyPair: parsed.identityKeyPair,
    registrationId: config.ourRegistrationId,
    remoteAddress: parsed.remoteAddress,
    existingSession: parsed.existingSession,
    existingRemoteIdentity: parsed.existingRemoteIdentity
  )

  let plaintext = try signalDecrypt(
    message: parsedMessage,
    from: parsed.remoteAddress,
    to: parsed.localAddress,
    sessionStore: store,
    identityStore: store,
    context: ctx
  )

  guard let newSession = try store.loadSession(for: parsed.remoteAddress, context: ctx) else {
    throw Exception(name: "LibsignalError", description: "decryptSignalOp produced no session")
  }

  var result = DecryptSignalResult()
  result.plaintext = Data(plaintext)
  result.newSession = newSession.serialize()
  result.identityChange = try identityChangeString(
    store: store,
    remoteAddress: parsed.remoteAddress,
    existing: parsed.existingRemoteIdentity
  )
  return result
}
