package expo.modules.libsignal

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.signal.libsignal.protocol.IdentityKeyPair as SignalIdentityKeyPair
import org.signal.libsignal.protocol.SignalProtocolAddress
import org.signal.libsignal.protocol.ecc.ECPublicKey

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
  }
}
