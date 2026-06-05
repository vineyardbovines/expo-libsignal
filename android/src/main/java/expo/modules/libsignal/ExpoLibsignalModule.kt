package expo.modules.libsignal

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.signal.libsignal.protocol.IdentityKeyPair as SignalIdentityKeyPair

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
    Class(IdentityKeyPairRef::class) {
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
      Function("serialize") { ref: PublicIdentityKeyRef ->
        ref.key.serialize()
      }
    }

    Class(PrivateKeyRef::class) {
      Function("serialize") { ref: PrivateKeyRef ->
        ref.key.serialize()
      }
    }
  }
}
