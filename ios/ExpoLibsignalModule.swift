import Foundation
import ExpoModulesCore
import LibSignalClient

public final class ExpoLibsignalModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoLibsignal")

    Class(IdentityKeyPairRef.self) {
      AsyncFunction("generate") { () -> IdentityKeyPairRef in
        let keyPair = IdentityKeyPair.generate()
        return IdentityKeyPairRef(keyPair: keyPair)
      }

      AsyncFunction("deserialize") { (bytes: Data) -> IdentityKeyPairRef in
        do {
          let kp = try IdentityKeyPair(bytes: bytes)
          return IdentityKeyPairRef(keyPair: kp)
        } catch {
          throw Exception(name: "LibsignalError", description: "\(error)")
        }
      }

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
