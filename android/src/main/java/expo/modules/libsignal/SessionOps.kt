package expo.modules.libsignal

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.time.Instant
import org.signal.libsignal.protocol.IdentityKey
import org.signal.libsignal.protocol.IdentityKeyPair as SignalIdentityKeyPair
import org.signal.libsignal.protocol.SessionBuilder
import org.signal.libsignal.protocol.SessionCipher
import org.signal.libsignal.protocol.SignalProtocolAddress
import org.signal.libsignal.protocol.message.CiphertextMessage
import org.signal.libsignal.protocol.message.PreKeySignalMessage
import org.signal.libsignal.protocol.message.SignalMessage
import org.signal.libsignal.protocol.state.KyberPreKeyRecord
import org.signal.libsignal.protocol.state.PreKeyRecord
import org.signal.libsignal.protocol.state.SessionRecord
import org.signal.libsignal.protocol.state.SignedPreKeyRecord
import org.signal.libsignal.protocol.state.impl.InMemorySignalProtocolStore

// The op boundary: argument Records carry only primitives (Expo Modules on
// Android converts incoming Records via plain maps, which cannot carry
// SharedObjects or typed arrays), every byte payload is a positional
// Uint8Array argument (max 8 args per function — decryptPreKeySignalOp uses
// all 8), and PreKeyBundle — which has no serialized form in libsignal — is
// a positional SharedObject. Result Records may carry bytes: the return path
// converts ByteArray fields correctly on both platforms.

class SessionOpConfig : Record {
  @Field var remoteName: String = ""
  @Field var remoteDeviceId: Int = 0
  @Field var localName: String = ""
  @Field var localDeviceId: Int = 0
  @Field var ourRegistrationId: Int = 0
  @Field var nowMs: Double = 0.0
}

class ProcessPreKeyBundleResult : Record {
  @Field var newSession: ByteArray = ByteArray(0)
  @Field var identityChange: String = "newOrUnchanged"
  @Field var trustedRemoteIdentity: ByteArray = ByteArray(0)
}

class EncryptResult : Record {
  @Field var messageType: String = ""
  @Field var preKeySignalMessage: ByteArray? = null
  @Field var signalMessage: ByteArray? = null
  @Field var newSession: ByteArray = ByteArray(0)
  @Field var identityChange: String? = null
}

class DecryptPreKeySignalResult : Record {
  @Field var plaintext: ByteArray = ByteArray(0)
  @Field var newSession: ByteArray = ByteArray(0)
  @Field var identityChange: String? = null
  @Field var consumedPreKeyId: Int? = null
  @Field var kyberPreKeyId: Int = 0
}

class DecryptSignalResult : Record {
  @Field var plaintext: ByteArray = ByteArray(0)
  @Field var newSession: ByteArray = ByteArray(0)
  @Field var identityChange: String? = null
}

internal class ParsedSessionOpArgs(
  val remoteAddress: SignalProtocolAddress,
  val localAddress: SignalProtocolAddress,
  val identityKeyPair: SignalIdentityKeyPair,
  val existingSession: SessionRecord?,
  val existingRemoteIdentity: IdentityKey?,
)

internal fun parseSessionOpArgs(
  config: SessionOpConfig,
  ourIdentityKeyPair: ByteArray,
  existingSession: ByteArray?,
  existingRemoteIdentity: ByteArray?,
): ParsedSessionOpArgs {
  return ParsedSessionOpArgs(
    remoteAddress = SignalProtocolAddress(config.remoteName, config.remoteDeviceId),
    localAddress = SignalProtocolAddress(config.localName, config.localDeviceId),
    identityKeyPair = SignalIdentityKeyPair(ourIdentityKeyPair),
    existingSession = existingSession?.let { SessionRecord(it) },
    existingRemoteIdentity = existingRemoteIdentity?.let { IdentityKey(it) },
  )
}

