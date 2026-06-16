package expo.modules.libsignal

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.Optional
import java.util.UUID
import org.signal.libsignal.metadata.SealedSessionCipher
import org.signal.libsignal.metadata.certificate.CertificateValidator
import org.signal.libsignal.metadata.certificate.SenderCertificate
import org.signal.libsignal.metadata.certificate.ServerCertificate
import org.signal.libsignal.protocol.IdentityKey
import org.signal.libsignal.protocol.IdentityKeyPair as SignalIdentityKeyPair
import org.signal.libsignal.protocol.SignalProtocolAddress
import org.signal.libsignal.protocol.ecc.ECPrivateKey
import org.signal.libsignal.protocol.ecc.ECPublicKey
import org.signal.libsignal.protocol.state.KyberPreKeyRecord
import org.signal.libsignal.protocol.state.PreKeyRecord
import org.signal.libsignal.protocol.state.SessionRecord
import org.signal.libsignal.protocol.state.SignedPreKeyRecord
import org.signal.libsignal.protocol.state.impl.InMemorySignalProtocolStore

// Op boundary: argument Records carry only primitives (Records cannot transport
// SharedObjects or typed arrays on Android), every byte payload is positional,
// and the result Record fields are read directly by the JS layer in
// src/core/SealedSender.ts. Field names below MUST match the JS reader.

class SealedSenderEncryptOpConfig : Record {
  @Field var destinationName: String = ""
  @Field var destinationDeviceId: Int = 0
  @Field var ourRegistrationId: Int = 0
  @Field var nowMs: Double = 0.0
}

class SealedSenderDecryptOpConfig : Record {
  @Field var localUuid: String = ""
  @Field var localE164: String? = null
  @Field var localDeviceId: Int = 0
  @Field var ourRegistrationId: Int = 0
  @Field var timestamp: Double = 0.0
  @Field var nowMs: Double = 0.0
}

class GenerateServerCertificateResult : Record {
  @Field var certificate: ByteArray = ByteArray(0)
}

class GenerateSenderCertificateResult : Record {
  @Field var certificate: ByteArray = ByteArray(0)
}

class SealedSenderEncryptResult : Record {
  @Field var ciphertext: ByteArray = ByteArray(0)
  @Field var newSession: ByteArray = ByteArray(0)
  @Field var identityChange: String? = null
}

class SealedSenderDecryptResult : Record {
  @Field var plaintext: ByteArray = ByteArray(0)
  @Field var senderUuid: String = ""
  @Field var senderE164: String? = null
  @Field var senderDeviceId: Int = 0
  @Field var newSession: ByteArray = ByteArray(0)
  @Field var identityChange: String? = null
  @Field var consumedPreKeyId: Int? = null
  @Field var kyberPreKeyId: Int? = null
}

// MARK: - Cert generate / validate

internal fun runGenerateServerCertificateOp(
  keyId: Int,
  serverKeyBytes: ByteArray,
  trustRootBytes: ByteArray,
): GenerateServerCertificateResult {
  // ServerCertificate(ECPrivateKey trustRoot, int keyId, ECPublicKey serverKey)
  // The trustRoot bytes are an IdentityKeyPair; we sign with its private key.
  val trustRoot = SignalIdentityKeyPair(trustRootBytes)
  val serverKey = ECPublicKey(serverKeyBytes)
  val cert = ServerCertificate(trustRoot.privateKey, keyId, serverKey)
  return GenerateServerCertificateResult().also { it.certificate = cert.serialized }
}

internal fun runGenerateSenderCertificateOp(
  senderUuid: String,
  senderE164: String?,
  senderDeviceId: Int,
  senderKeyBytes: ByteArray,
  expiration: Double,
  serverCertBytes: ByteArray,
  serverPrivateKeyBytes: ByteArray,
): GenerateSenderCertificateResult {
  val serverCert = ServerCertificate(serverCertBytes)
  val signer = ECPrivateKey(serverPrivateKeyBytes)
  val senderKey = ECPublicKey(senderKeyBytes)
  // ServerCertificate.issue(
  //   ECPrivateKey signer, String senderUuid, Optional<String> senderE164,
  //   int senderDeviceId, ECPublicKey senderKey, long expiration)
  val cert = serverCert.issue(
    signer,
    senderUuid,
    Optional.ofNullable(senderE164),
    senderDeviceId,
    senderKey,
    expiration.toLong(),
  )
  return GenerateSenderCertificateResult().also { it.certificate = cert.serialized }
}

