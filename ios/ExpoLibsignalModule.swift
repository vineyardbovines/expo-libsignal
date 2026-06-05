import Foundation
import ExpoModulesCore
import LibSignalClient

public final class ExpoLibsignalModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoLibsignal")

    // Factory functions live at module level — inside a Class block,
    // AsyncFunction would become an instance method (bound to a ref that
    // doesn't exist yet at construction time).
    AsyncFunction("generateIdentityKeyPair") { () -> IdentityKeyPairRef in
      let keyPair = IdentityKeyPair.generate()
      return IdentityKeyPairRef(keyPair: keyPair)
    }

    AsyncFunction("deserializeIdentityKeyPair") { (bytes: Data) -> IdentityKeyPairRef in
      do {
        let kp = try IdentityKeyPair(bytes: bytes)
        return IdentityKeyPairRef(keyPair: kp)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    // Instance methods. The first parameter (typed as the SharedObject) is
    // auto-bound to `this` on the JS side, so callers do `ref.serialize()`.
    Class(IdentityKeyPairRef.self) {
      Function("serialize") { (ref: IdentityKeyPairRef) -> Data in
        return ref.keyPair.serialize()
      }

      Function("publicKey") { (ref: IdentityKeyPairRef) -> PublicIdentityKeyRef in
        return PublicIdentityKeyRef(key: ref.keyPair.identityKey)
      }

      Function("privateKey") { (ref: IdentityKeyPairRef) -> PrivateKeyRef in
        return PrivateKeyRef(key: ref.keyPair.privateKey)
      }
    }

    Class(PublicIdentityKeyRef.self) {
      Function("serialize") { (ref: PublicIdentityKeyRef) -> Data in
        return ref.key.serialize()
      }
    }

    Class(PrivateKeyRef.self) {
      Function("serialize") { (ref: PrivateKeyRef) -> Data in
        return ref.key.serialize()
      }
    }
  }
}
