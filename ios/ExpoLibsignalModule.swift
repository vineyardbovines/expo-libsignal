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

    AsyncFunction("deserializePublicKey") { (bytes: Data) -> PublicKeyRef in
      do {
        let key = try PublicKey(bytes)
        return PublicKeyRef(key: key)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(PublicKeyRef.self) {
      Function("serialize") { (ref: PublicKeyRef) -> Data in
        return Data(ref.key.serialize())
      }
    }

    AsyncFunction("createProtocolAddress") { (name: String, deviceId: UInt32) -> ProtocolAddressRef in
      do {
        let addr = try ProtocolAddress(name: name, deviceId: deviceId)
        return ProtocolAddressRef(address: addr)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(ProtocolAddressRef.self) {
      Function("name") { (ref: ProtocolAddressRef) -> String in
        return ref.address.name
      }
      Function("deviceId") { (ref: ProtocolAddressRef) -> UInt32 in
        return ref.address.deviceId
      }
    }

    AsyncFunction("generatePreKeyRecord") { (id: UInt32) -> PreKeyRecordRef in
      do {
        let privateKey = PrivateKey.generate()
        let record = try PreKeyRecord(id: id, privateKey: privateKey)
        return PreKeyRecordRef(record: record)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("deserializePreKeyRecord") { (bytes: Data) -> PreKeyRecordRef in
      do {
        let record = try PreKeyRecord(bytes: bytes)
        return PreKeyRecordRef(record: record)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(PreKeyRecordRef.self) {
      Function("id") { (ref: PreKeyRecordRef) -> UInt32 in
        return ref.record.id
      }
      Function("publicKey") { (ref: PreKeyRecordRef) -> PublicKeyRef in
        let pk = try ref.record.publicKey()
        return PublicKeyRef(key: pk)
      }
      Function("serialize") { (ref: PreKeyRecordRef) -> Data in
        return ref.record.serialize()
      }
    }

    AsyncFunction("generateSignedPreKeyRecord") { (id: UInt32, identity: IdentityKeyPairRef, timestamp: Double) -> SignedPreKeyRecordRef in
      do {
        let privateKey = PrivateKey.generate()
        let signature = identity.keyPair.privateKey.generateSignature(message: privateKey.publicKey.serialize())
        let record = try SignedPreKeyRecord(id: id, timestamp: UInt64(timestamp), privateKey: privateKey, signature: signature)
        return SignedPreKeyRecordRef(record: record)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("deserializeSignedPreKeyRecord") { (bytes: Data) -> SignedPreKeyRecordRef in
      do {
        let record = try SignedPreKeyRecord(bytes: bytes)
        return SignedPreKeyRecordRef(record: record)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(SignedPreKeyRecordRef.self) {
      Function("id") { (ref: SignedPreKeyRecordRef) -> UInt32 in
        return ref.record.id
      }
      Function("timestamp") { (ref: SignedPreKeyRecordRef) -> Double in
        return Double(ref.record.timestamp)
      }
      Function("publicKey") { (ref: SignedPreKeyRecordRef) -> PublicKeyRef in
        let pk = try ref.record.publicKey()
        return PublicKeyRef(key: pk)
      }
      Function("signature") { (ref: SignedPreKeyRecordRef) -> Data in
        return ref.record.signature
      }
      Function("serialize") { (ref: SignedPreKeyRecordRef) -> Data in
        return ref.record.serialize()
      }
    }

    AsyncFunction("generateKyberPreKeyRecord") { (id: UInt32, identity: IdentityKeyPairRef, timestamp: Double) -> KyberPreKeyRecordRef in
      do {
        let keyPair = KEMKeyPair.generate()
        let signature = identity.keyPair.privateKey.generateSignature(message: keyPair.publicKey.serialize())
        let record = try KyberPreKeyRecord(id: id, timestamp: UInt64(timestamp), keyPair: keyPair, signature: signature)
        return KyberPreKeyRecordRef(record: record)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("deserializeKyberPreKeyRecord") { (bytes: Data) -> KyberPreKeyRecordRef in
      do {
        let record = try KyberPreKeyRecord(bytes: bytes)
        return KyberPreKeyRecordRef(record: record)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(KyberPreKeyRecordRef.self) {
      Function("id") { (ref: KyberPreKeyRecordRef) -> UInt32 in
        return ref.record.id
      }
      Function("timestamp") { (ref: KyberPreKeyRecordRef) -> Double in
        return Double(ref.record.timestamp)
      }
      Function("signature") { (ref: KyberPreKeyRecordRef) -> Data in
        return ref.record.signature
      }
      Function("serialize") { (ref: KyberPreKeyRecordRef) -> Data in
        return ref.record.serialize()
      }
    }
  }
}
