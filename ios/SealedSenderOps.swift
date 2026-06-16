import Foundation
import ExpoModulesCore
import LibSignalClient

// MARK: - Config Records

struct SealedSenderEncryptOpConfig: Record {
  @Field var destinationName: String = ""
  @Field var destinationDeviceId: UInt32 = 0
  @Field var ourRegistrationId: UInt32 = 0
  @Field var nowMs: Double = 0
}

struct SealedSenderDecryptOpConfig: Record {
  @Field var localUuid: String = ""
  @Field var localE164: String? = nil
  @Field var localDeviceId: UInt32 = 0
  @Field var ourRegistrationId: UInt32 = 0
  @Field var timestamp: Double = 0
  @Field var nowMs: Double = 0
}

// MARK: - Result Records

struct GenerateServerCertificateResult: Record {
  @Field var certificate: Data = Data()
}

struct GenerateSenderCertificateResult: Record {
  @Field var certificate: Data = Data()
}

struct SealedSenderEncryptResult: Record {
  @Field var ciphertext: Data = Data()
  @Field var newSession: Data = Data()
  @Field var identityChange: String? = nil
}

struct SealedSenderDecryptResult: Record {
  @Field var plaintext: Data = Data()
  @Field var senderUuid: String = ""
  @Field var senderE164: String? = nil
  @Field var senderDeviceId: UInt32 = 0
  @Field var newSession: Data = Data()
  @Field var identityChange: String? = nil
  @Field var consumedPreKeyId: UInt32? = nil
  @Field var kyberPreKeyId: UInt32? = nil
}

// MARK: - Cert generate / validate

func runGenerateServerCertificateOp(
  keyId: UInt32,
  serverKeyBytes: Data,
  trustRootBytes: Data
) throws -> GenerateServerCertificateResult {
  let serverKey = try PublicKey(serverKeyBytes)
  let trustRoot = try IdentityKeyPair(bytes: trustRootBytes)
  let cert = try ServerCertificate(
    keyId: keyId,
    publicKey: serverKey,
    trustRoot: trustRoot.privateKey
  )
  var result = GenerateServerCertificateResult()
  result.certificate = cert.serialize()
  return result
}

func runGenerateSenderCertificateOp(
  senderUuid: String,
  senderE164: String?,
  senderDeviceId: UInt32,
  senderKeyBytes: Data,
  expiration: Double,
  serverCertBytes: Data,
  serverPrivateKeyBytes: Data
) throws -> GenerateSenderCertificateResult {
  let senderKey = try PublicKey(senderKeyBytes)
  let serverCert = try ServerCertificate(serverCertBytes)
  let serverPrivate = try PrivateKey(serverPrivateKeyBytes)
  let address = try SealedSenderAddress(
    e164: senderE164,
    uuidString: senderUuid,
    deviceId: senderDeviceId
  )
  let cert = try SenderCertificate(
    sender: address,
    publicKey: senderKey,
    expiration: UInt64(expiration),
    signerCertificate: serverCert,
    signerKey: serverPrivate
  )
  var result = GenerateSenderCertificateResult()
  result.certificate = cert.serialize()
  return result
}

func runValidateSenderCertificateOp(
  senderCertBytes: Data,
  trustRootBytes: Data,
  validationTime: Double
) throws -> Bool {
  let cert = try SenderCertificate(senderCertBytes)
  let trustRoot = try PublicKey(trustRootBytes)
  return cert.validate(trustRoot: trustRoot, time: UInt64(validationTime))
}

// MARK: - Encrypt / Decrypt

func runSealedSenderEncryptOp(
  config: SealedSenderEncryptOpConfig,
  senderCertBytes: Data,
  plaintext: Data,
  existingSession: Data,
  existingRemoteIdentity: Data?,
  ourIdentityKeyPair: Data
) throws -> SealedSenderEncryptResult {
  let destination = try ProtocolAddress(name: config.destinationName, deviceId: config.destinationDeviceId)
  let identity = try IdentityKeyPair(bytes: ourIdentityKeyPair)
  let session = try SessionRecord(bytes: existingSession)
  let remoteIdent = try existingRemoteIdentity.map { try IdentityKey(bytes: $0) }
  let senderCert = try SenderCertificate(senderCertBytes)

  let ctx = NullContext()
  let store = InMemorySignalProtocolStore(identity: identity, registrationId: config.ourRegistrationId)
  try store.storeSession(session, for: destination, context: ctx)
  if let ident = remoteIdent {
    _ = try store.saveIdentity(ident, for: destination, context: ctx)
  }

  // Two-step: produce a CiphertextMessage via signalEncrypt, wrap as USMC under
  // the SenderCertificate, then seal with sealedSenderEncrypt. The Swift API
  // does not expose a single-call sealed-sender encrypt that owns the inner
  // signal encrypt; the Java SealedSessionCipher does this composition for us.
  // Use a self-localAddress that matches the SenderCertificate's sender so the
  // inner CiphertextMessage carries the right local identity. localAddress is
  // only used inside signalEncrypt for ratchet bookkeeping; the sealed envelope
  // never exposes it.
  let localAddress = try ProtocolAddress(name: senderCert.senderUuid, deviceId: senderCert.deviceId)
  let inner = try signalEncrypt(
    message: plaintext,
    for: destination,
    localAddress: localAddress,
    sessionStore: store,
    identityStore: store,
    now: Date(timeIntervalSince1970: config.nowMs / 1000.0),
    context: ctx
  )
  let content = try UnidentifiedSenderMessageContent(
    inner,
    from: senderCert,
    contentHint: .default,
    groupId: Data()
  )
  let sealed = try sealedSenderEncrypt(
    content,
    for: destination,
    identityStore: store,
    context: ctx
  )

  guard let newSession = try store.loadSession(for: destination, context: ctx) else {
    throw Exception(name: "LibsignalError", description: "sealedSenderEncrypt produced no session")
  }
  var result = SealedSenderEncryptResult()
  result.ciphertext = sealed
  result.newSession = newSession.serialize()
  result.identityChange = "newOrUnchanged"
  return result
}