internal fun seedStore(
  identity: SignalIdentityKeyPair,
  registrationId: Int,
  remoteAddress: SignalProtocolAddress? = null,
  existingSession: SessionRecord? = null,
  existingRemoteIdentity: IdentityKey? = null,
): InMemorySignalProtocolStore {
  val store = InMemorySignalProtocolStore(identity, registrationId)
  if (existingSession != null && remoteAddress != null) {
    store.storeSession(remoteAddress, existingSession)
  }
  if (existingRemoteIdentity != null && remoteAddress != null) {
    store.saveIdentity(remoteAddress, existingRemoteIdentity)
  }
  return store
}

internal fun identityChangeString(
  store: InMemorySignalProtocolStore,
  remoteAddress: SignalProtocolAddress,
  existing: IdentityKey?,
): String {
  val now = store.getIdentity(remoteAddress)
  if (now != null && existing != null && now == existing) {
    return "newOrUnchanged"
  }
  return if (existing == null) "newOrUnchanged" else "replacedExisting"
}

internal fun runProcessPreKeyBundleOp(
  config: SessionOpConfig,
  bundle: PreKeyBundleRef,
  ourIdentityKeyPair: ByteArray,
  existingSession: ByteArray?,
  existingRemoteIdentity: ByteArray?,
): ProcessPreKeyBundleResult {
  val parsed = parseSessionOpArgs(config, ourIdentityKeyPair, existingSession, existingRemoteIdentity)

  val store = seedStore(
    identity = parsed.identityKeyPair,
    registrationId = config.ourRegistrationId,
    remoteAddress = parsed.remoteAddress,
    existingSession = parsed.existingSession,
    existingRemoteIdentity = parsed.existingRemoteIdentity,
  )

  val builder = SessionBuilder(store, store, store, store, parsed.remoteAddress, parsed.localAddress)
  builder.process(bundle.bundle, Instant.ofEpochMilli(config.nowMs.toLong()))

  val newSession = store.loadSession(parsed.remoteAddress)
    ?: throw IllegalStateException("processPreKeyBundle did not produce a session")
  val trustedRemote = store.getIdentity(parsed.remoteAddress) ?: bundle.bundle.identityKey

  val result = ProcessPreKeyBundleResult()
  result.newSession = newSession.serialize()
  result.identityChange = identityChangeString(store, parsed.remoteAddress, parsed.existingRemoteIdentity)
  result.trustedRemoteIdentity = trustedRemote.serialize()
  return result
}

internal fun runEncryptOp(
  config: SessionOpConfig,
  plaintext: ByteArray,
  ourIdentityKeyPair: ByteArray,
  existingSession: ByteArray,
  remoteIdentity: ByteArray?,
): EncryptResult {
  val parsed = parseSessionOpArgs(config, ourIdentityKeyPair, existingSession, remoteIdentity)

  val store = seedStore(
    identity = parsed.identityKeyPair,
    registrationId = config.ourRegistrationId,
    remoteAddress = parsed.remoteAddress,
    existingSession = parsed.existingSession,
    existingRemoteIdentity = parsed.existingRemoteIdentity,
  )

  // Note the upstream asymmetry: SessionBuilder's constructor takes
  // (remoteAddress, localAddress) but SessionCipher's takes
  // (localAddress, remoteAddress).
  val cipher = SessionCipher(store, store, store, store, store, parsed.localAddress, parsed.remoteAddress)
  val ciphertext = cipher.encrypt(plaintext, Instant.ofEpochMilli(config.nowMs.toLong()))

  val newSession = store.loadSession(parsed.remoteAddress)
    ?: throw IllegalStateException("encryptOp produced no session")

  val result = EncryptResult()
  result.newSession = newSession.serialize()
  result.identityChange = if (parsed.existingRemoteIdentity == null) null else "newOrUnchanged"

  when (ciphertext.type) {
    CiphertextMessage.PREKEY_TYPE -> {
      result.messageType = "preKeySignal"
      result.preKeySignalMessage = ciphertext.serialize()
    }
    CiphertextMessage.WHISPER_TYPE -> {
      result.messageType = "signal"
      result.signalMessage = ciphertext.serialize()
    }
    else -> throw IllegalStateException("encryptOp produced unexpected ciphertext type ${ciphertext.type}")
  }
  return result
}

