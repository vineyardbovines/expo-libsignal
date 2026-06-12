package expo.modules.libsignal

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import org.signal.libsignal.protocol.IdentityKey
import org.signal.libsignal.protocol.IdentityKeyPair as SignalIdentityKeyPair
import org.signal.libsignal.protocol.SignalProtocolAddress
import org.signal.libsignal.protocol.ecc.ECKeyPair
import org.signal.libsignal.protocol.ecc.ECPublicKey
import org.signal.libsignal.protocol.kem.KEMKeyPair
import org.signal.libsignal.protocol.kem.KEMKeyType
import org.signal.libsignal.protocol.kem.KEMPublicKey
import org.signal.libsignal.protocol.message.PreKeySignalMessage
import org.signal.libsignal.protocol.message.SignalMessage
import org.signal.libsignal.protocol.state.KyberPreKeyRecord
import org.signal.libsignal.protocol.state.PreKeyBundle
import org.signal.libsignal.protocol.state.PreKeyRecord
import org.signal.libsignal.protocol.state.SessionRecord
import org.signal.libsignal.protocol.state.SignedPreKeyRecord

// Only primitive fields — incoming Records cannot carry SharedObjects or
// typed arrays on Android, so key/signature bytes are positional arguments
// (see the note in SessionOps.kt).
class PreKeyBundleArgs : Record {
  @Field var registrationId: Int = 0
  @Field var deviceId: Int = 0
  @Field var signedPreKeyId: Int = 0
  @Field var kyberPreKeyId: Int = 0
  @Field var preKeyId: Int? = null
}

class ExpoLibsignalModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoLibsignal")

    // Factory functions live at module level. Inside a Class block, an
    // AsyncFunction is dispatched as an instance method, which has no
    // receiver during construction.
    AsyncFunction("generateIdentityKeyPair") Coroutine { ->
      IdentityKeyPairRef(SignalIdentityKeyPair.generate())
    }

    AsyncFunction("deserializeIdentityKeyPair") Coroutine { bytes: ByteArray ->
      try {
        IdentityKeyPairRef(SignalIdentityKeyPair(bytes))
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }

    // Instance methods. The first parameter (typed as the SharedObject) is
    // auto-bound to `this` on the JS side.
    //
    // Constructor is required by the Kotlin Expo Modules API even though we
    // never expose these for direct construction from JS. Throwing in the
    // body ensures that if a consumer somehow calls `new IdentityKeyPairRef()`,
    // they get a clear error instead of a half-initialized object.
    Class(IdentityKeyPairRef::class) {
      Constructor {
        throw IllegalStateException(
          "IdentityKeyPairRef is not directly constructable from JS. " +
            "Use IdentityKeyPair.generate() or IdentityKeyPair.deserialize().",
        )
      }

      Function("serialize") { ref: IdentityKeyPairRef ->
        ref.keyPair.serialize()
      }

      Function("publicKey") { ref: IdentityKeyPairRef ->
        PublicIdentityKeyRef(ref.keyPair.publicKey)
      }

      Function("privateKey") { ref: IdentityKeyPairRef ->
        PrivateKeyRef(ref.keyPair.privateKey)
      }
    }

    AsyncFunction("deserializeIdentityKey") Coroutine { bytes: ByteArray ->
      try {
        PublicIdentityKeyRef(IdentityKey(bytes))
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }

    Class(PublicIdentityKeyRef::class) {
      Constructor {
        throw IllegalStateException(
          "PublicIdentityKeyRef is not directly constructable from JS.",
        )
      }

      Function("serialize") { ref: PublicIdentityKeyRef ->
        ref.key.serialize()
      }
    }

    Class(PrivateKeyRef::class) {
      Constructor {
        throw IllegalStateException(
          "PrivateKeyRef is not directly constructable from JS.",
        )
      }

      Function("serialize") { ref: PrivateKeyRef ->
        ref.key.serialize()
      }
    }

    AsyncFunction("deserializePublicKey") Coroutine { bytes: ByteArray ->
      try {
        PublicKeyRef(ECPublicKey(bytes))
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }

    Class(PublicKeyRef::class) {
      Constructor {
        throw IllegalStateException(
          "PublicKeyRef is not directly constructable from JS. " +
            "Use PublicKey.deserialize().",
        )
      }

      Function("serialize") { ref: PublicKeyRef ->
        ref.key.serialize()
      }
    }

    AsyncFunction("createProtocolAddress") Coroutine { name: String, deviceId: Int ->
      ProtocolAddressRef(SignalProtocolAddress(name, deviceId))
    }

    Class(ProtocolAddressRef::class) {
      Constructor {
        throw IllegalStateException(
          "ProtocolAddressRef is not directly constructable from JS. " +
            "Use ProtocolAddress.create(name, deviceId).",
        )
      }

      Function("name") { ref: ProtocolAddressRef ->
        ref.address.name
      }
      Function("deviceId") { ref: ProtocolAddressRef ->
        ref.address.deviceId
      }
    }

    AsyncFunction("generatePreKeyRecord") Coroutine { id: Int ->
      val keyPair = ECKeyPair.generate()
      PreKeyRecordRef(PreKeyRecord(id, keyPair))
    }

    AsyncFunction("deserializePreKeyRecord") Coroutine { bytes: ByteArray ->
      try {
        PreKeyRecordRef(PreKeyRecord(bytes))
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }

    Class(PreKeyRecordRef::class) {
      Constructor {
        throw IllegalStateException("PreKeyRecordRef is not directly constructable from JS. Use PreKeyRecord.generate().")
      }
      Function("id") { ref: PreKeyRecordRef -> ref.record.id }
      Function("publicKey") { ref: PreKeyRecordRef -> PublicKeyRef(ref.record.keyPair.publicKey) }
      Function("serialize") { ref: PreKeyRecordRef -> ref.record.serialize() }
    }

    AsyncFunction("generateSignedPreKeyRecord") Coroutine { id: Int, identity: IdentityKeyPairRef, timestamp: Double ->
      val keyPair = ECKeyPair.generate()
      val signature = identity.keyPair.privateKey.calculateSignature(keyPair.publicKey.serialize())
      SignedPreKeyRecordRef(SignedPreKeyRecord(id, timestamp.toLong(), keyPair, signature))
    }

    AsyncFunction("deserializeSignedPreKeyRecord") Coroutine { bytes: ByteArray ->
      try {
        SignedPreKeyRecordRef(SignedPreKeyRecord(bytes))
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }

    Class(SignedPreKeyRecordRef::class) {
      Constructor {
        throw IllegalStateException("SignedPreKeyRecordRef is not directly constructable from JS. Use SignedPreKeyRecord.generate().")
      }
      Function("id") { ref: SignedPreKeyRecordRef -> ref.record.id }
      Function("timestamp") { ref: SignedPreKeyRecordRef -> ref.record.timestamp.toDouble() }
      Function("publicKey") { ref: SignedPreKeyRecordRef -> PublicKeyRef(ref.record.keyPair.publicKey) }
      Function("signature") { ref: SignedPreKeyRecordRef -> ref.record.signature }
      Function("serialize") { ref: SignedPreKeyRecordRef -> ref.record.serialize() }
    }

    AsyncFunction("generateKyberPreKeyRecord") Coroutine { id: Int, identity: IdentityKeyPairRef, timestamp: Double ->
      val keyPair = KEMKeyPair.generate(KEMKeyType.KYBER_1024)
      val signature = identity.keyPair.privateKey.calculateSignature(keyPair.publicKey.serialize())
      KyberPreKeyRecordRef(KyberPreKeyRecord(id, timestamp.toLong(), keyPair, signature))
    }

    AsyncFunction("deserializeKyberPreKeyRecord") Coroutine { bytes: ByteArray ->
      try {
        KyberPreKeyRecordRef(KyberPreKeyRecord(bytes))
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }

    Class(KyberPreKeyRecordRef::class) {
      Constructor {
        throw IllegalStateException("KyberPreKeyRecordRef is not directly constructable from JS. Use KyberPreKeyRecord.generate().")
      }
      Function("id") { ref: KyberPreKeyRecordRef -> ref.record.id }
      Function("timestamp") { ref: KyberPreKeyRecordRef -> ref.record.timestamp.toDouble() }
      Function("signature") { ref: KyberPreKeyRecordRef -> ref.record.signature }
      Function("serialize") { ref: KyberPreKeyRecordRef -> ref.record.serialize() }
      Function("kyberPublicKey") { ref: KyberPreKeyRecordRef ->
        ref.record.keyPair.publicKey.serialize()
      }
    }

    AsyncFunction("createPreKeyBundle") Coroutine { args: PreKeyBundleArgs, identityKeyBytes: ByteArray, signedPreKeyPublicBytes: ByteArray, signedPreKeySignature: ByteArray, kyberPreKeyPublicBytes: ByteArray, kyberPreKeySignature: ByteArray, preKeyPublicBytes: ByteArray? ->
      val identity = IdentityKey(identityKeyBytes)
      val signedPub = ECPublicKey(signedPreKeyPublicBytes)
      val kyberPub = KEMPublicKey(kyberPreKeyPublicBytes)
      val preKeyId = args.preKeyId
      val bundle = if (preKeyId != null && preKeyPublicBytes != null) {
        PreKeyBundle(
          args.registrationId,
          args.deviceId,
          preKeyId,
          ECPublicKey(preKeyPublicBytes),
          args.signedPreKeyId,
          signedPub,
          signedPreKeySignature,
          identity,
          args.kyberPreKeyId,
          kyberPub,
          kyberPreKeySignature,
        )
      } else {
        PreKeyBundle(
          args.registrationId,
          args.deviceId,
          PreKeyBundle.NULL_PRE_KEY_ID,
          null,
          args.signedPreKeyId,
          signedPub,
          signedPreKeySignature,
          identity,
          args.kyberPreKeyId,
          kyberPub,
          kyberPreKeySignature,
        )
      }
      PreKeyBundleRef(bundle)
    }

    Class(PreKeyBundleRef::class) {
      Constructor {
        throw IllegalStateException("PreKeyBundleRef is not directly constructable from JS. Use PreKeyBundle.create().")
      }
      Function("registrationId") { ref: PreKeyBundleRef -> ref.bundle.registrationId }
      Function("deviceId") { ref: PreKeyBundleRef -> ref.bundle.deviceId }
      Function("identityKey") { ref: PreKeyBundleRef -> PublicIdentityKeyRef(ref.bundle.identityKey) }
      Function("signedPreKeyId") { ref: PreKeyBundleRef -> ref.bundle.signedPreKeyId }
      Function("signedPreKeyPublic") { ref: PreKeyBundleRef -> PublicKeyRef(ref.bundle.signedPreKey) }
      Function("signedPreKeySignature") { ref: PreKeyBundleRef -> ref.bundle.signedPreKeySignature }
      Function("kyberPreKeyId") { ref: PreKeyBundleRef -> ref.bundle.kyberPreKeyId }
      Function("kyberPreKeyPublic") { ref: PreKeyBundleRef -> ref.bundle.kyberPreKey.serialize() }
      Function("kyberPreKeySignature") { ref: PreKeyBundleRef -> ref.bundle.kyberPreKeySignature }
      Function("preKeyId") { ref: PreKeyBundleRef ->
        val id = ref.bundle.preKeyId
        if (id == PreKeyBundle.NULL_PRE_KEY_ID) null else id
      }
      Function("preKeyPublic") { ref: PreKeyBundleRef ->
        val pk = ref.bundle.preKey
        if (pk == null) null else PublicKeyRef(pk)
      }
    }

    AsyncFunction("deserializeSessionRecord") Coroutine { bytes: ByteArray ->
      try {
        SessionRecordRef(SessionRecord(bytes))
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }

    Class(SessionRecordRef::class) {
      Constructor {
        throw IllegalStateException("SessionRecordRef is not directly constructable from JS. Use SessionRecord.deserialize() or get one from SessionBuilder/SessionCipher.")
      }
      Function("serialize") { ref: SessionRecordRef -> ref.record.serialize() }
    }

    AsyncFunction("deserializeSignalMessage") Coroutine { bytes: ByteArray ->
      try {
        SignalMessageRef(SignalMessage(bytes))
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }

    Class(SignalMessageRef::class) {
      Constructor {
        throw IllegalStateException("SignalMessageRef is not directly constructable from JS. Use SignalMessage.deserialize().")
      }
      Function("serialize") { ref: SignalMessageRef -> ref.message.serialize() }
    }

    AsyncFunction("deserializePreKeySignalMessage") Coroutine { bytes: ByteArray ->
      try {
        PreKeySignalMessageRef(PreKeySignalMessage(bytes))
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }

    Class(PreKeySignalMessageRef::class) {
      Constructor {
        throw IllegalStateException("PreKeySignalMessageRef is not directly constructable from JS. Use PreKeySignalMessage.deserialize().")
      }
      Function("serialize") { ref: PreKeySignalMessageRef -> ref.message.serialize() }
      Function("registrationId") { ref: PreKeySignalMessageRef -> ref.message.registrationId }
      Function("preKeyId") { ref: PreKeySignalMessageRef ->
        val opt = ref.message.preKeyId
        if (opt.isPresent) opt.get() else null
      }
      Function("signedPreKeyId") { ref: PreKeySignalMessageRef -> ref.message.signedPreKeyId }
    }

    AsyncFunction("processPreKeyBundleOp") Coroutine { config: SessionOpConfig, bundle: PreKeyBundleRef, ourIdentityKeyPair: ByteArray, existingSession: ByteArray?, existingRemoteIdentity: ByteArray? ->
      try {
        runProcessPreKeyBundleOp(config, bundle, ourIdentityKeyPair, existingSession, existingRemoteIdentity)
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }

    AsyncFunction("encryptOp") Coroutine { config: SessionOpConfig, plaintext: ByteArray, ourIdentityKeyPair: ByteArray, existingSession: ByteArray, remoteIdentity: ByteArray? ->
      try {
        runEncryptOp(config, plaintext, ourIdentityKeyPair, existingSession, remoteIdentity)
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }

    AsyncFunction("decryptPreKeySignalOp") Coroutine { config: SessionOpConfig, message: ByteArray, ourIdentityKeyPair: ByteArray, existingSession: ByteArray?, existingRemoteIdentity: ByteArray?, preKey: ByteArray?, signedPreKey: ByteArray, kyberPreKey: ByteArray ->
      try {
        runDecryptPreKeySignalOp(config, message, ourIdentityKeyPair, existingSession, existingRemoteIdentity, preKey, signedPreKey, kyberPreKey)
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }

    AsyncFunction("decryptSignalOp") Coroutine { config: SessionOpConfig, message: ByteArray, ourIdentityKeyPair: ByteArray, existingSession: ByteArray, remoteIdentity: ByteArray? ->
      try {
        runDecryptSignalOp(config, message, ourIdentityKeyPair, existingSession, remoteIdentity)
      } catch (e: Throwable) {
        throw RuntimeException(mapSignalError(e).message)
      }
    }
  }
}
