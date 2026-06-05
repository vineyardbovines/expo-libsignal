import Foundation
import ExpoModulesCore
import LibSignalClient

// MARK: - Argument and result records

struct ProcessPreKeyBundleArgs: Record {
  @Field var bundle: PreKeyBundleRef? = nil
  @Field var remoteAddress: ProtocolAddressRef? = nil
  @Field var localAddress: ProtocolAddressRef? = nil
  @Field var ourIdentityKeyPair: IdentityKeyPairRef? = nil
  @Field var ourRegistrationId: UInt32 = 0
  @Field var existingSession: SessionRecordRef? = nil
  @Field var existingRemoteIdentity: PublicIdentityKeyRef? = nil
  @Field var nowMs: Double = 0
}

struct ProcessPreKeyBundleResult: Record {
  @Field var newSession: SessionRecordRef? = nil
  @Field var identityChange: String = ""
  @Field var trustedRemoteIdentity: PublicIdentityKeyRef? = nil
}

// MARK: - Store seeding helpers

func seedStore(
  identityKeyPair: IdentityKeyPairRef,
  registrationId: UInt32,
  remoteAddress: ProtocolAddressRef? = nil,
  existingSession: SessionRecordRef? = nil,
  existingRemoteIdentity: PublicIdentityKeyRef? = nil
) throws -> InMemorySignalProtocolStore {
  let store = InMemorySignalProtocolStore(identity: identityKeyPair.keyPair, registrationId: registrationId)
  let ctx = NullContext()
  if let session = existingSession, let addr = remoteAddress {
    try store.storeSession(session.record, for: addr.address, context: ctx)
  }
  if let ident = existingRemoteIdentity, let addr = remoteAddress {
    _ = try store.saveIdentity(ident.key, for: addr.address, context: ctx)
  }
  return store
}

func identityChangeString(
  store: InMemorySignalProtocolStore,
  remoteAddress: ProtocolAddressRef,
  existing: PublicIdentityKeyRef?
) throws -> String {
  let now = try store.identity(for: remoteAddress.address, context: NullContext())
  if let now = now, let existing = existing, now == existing.key {
    return "newOrUnchanged"
  }
  return existing == nil ? "newOrUnchanged" : "replacedExisting"
}

// MARK: - encryptOp

struct EncryptArgs: Record {
  @Field var plaintext: Data = Data()
  @Field var remoteAddress: ProtocolAddressRef? = nil
  @Field var localAddress: ProtocolAddressRef? = nil
  @Field var ourIdentityKeyPair: IdentityKeyPairRef? = nil
  @Field var ourRegistrationId: UInt32 = 0
  @Field var existingSession: SessionRecordRef? = nil
  @Field var remoteIdentity: PublicIdentityKeyRef? = nil
  @Field var nowMs: Double = 0
}

struct EncryptResult: Record {
  @Field var messageType: String = ""
  @Field var preKeySignalMessage: PreKeySignalMessageRef? = nil
  @Field var signalMessage: SignalMessageRef? = nil
  @Field var newSession: SessionRecordRef? = nil
  @Field var identityChange: String? = nil
}

func runEncryptOp(_ args: EncryptArgs) throws -> EncryptResult {
  guard let remoteAddressRef = args.remoteAddress else {
    throw Exception(name: "LibsignalError", description: "remoteAddress is required")
  }
  guard let localAddressRef = args.localAddress else {
    throw Exception(name: "LibsignalError", description: "localAddress is required")
  }
  guard let identityKeyPairRef = args.ourIdentityKeyPair else {
    throw Exception(name: "LibsignalError", description: "ourIdentityKeyPair is required")
  }
  guard let existingSessionRef = args.existingSession else {
    throw Exception(name: "LibsignalError", description: "existingSession is required")
  }

  let ctx = NullContext()
  let store = try seedStore(
    identityKeyPair: identityKeyPairRef,
    registrationId: args.ourRegistrationId,
    remoteAddress: remoteAddressRef,
    existingSession: existingSessionRef,
    existingRemoteIdentity: args.remoteIdentity
  )

  let ciphertext = try signalEncrypt(
    message: args.plaintext,
    for: remoteAddressRef.address,
    localAddress: localAddressRef.address,
    sessionStore: store,
    identityStore: store,
    now: Date(timeIntervalSince1970: args.nowMs / 1000.0),
    context: ctx
  )

  guard let newSession = try store.loadSession(for: remoteAddressRef.address, context: ctx) else {
    throw Exception(name: "LibsignalError", description: "encryptOp produced no session")
  }

  var result = EncryptResult()
  result.newSession = SessionRecordRef(record: newSession)
  result.identityChange = "newOrUnchanged"

  switch ciphertext.messageType {
  case .preKey:
    let bytes = ciphertext.serialize()
    let preKeyMsg = try PreKeySignalMessage(bytes: bytes)
    result.messageType = "preKeySignal"
    result.preKeySignalMessage = PreKeySignalMessageRef(message: preKeyMsg)
  case .whisper:
    let bytes = ciphertext.serialize()
    let signalMsg = try SignalMessage(bytes: bytes)
    result.messageType = "signal"
    result.signalMessage = SignalMessageRef(message: signalMsg)
  default:
    throw Exception(name: "LibsignalError", description: "encryptOp produced unexpected ciphertext type \(ciphertext.messageType.rawValue)")
  }
  return result
}