internal fun runDecryptPreKeySignalOp(
  config: SessionOpConfig,
  message: ByteArray,
  ourIdentityKeyPair: ByteArray,
  existingSession: ByteArray?,
  existingRemoteIdentity: ByteArray?,
  preKey: ByteArray?,
  signedPreKey: ByteArray,
  kyberPreKey: ByteArray,
): DecryptPreKeySignalResult {
  val parsed = parseSessionOpArgs(config, ourIdentityKeyPair, existingSession, existingRemoteIdentity)

  val msg = PreKeySignalMessage(message)
  val parsedSignedPreKey = SignedPreKeyRecord(signedPreKey)
  val parsedKyberPreKey = KyberPreKeyRecord(kyberPreKey)

  val store = seedStore(
    identity = parsed.identityKeyPair,
    registrationId = config.ourRegistrationId,
    remoteAddress = parsed.remoteAddress,
    existingSession = parsed.existingSession,
    existingRemoteIdentity = parsed.existingRemoteIdentity,
  )

  preKey?.let {
    val parsedPreKey = PreKeyRecord(it)
    store.storePreKey(parsedPreKey.id, parsedPreKey)
  }
  store.storeSignedPreKey(parsedSignedPreKey.id, parsedSignedPreKey)
  store.storeKyberPreKey(parsedKyberPreKey.id, parsedKyberPreKey)

  // Note the upstream asymmetry: SessionBuilder's constructor takes
  // (remoteAddress, localAddress) but SessionCipher's takes
  // (localAddress, remoteAddress).
  val cipher = SessionCipher(store, store, store, store, store, parsed.localAddress, parsed.remoteAddress)
  val plaintext = cipher.decrypt(msg)

  val newSession = store.loadSession(parsed.remoteAddress)
    ?: throw IllegalStateException("decryptPreKeySignalOp produced no session")

  val msgPreKeyId = msg.preKeyId
  val consumed = if (msgPreKeyId.isPresent) msgPreKeyId.get() else null

  val result = DecryptPreKeySignalResult()
  result.plaintext = plaintext
  result.newSession = newSession.serialize()
  result.identityChange = identityChangeString(store, parsed.remoteAddress, parsed.existingRemoteIdentity)
  result.consumedPreKeyId = consumed
  result.kyberPreKeyId = parsedKyberPreKey.id
  return result
}

internal fun runDecryptSignalOp(
  config: SessionOpConfig,
  message: ByteArray,
  ourIdentityKeyPair: ByteArray,
  existingSession: ByteArray,
  remoteIdentity: ByteArray?,
): DecryptSignalResult {
  val parsed = parseSessionOpArgs(config, ourIdentityKeyPair, existingSession, remoteIdentity)

  val msg = SignalMessage(message)

  val store = seedStore(
    identity = parsed.identityKeyPair,
    registrationId = config.ourRegistrationId,
    remoteAddress = parsed.remoteAddress,
    existingSession = parsed.existingSession,
    existingRemoteIdentity = parsed.existingRemoteIdentity,
  )

  // Note the upstream asymmetry: SessionBuilder's constructor takes
  // (remoteAddress, localAddress) but SessionCipher's takes
  // (localAddress, remoteAddress).
  val cipher = SessionCipher(store, store, store, store, store, parsed.localAddress, parsed.remoteAddress)
  val plaintext = cipher.decrypt(msg)

  val newSession = store.loadSession(parsed.remoteAddress)
    ?: throw IllegalStateException("decryptSignalOp produced no session")

  val result = DecryptSignalResult()
  result.plaintext = plaintext
  result.newSession = newSession.serialize()
  result.identityChange = identityChangeString(store, parsed.remoteAddress, parsed.existingRemoteIdentity)
  return result
}