func runSealedSenderDecryptOp(
  config: SealedSenderDecryptOpConfig,
  ciphertext: Data,
  trustRootBytes: Data,
  ourIdentityKeyPair: Data,
  kyberPreKeysBlob: Data,
  preKeysBlob: Data,
  signedPreKeysBlob: Data
) throws -> SealedSenderDecryptResult {
  let identity = try IdentityKeyPair(bytes: ourIdentityKeyPair)
  let trustRoot = try PublicKey(trustRootBytes)

  let ctx = NullContext()
  let store = RecordingSignalProtocolStore(identity: identity, registrationId: config.ourRegistrationId)
  for bytes in try decodeRecordList(preKeysBlob) {
    let r = try PreKeyRecord(bytes: bytes)
    try store.storePreKey(r, id: r.id, context: ctx)
  }
  for bytes in try decodeRecordList(signedPreKeysBlob) {
    let r = try SignedPreKeyRecord(bytes: bytes)
    try store.storeSignedPreKey(r, id: r.id, context: ctx)
  }
  for bytes in try decodeRecordList(kyberPreKeysBlob) {
    let r = try KyberPreKeyRecord(bytes: bytes)
    try store.storeKyberPreKey(r, id: r.id, context: ctx)
  }

  // Step 1: unseal the envelope to USMC.
  let usmc = try UnidentifiedSenderMessageContent(
    message: ciphertext,
    identityStore: store,
    context: ctx
  )

  // Step 2: validate the embedded SenderCertificate against the trust root at
  // the wire timestamp. Java's SealedSessionCipher.decrypt does this for us;
  // here we have to do it explicitly because Swift exposes only the lower-level
  // primitives.
  let senderCert = usmc.senderCertificate
  if !senderCert.validate(trustRoot: trustRoot, time: UInt64(config.timestamp)) {
    throw Exception(name: "LibsignalError", description: "sealed sender certificate did not validate against trust root")
  }

  let senderUuidLower = senderCert.senderUuid.lowercased()
  let senderE164 = senderCert.senderE164
  let senderDeviceId = senderCert.deviceId
  let senderAddress = try ProtocolAddress(name: senderUuidLower, deviceId: senderDeviceId)
  let localAddress = try ProtocolAddress(name: config.localUuid, deviceId: config.localDeviceId)

  // Step 3: dispatch on inner message type and decrypt with the appropriate
  // primitive. The store carries every candidate prekey/signed/kyber prekey
  // that libsignal might need to consume.
  let contents = usmc.contents
  var plaintext = Data()
  var consumedPreKeyId: UInt32? = nil
  switch usmc.messageType {
  case .preKey:
    let inner = try PreKeySignalMessage(bytes: contents)
    consumedPreKeyId = try inner.preKeyId()
    plaintext = try signalDecryptPreKey(
      message: inner,
      from: senderAddress,
      localAddress: localAddress,
      sessionStore: store,
      identityStore: store,
      preKeyStore: store,
      signedPreKeyStore: store,
      kyberPreKeyStore: store,
      context: ctx
    )
  case .whisper:
    let inner = try SignalMessage(bytes: contents)
    plaintext = try signalDecrypt(
      message: inner,
      from: senderAddress,
      to: localAddress,
      sessionStore: store,
      identityStore: store,
      context: ctx
    )
  default:
    throw Exception(name: "LibsignalError", description: "sealed sender produced unsupported inner type \(usmc.messageType.rawValue)")
  }

  guard let newSession = try store.loadSession(for: senderAddress, context: ctx) else {
    throw Exception(name: "LibsignalError", description: "sealedSenderDecrypt produced no session")
  }

  var result = SealedSenderDecryptResult()
  result.plaintext = plaintext
  // Foundation's UUID.uuidString is uppercase; align with Java + the rest of
  // our surface by lowercasing.
  result.senderUuid = senderUuidLower
  result.senderE164 = senderE164
  result.senderDeviceId = senderDeviceId
  result.newSession = newSession.serialize()
  result.identityChange = "newOrUnchanged"
  result.consumedPreKeyId = consumedPreKeyId
  result.kyberPreKeyId = store.usedKyberPreKeyId
  return result
}