internal fun runValidateSenderCertificateOp(
  senderCertBytes: ByteArray,
  trustRootBytes: ByteArray,
  validationTime: Double,
): Boolean {
  val cert = SenderCertificate(senderCertBytes)
  val validator = CertificateValidator(ECPublicKey(trustRootBytes))
  return try {
    validator.validate(cert, validationTime.toLong())
    true
  } catch (e: Throwable) {
    false
  }
}

// MARK: - Encrypt / Decrypt

internal fun runSealedSenderEncryptOp(
  config: SealedSenderEncryptOpConfig,
  senderCertBytes: ByteArray,
  plaintext: ByteArray,
  existingSession: ByteArray,
  existingRemoteIdentity: ByteArray?,
  ourIdentityKeyPair: ByteArray,
): SealedSenderEncryptResult {
  val destination = SignalProtocolAddress(config.destinationName, config.destinationDeviceId)
  val identity = SignalIdentityKeyPair(ourIdentityKeyPair)
  val senderCert = SenderCertificate(senderCertBytes)

  val store = InMemorySignalProtocolStore(identity, config.ourRegistrationId)
  store.storeSession(destination, SessionRecord(existingSession))
  if (existingRemoteIdentity != null) {
    store.saveIdentity(destination, IdentityKey(existingRemoteIdentity))
  }

  // SealedSessionCipher takes the LOCAL identity (sender). Pull it off the cert.
  // SealedSessionCipher(SignalProtocolStore, UUID localUuid, String localE164, int localDeviceId)
  val cipher = SealedSessionCipher(
    store,
    UUID.fromString(senderCert.senderUuid),
    senderCert.senderE164.orElse(null),
    senderCert.senderDeviceId,
  )
  // encrypt(SignalProtocolAddress destination, SenderCertificate, byte[]) -> byte[]
  val ciphertext = cipher.encrypt(destination, senderCert, plaintext)

  val newSession = store.loadSession(destination)
    ?: throw IllegalStateException("sealedSenderEncrypt produced no session")

  return SealedSenderEncryptResult().also {
    it.ciphertext = ciphertext
    it.newSession = newSession.serialize()
    it.identityChange = "newOrUnchanged"
  }
}

internal fun runSealedSenderDecryptOp(
  config: SealedSenderDecryptOpConfig,
  ciphertext: ByteArray,
  trustRootBytes: ByteArray,
  ourIdentityKeyPair: ByteArray,
  kyberPreKeysBlob: ByteArray,
  preKeysBlob: ByteArray,
  signedPreKeysBlob: ByteArray,
): SealedSenderDecryptResult {
  val identity = SignalIdentityKeyPair(ourIdentityKeyPair)
  // RecordingSignalProtocolStore from SessionOps.kt captures the kyber prekey
  // id libsignal marks used during the inner PreKeySignal decrypt.
  val store = RecordingSignalProtocolStore(identity, config.ourRegistrationId)
  decodeRecordList(preKeysBlob).forEach { bytes ->
    val r = PreKeyRecord(bytes)
    store.storePreKey(r.id, r)
  }
  decodeRecordList(signedPreKeysBlob).forEach { bytes ->
    val r = SignedPreKeyRecord(bytes)
    store.storeSignedPreKey(r.id, r)
  }
  decodeRecordList(kyberPreKeysBlob).forEach { bytes ->
    val r = KyberPreKeyRecord(bytes)
    store.storeKyberPreKey(r.id, r)
  }

  val validator = CertificateValidator(ECPublicKey(trustRootBytes))
  val cipher = SealedSessionCipher(
    store,
    UUID.fromString(config.localUuid),
    config.localE164,
    config.localDeviceId,
  )
  val decrypted = cipher.decrypt(validator, ciphertext, config.timestamp.toLong())

  val senderUuid = decrypted.senderUuid
  val senderE164 = decrypted.senderE164.orElse(null)
  val senderDeviceId = decrypted.deviceId
  val senderAddress = SignalProtocolAddress(senderUuid, senderDeviceId)
  val newSession = store.loadSession(senderAddress)
    ?: throw IllegalStateException("sealedSenderDecrypt produced no session")

  return SealedSenderDecryptResult().also {
    it.plaintext = decrypted.paddedMessage
    it.senderUuid = senderUuid
    it.senderE164 = senderE164
    it.senderDeviceId = senderDeviceId
    it.newSession = newSession.serialize()
    it.identityChange = "newOrUnchanged"
    // Java's SealedSessionCipher.DecryptionResult does not expose the consumed
    // prekey id off the inner PreKeySignalMessage. Same as iOS for the kyber
    // path; mirror that here. The next encrypt ratchet will rotate freshness.
    it.consumedPreKeyId = null
    it.kyberPreKeyId = store.usedKyberPreKeyId
  }
}
