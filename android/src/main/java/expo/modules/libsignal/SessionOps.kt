package expo.modules.libsignal

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.time.Instant
import org.signal.libsignal.protocol.SessionBuilder
import org.signal.libsignal.protocol.SessionCipher
import org.signal.libsignal.protocol.message.CiphertextMessage
import org.signal.libsignal.protocol.message.PreKeySignalMessage
import org.signal.libsignal.protocol.message.SignalMessage
import org.signal.libsignal.protocol.state.impl.InMemorySignalProtocolStore

class ProcessPreKeyBundleArgs : Record {
  @Field var bundle: PreKeyBundleRef? = null
  @Field var remoteAddress: ProtocolAddressRef? = null
  @Field var localAddress: ProtocolAddressRef? = null
  @Field var ourIdentityKeyPair: IdentityKeyPairRef? = null
  @Field var ourRegistrationId: Int = 0
  @Field var existingSession: SessionRecordRef? = null
  @Field var existingRemoteIdentity: PublicIdentityKeyRef? = null
  @Field var nowMs: Double = 0.0
}

class ProcessPreKeyBundleResult : Record {
  @Field var newSession: SessionRecordRef? = null
  @Field var identityChange: String = "newOrUnchanged"
  @Field var trustedRemoteIdentity: PublicIdentityKeyRef? = null
}

internal fun seedStore(
  identity: IdentityKeyPairRef,
  registrationId: Int,
  remoteAddress: ProtocolAddressRef? = null,
  existingSession: SessionRecordRef? = null,
  existingRemoteIdentity: PublicIdentityKeyRef? = null,
): InMemorySignalProtocolStore {
  val store = InMemorySignalProtocolStore(identity.keyPair, registrationId)
  if (existingSession != null && remoteAddress != null) {
    store.storeSession(remoteAddress.address, existingSession.record)
  }
  if (existingRemoteIdentity != null && remoteAddress != null) {
    store.saveIdentity(remoteAddress.address, existingRemoteIdentity.key)
  }
  return store
}

internal fun identityChangeString(
  store: InMemorySignalProtocolStore,
  remoteAddress: ProtocolAddressRef,
  existing: PublicIdentityKeyRef?,
): String {
  val now = store.getIdentity(remoteAddress.address)
  if (now != null && existing != null && now == existing.key) {
    return "newOrUnchanged"
  }
  return if (existing == null) "newOrUnchanged" else "replacedExisting"
}

internal fun runProcessPreKeyBundleOp(args: ProcessPreKeyBundleArgs): ProcessPreKeyBundleResult {
  val bundle = args.bundle ?: throw IllegalArgumentException("bundle required")
  val remote = args.remoteAddress ?: throw IllegalArgumentException("remoteAddress required")
  val local = args.localAddress ?: throw IllegalArgumentException("localAddress required")
  val identity = args.ourIdentityKeyPair ?: throw IllegalArgumentException("ourIdentityKeyPair required")

  val store = seedStore(
    identity = identity,
    registrationId = args.ourRegistrationId,
    remoteAddress = remote,
    existingSession = args.existingSession,
    existingRemoteIdentity = args.existingRemoteIdentity,
  )

  val builder = SessionBuilder(store, store, store, store, remote.address, local.address)
  builder.process(bundle.bundle, Instant.ofEpochMilli(args.nowMs.toLong()))

  val newSession = store.loadSession(remote.address)
    ?: throw IllegalStateException("processPreKeyBundle did not produce a session")
  val trustedRemote = store.getIdentity(remote.address) ?: bundle.bundle.identityKey

  val result = ProcessPreKeyBundleResult()
  result.newSession = SessionRecordRef(newSession)
  result.identityChange = identityChangeString(store, remote, args.existingRemoteIdentity)
  result.trustedRemoteIdentity = PublicIdentityKeyRef(trustedRemote)
  return result
}

class EncryptArgs : Record {
  @Field var plaintext: ByteArray = ByteArray(0)
  @Field var remoteAddress: ProtocolAddressRef? = null
  @Field var localAddress: ProtocolAddressRef? = null
  @Field var ourIdentityKeyPair: IdentityKeyPairRef? = null
  @Field var ourRegistrationId: Int = 0
  @Field var existingSession: SessionRecordRef? = null
  @Field var remoteIdentity: PublicIdentityKeyRef? = null
  @Field var nowMs: Double = 0.0
}

class EncryptResult : Record {
  @Field var messageType: String = ""
  @Field var preKeySignalMessage: PreKeySignalMessageRef? = null
  @Field var signalMessage: SignalMessageRef? = null
  @Field var newSession: SessionRecordRef? = null
  @Field var identityChange: String? = null
}

internal fun runEncryptOp(args: EncryptArgs): EncryptResult {
  val remote = args.remoteAddress ?: throw IllegalArgumentException("remoteAddress required")
  val local = args.localAddress ?: throw IllegalArgumentException("localAddress required")
  val identity = args.ourIdentityKeyPair ?: throw IllegalArgumentException("ourIdentityKeyPair required")
  val session = args.existingSession ?: throw IllegalArgumentException("existingSession required")

  val store = seedStore(
    identity = identity,
    registrationId = args.ourRegistrationId,
    remoteAddress = remote,
    existingSession = session,
    existingRemoteIdentity = args.remoteIdentity,
  )

  val cipher = SessionCipher(store, store, store, store, store, remote.address, local.address)
  val ciphertext = cipher.encrypt(args.plaintext, Instant.ofEpochMilli(args.nowMs.toLong()))

  val newSession = store.loadSession(remote.address)
    ?: throw IllegalStateException("encryptOp produced no session")

  val result = EncryptResult()
  result.newSession = SessionRecordRef(newSession)
  result.identityChange = if (args.remoteIdentity == null) null else "newOrUnchanged"

  when (ciphertext.type) {
    CiphertextMessage.PREKEY_TYPE -> {
      result.messageType = "preKeySignal"
      result.preKeySignalMessage = PreKeySignalMessageRef(PreKeySignalMessage(ciphertext.serialize()))
    }
    CiphertextMessage.WHISPER_TYPE -> {
      result.messageType = "signal"
      result.signalMessage = SignalMessageRef(SignalMessage(ciphertext.serialize()))
    }
    else -> throw IllegalStateException("encryptOp produced unexpected ciphertext type ${ciphertext.type}")
  }
  return result
}
