import Foundation
import ExpoModulesCore
import LibSignalClient

struct PreKeyBundleArgs: Record {
  @Field var registrationId: UInt32 = 0
  @Field var deviceId: UInt32 = 0
  @Field var identityKey: PublicIdentityKeyRef? = nil
  @Field var signedPreKeyId: UInt32 = 0
  @Field var signedPreKeyPublic: PublicKeyRef? = nil
  @Field var signedPreKeySignature: Data = Data()
  @Field var kyberPreKeyId: UInt32 = 0
  @Field var kyberPreKeyPublic: Data = Data()
  @Field var kyberPreKeySignature: Data = Data()
  @Field var preKeyId: UInt32? = nil
  @Field var preKeyPublic: PublicKeyRef? = nil
}

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

    AsyncFunction("createPreKeyBundle") { (args: PreKeyBundleArgs) -> PreKeyBundleRef in
      do {
        guard let identityKeyRef = args.identityKey else {
          throw Exception(name: "LibsignalError", description: "identityKey is required")
        }
        guard let signedPreKeyPublicRef = args.signedPreKeyPublic else {
          throw Exception(name: "LibsignalError", description: "signedPreKeyPublic is required")
        }
        let kyberPub = try KEMPublicKey(args.kyberPreKeyPublic)
        let bundle: PreKeyBundle
        if let preKeyId = args.preKeyId, let preKeyPublicRef = args.preKeyPublic {
          bundle = try PreKeyBundle(
            registrationId: args.registrationId,
            deviceId: args.deviceId,
            prekeyId: preKeyId,
            prekey: preKeyPublicRef.key,
            signedPrekeyId: args.signedPreKeyId,
            signedPrekey: signedPreKeyPublicRef.key,
            signedPrekeySignature: args.signedPreKeySignature,
            identity: identityKeyRef.key,
            kyberPrekeyId: args.kyberPreKeyId,
            kyberPrekey: kyberPub,
            kyberPrekeySignature: args.kyberPreKeySignature
          )
        } else {
          bundle = try PreKeyBundle(
            registrationId: args.registrationId,
            deviceId: args.deviceId,
            signedPrekeyId: args.signedPreKeyId,
            signedPrekey: signedPreKeyPublicRef.key,
            signedPrekeySignature: args.signedPreKeySignature,
            identity: identityKeyRef.key,
            kyberPrekeyId: args.kyberPreKeyId,
            kyberPrekey: kyberPub,
            kyberPrekeySignature: args.kyberPreKeySignature
          )
        }
        return PreKeyBundleRef(bundle: bundle)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(PreKeyBundleRef.self) {
      Function("registrationId") { (ref: PreKeyBundleRef) -> UInt32 in ref.bundle.registrationId }
      Function("deviceId") { (ref: PreKeyBundleRef) -> UInt32 in ref.bundle.deviceId }
      Function("identityKey") { (ref: PreKeyBundleRef) -> PublicIdentityKeyRef in
        PublicIdentityKeyRef(key: ref.bundle.identityKey)
      }
      Function("signedPreKeyId") { (ref: PreKeyBundleRef) -> UInt32 in ref.bundle.signedPreKeyId }
      Function("signedPreKeyPublic") { (ref: PreKeyBundleRef) -> PublicKeyRef in
        PublicKeyRef(key: ref.bundle.signedPreKeyPublic)
      }
      Function("signedPreKeySignature") { (ref: PreKeyBundleRef) -> Data in ref.bundle.signedPreKeySignature }
      Function("kyberPreKeyId") { (ref: PreKeyBundleRef) -> UInt32 in ref.bundle.kyberPreKeyId }
      Function("kyberPreKeyPublic") { (ref: PreKeyBundleRef) -> Data in
        Data(ref.bundle.kyberPreKeyPublic.serialize())
      }
      Function("kyberPreKeySignature") { (ref: PreKeyBundleRef) -> Data in ref.bundle.kyberPreKeySignature }
      Function("preKeyId") { (ref: PreKeyBundleRef) -> UInt32? in ref.bundle.preKeyId }
      Function("preKeyPublic") { (ref: PreKeyBundleRef) -> PublicKeyRef? in
        ref.bundle.preKeyPublic.map { PublicKeyRef(key: $0) }
      }
    }

    AsyncFunction("deserializeSessionRecord") { (bytes: Data) -> SessionRecordRef in
      do {
        let record = try SessionRecord(bytes: bytes)
        return SessionRecordRef(record: record)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(SessionRecordRef.self) {
      Function("serialize") { (ref: SessionRecordRef) -> Data in ref.record.serialize() }
    }

    AsyncFunction("deserializeSignalMessage") { (bytes: Data) -> SignalMessageRef in
      do {
        let msg = try SignalMessage(bytes: bytes)
        return SignalMessageRef(message: msg)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(SignalMessageRef.self) {
      Function("serialize") { (ref: SignalMessageRef) -> Data in ref.message.serialize() }
    }

    AsyncFunction("deserializePreKeySignalMessage") { (bytes: Data) -> PreKeySignalMessageRef in
      do {
        let msg = try PreKeySignalMessage(bytes: bytes)
        return PreKeySignalMessageRef(message: msg)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(PreKeySignalMessageRef.self) {
      Function("serialize") { (ref: PreKeySignalMessageRef) -> Data in
        return try ref.message.serialize()
      }
      Function("registrationId") { (ref: PreKeySignalMessageRef) -> UInt32 in
        return try ref.message.registrationId()
      }
      Function("preKeyId") { (ref: PreKeySignalMessageRef) -> UInt32? in
        return try ref.message.preKeyId()
      }
      Function("signedPreKeyId") { (ref: PreKeySignalMessageRef) -> UInt32 in
        return ref.message.signedPreKeyId
      }
    }

    AsyncFunction("processPreKeyBundleOp") { (args: ProcessPreKeyBundleArgs) -> ProcessPreKeyBundleResult in
      do {
        return try runProcessPreKeyBundleOp(args)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("encryptOp") { (args: EncryptArgs) -> EncryptResult in
      do {
        return try runEncryptOp(args)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("decryptPreKeySignalOp") { (args: DecryptPreKeySignalArgs) -> DecryptPreKeySignalResult in
      do {
        return try runDecryptPreKeySignalOp(args)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }
  }
}