// MARK: - decryptPreKeySignalOp

struct DecryptPreKeySignalArgs: Record {
  @Field var message: PreKeySignalMessageRef? = nil
  @Field var remoteAddress: ProtocolAddressRef? = nil
  @Field var localAddress: ProtocolAddressRef? = nil
  @Field var ourIdentityKeyPair: IdentityKeyPairRef? = nil
  @Field var ourRegistrationId: UInt32 = 0
  @Field var existingSession: SessionRecordRef? = nil
  @Field var existingRemoteIdentity: PublicIdentityKeyRef? = nil
  @Field var preKey: PreKeyRecordRef? = nil
  @Field var signedPreKey: SignedPreKeyRecordRef? = nil
  @Field var kyberPreKey: KyberPreKeyRecordRef? = nil
}

struct DecryptPreKeySignalResult: Record {
  @Field var plaintext: Data = Data()
  @Field var newSession: SessionRecordRef? = nil
  @Field var identityChange: String? = nil
  @Field var consumedPreKeyId: UInt32? = nil
  @Field var kyberPreKeyId: UInt32 = 0
}

func runDecryptPreKeySignalOp(_ args: DecryptPreKeySignalArgs) throws -> DecryptPreKeySignalResult {
  guard let messageRef = args.message else {
    throw Exception(name: "LibsignalError", description: "message is required")
  }
  guard let remoteAddressRef = args.remoteAddress else {
    throw Exception(name: "LibsignalError", description: "remoteAddress is required")
  }
  guard let localAddressRef = args.localAddress else {
    throw Exception(name: "LibsignalError", description: "localAddress is required")
  }
  guard let identityKeyPairRef = args.ourIdentityKeyPair else {
    throw Exception(name: "LibsignalError", description: "ourIdentityKeyPair is required")
  }
  guard let signedPreKeyRef = args.signedPreKey else {
    throw Exception(name: "LibsignalError", description: "signedPreKey is required")
  }
  guard let kyberPreKeyRef = args.kyberPreKey else {
    throw Exception(name: "LibsignalError", description: "kyberPreKey is required")
  }

  let ctx = NullContext()
  let store = try seedStore(
    identityKeyPair: identityKeyPairRef,
    registrationId: args.ourRegistrationId,
    remoteAddress: remoteAddressRef,
    existingSession: args.existingSession,
    existingRemoteIdentity: args.existingRemoteIdentity
  )

  if let preKeyRef = args.preKey {
    try store.storePreKey(preKeyRef.record, id: preKeyRef.record.id, context: ctx)
  }
  try store.storeSignedPreKey(signedPreKeyRef.record, id: signedPreKeyRef.record.id, context: ctx)
  try store.storeKyberPreKey(kyberPreKeyRef.record, id: kyberPreKeyRef.record.id, context: ctx)

  // Read consumedPreKeyId before decrypt (the message carries it; libsignal removes the record during decrypt).
  let consumedPreKeyId: UInt32? = try messageRef.message.preKeyId()

  let plaintext = try signalDecryptPreKey(
    message: messageRef.message,
    from: remoteAddressRef.address,
    localAddress: localAddressRef.address,
    sessionStore: store,
    identityStore: store,
    preKeyStore: store,
    signedPreKeyStore: store,
    kyberPreKeyStore: store,
    context: ctx
  )

  guard let newSession = try store.loadSession(for: remoteAddressRef.address, context: ctx) else {
    throw Exception(name: "LibsignalError", description: "decryptPreKeySignalOp produced no session")
  }

  var result = DecryptPreKeySignalResult()
  result.plaintext = Data(plaintext)
  result.newSession = SessionRecordRef(record: newSession)
  result.identityChange = try identityChangeString(
    store: store,
    remoteAddress: remoteAddressRef,
    existing: args.existingRemoteIdentity
  )
  result.consumedPreKeyId = consumedPreKeyId
  result.kyberPreKeyId = kyberPreKeyRef.record.id
  return result
}

