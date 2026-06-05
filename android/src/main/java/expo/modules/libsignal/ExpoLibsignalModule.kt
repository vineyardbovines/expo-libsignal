package expo.modules.libsignal

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.signal.libsignal.protocol.IdentityKeyPair as SignalIdentityKeyPair

class ExpoLibsignalModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoLibsignal")

    Class(IdentityKeyPairRef::class) {
      AsyncFunction("generate") Coroutine { ->
        IdentityKeyPairRef(SignalIdentityKeyPair.generate())
      }

      AsyncFunction("deserialize") Coroutine { bytes: ByteArray ->
        try {
          IdentityKeyPairRef(SignalIdentityKeyPair(bytes))
        } catch (e: Throwable) {
          throw RuntimeException(mapSignalError(e).message)
        }
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