// MARK: - decryptSignalOp

struct DecryptSignalArgs: Record {
  @Field var message: SignalMessageRef? = nil
  @Field var remoteAddress: ProtocolAddressRef? = nil
  @Field var localAddress: ProtocolAddressRef? = nil
  @Field var ourIdentityKeyPair: IdentityKeyPairRef? = nil
  @Field var ourRegistrationId: UInt32 = 0
  @Field var existingSession: SessionRecordRef? = nil
  @Field var remoteIdentity: PublicIdentityKeyRef? = nil
}

struct DecryptSignalResult: Record {
  @Field var plaintext: Data = Data()
  @Field var newSession: SessionRecordRef? = nil
  @Field var identityChange: String? = nil
}

func runDecryptSignalOp(_ args: DecryptSignalArgs) throws -> DecryptSignalResult {
  guard let messageRef = args.message else {
    throw Exception(name: "LibsignalError", description: "message is required")
  }
  guard let remoteAddressRef = args.remoteAddress else {
    throw Exception(name: "LibsignalError", description: "remoteAddress is required")
  }
  guard let localAddressRef = args.localAddress else {
    throw Exception(name: "LibsignalError", description: "localAddress is required")
  }
  guard let identityKeyPairRef = args.ourIdentityKeyPair else {
    throw Exception(name: "LibsignalError", description: "ourIdentityKeyPair is required")
  }
  guard let existingSessionRef = args.existingSession else {
    throw Exception(name: "LibsignalError", description: "existingSession is required")
  }

  let ctx = NullContext()
  let store = try seedStore(
    identityKeyPair: identityKeyPairRef,
    registrationId: args.ourRegistrationId,
    remoteAddress: remoteAddressRef,
    existingSession: existingSessionRef,
    existingRemoteIdentity: args.remoteIdentity
  )

  let plaintext = try signalDecrypt(
    message: messageRef.message,
    from: remoteAddressRef.address,
    to: localAddressRef.address,
    sessionStore: store,
    identityStore: store,
    context: ctx
  )

  guard let newSession = try store.loadSession(for: remoteAddressRef.address, context: ctx) else {
    throw Exception(name: "LibsignalError", description: "decryptSignalOp produced no session")
  }

  var result = DecryptSignalResult()
  result.plaintext = Data(plaintext)
  result.newSession = SessionRecordRef(record: newSession)
  result.identityChange = try identityChangeString(
    store: store,
    remoteAddress: remoteAddressRef,
    existing: args.remoteIdentity
  )
  return result
}

// MARK: - processPreKeyBundleOp

func runProcessPreKeyBundleOp(_ args: ProcessPreKeyBundleArgs) throws -> ProcessPreKeyBundleResult {
  guard let bundleRef = args.bundle else {
    throw Exception(name: "LibsignalError", description: "bundle is required")
  }
  guard let remoteAddressRef = args.remoteAddress else {
    throw Exception(name: "LibsignalError", description: "remoteAddress is required")
  }
  guard let localAddressRef = args.localAddress else {
    throw Exception(name: "LibsignalError", description: "localAddress is required")
  }
  guard let identityKeyPairRef = args.ourIdentityKeyPair else {
    throw Exception(name: "LibsignalError", description: "ourIdentityKeyPair is required")
  }

  let ctx = NullContext()
  let store = try seedStore(
    identityKeyPair: identityKeyPairRef,
    registrationId: args.ourRegistrationId,
    remoteAddress: remoteAddressRef,
    existingSession: args.existingSession,
    existingRemoteIdentity: args.existingRemoteIdentity
  )

  try processPreKeyBundle(
    bundleRef.bundle,
    for: remoteAddressRef.address,
    ourAddress: localAddressRef.address,
    sessionStore: store,
    identityStore: store,
    now: Date(timeIntervalSince1970: args.nowMs / 1000.0),
    context: ctx
  )

  guard let newSession = try store.loadSession(for: remoteAddressRef.address, context: ctx) else {
    throw Exception(name: "LibsignalError", description: "processPreKeyBundle did not produce a session")
  }
  let trustedRemoteIdentity = try store.identity(for: remoteAddressRef.address, context: ctx)
    ?? bundleRef.bundle.identityKey
  let change = try identityChangeString(
    store: store,
    remoteAddress: remoteAddressRef,
    existing: args.existingRemoteIdentity
  )

  var result = ProcessPreKeyBundleResult()
  result.newSession = SessionRecordRef(record: newSession)
  result.identityChange = change
  result.trustedRemoteIdentity = PublicIdentityKeyRef(key: trustedRemoteIdentity)
  return result
}
