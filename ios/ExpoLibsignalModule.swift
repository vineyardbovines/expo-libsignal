import Foundation
import Security
import ExpoModulesCore
import LibSignalClient

// Only primitive fields — incoming Records cannot carry SharedObjects or
// typed arrays on Android, so key/signature bytes are positional arguments
// (see the note in SessionOps.swift).
struct PreKeyBundleArgs: Record {
  @Field var registrationId: UInt32 = 0
  @Field var deviceId: UInt32 = 0
  @Field var signedPreKeyId: UInt32 = 0
  @Field var kyberPreKeyId: UInt32 = 0
  @Field var preKeyId: UInt32? = nil
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

    // OS CSPRNG, used by the SQLCipher store layer for database keys.
    AsyncFunction("generateRandomBytes") { (length: Int) -> Data in
      guard length > 0 && length <= 1024 else {
        throw Exception(name: "LibsignalError", description: "generateRandomBytes: length must be 1...1024, got \(length)")
      }
      var bytes = [UInt8](repeating: 0, count: length)
      let status = SecRandomCopyBytes(kSecRandomDefault, length, &bytes)
      guard status == errSecSuccess else {
        throw Exception(name: "LibsignalError", description: "SecRandomCopyBytes failed with status \(status)")
      }
      return Data(bytes)
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

    AsyncFunction("deserializeIdentityKey") { (bytes: Data) -> PublicIdentityKeyRef in
      do {
        let key = try IdentityKey(bytes: bytes)
        return PublicIdentityKeyRef(key: key)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
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
      Function("kyberPublicKey") { (ref: KyberPreKeyRecordRef) -> Data in
        let pk = try ref.record.publicKey()
        return Data(pk.serialize())
      }
    }

    AsyncFunction("createPreKeyBundle") { (args: PreKeyBundleArgs, identityKeyBytes: Data, signedPreKeyPublicBytes: Data, signedPreKeySignature: Data, kyberPreKeyPublicBytes: Data, kyberPreKeySignature: Data, preKeyPublicBytes: Data?) -> PreKeyBundleRef in
      do {
        let identityKey = try IdentityKey(bytes: identityKeyBytes)
        let signedPreKeyPublic = try PublicKey(signedPreKeyPublicBytes)
        let kyberPub = try KEMPublicKey(kyberPreKeyPublicBytes)
        let bundle: PreKeyBundle
        if let preKeyId = args.preKeyId, let preKeyPublicData = preKeyPublicBytes {
          bundle = try PreKeyBundle(
            registrationId: args.registrationId,
            deviceId: args.deviceId,
            prekeyId: preKeyId,
            prekey: try PublicKey(preKeyPublicData),
            signedPrekeyId: args.signedPreKeyId,
            signedPrekey: signedPreKeyPublic,
            signedPrekeySignature: signedPreKeySignature,
            identity: identityKey,
            kyberPrekeyId: args.kyberPreKeyId,
            kyberPrekey: kyberPub,
            kyberPrekeySignature: kyberPreKeySignature
          )
        } else {
          bundle = try PreKeyBundle(
            registrationId: args.registrationId,
            deviceId: args.deviceId,
            signedPrekeyId: args.signedPreKeyId,
            signedPrekey: signedPreKeyPublic,
            signedPrekeySignature: signedPreKeySignature,
            identity: identityKey,
            kyberPrekeyId: args.kyberPreKeyId,
            kyberPrekey: kyberPub,
            kyberPrekeySignature: kyberPreKeySignature
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

    AsyncFunction("deserializeSenderKeyRecord") { (bytes: Data) -> SenderKeyRecordRef in
      do {
        let record = try SenderKeyRecord(bytes: bytes)
        return SenderKeyRecordRef(record: record)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(SenderKeyRecordRef.self) {
      Function("serialize") { (ref: SenderKeyRecordRef) -> Data in ref.record.serialize() }
    }

    AsyncFunction("deserializeSenderKeyDistributionMessage") { (bytes: Data) -> SenderKeyDistributionMessageRef in
      do {
        let msg = try SenderKeyDistributionMessage(bytes: bytes)
        return SenderKeyDistributionMessageRef(message: msg)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(SenderKeyDistributionMessageRef.self) {
      Function("serialize") { (ref: SenderKeyDistributionMessageRef) -> Data in ref.message.serialize() }
      Function("distributionId") { (ref: SenderKeyDistributionMessageRef) -> String in
        // Foundation's UUID.uuidString is uppercase; lowercase to match
        // Java UUID.toString() so distributionId strings are platform-agnostic.
        return ref.message.distributionId.uuidString.lowercased()
      }
      Function("chainId") { (ref: SenderKeyDistributionMessageRef) -> UInt32 in
        return ref.message.chainId
      }
      Function("iteration") { (ref: SenderKeyDistributionMessageRef) -> UInt32 in
        return ref.message.iteration
      }
    }

    AsyncFunction("processPreKeyBundleOp") { (config: SessionOpConfig, bundle: PreKeyBundleRef, ourIdentityKeyPair: Data, existingSession: Data?, existingRemoteIdentity: Data?) -> ProcessPreKeyBundleResult in
      do {
        return try runProcessPreKeyBundleOp(
          config: config,
          bundle: bundle,
          ourIdentityKeyPair: ourIdentityKeyPair,
          existingSession: existingSession,
          existingRemoteIdentity: existingRemoteIdentity
        )
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("encryptOp") { (config: SessionOpConfig, plaintext: Data, ourIdentityKeyPair: Data, existingSession: Data, remoteIdentity: Data?) -> EncryptResult in
      do {
        return try runEncryptOp(
          config: config,
          plaintext: plaintext,
          ourIdentityKeyPair: ourIdentityKeyPair,
          existingSession: existingSession,
          remoteIdentity: remoteIdentity
        )
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("decryptPreKeySignalOp") { (config: SessionOpConfig, message: Data, ourIdentityKeyPair: Data, existingSession: Data?, existingRemoteIdentity: Data?, preKey: Data?, signedPreKey: Data, kyberPreKeys: Data) -> DecryptPreKeySignalResult in
      do {
        return try runDecryptPreKeySignalOp(
          config: config,
          message: message,
          ourIdentityKeyPair: ourIdentityKeyPair,
          existingSession: existingSession,
          existingRemoteIdentity: existingRemoteIdentity,
          preKey: preKey,
          signedPreKey: signedPreKey,
          kyberPreKeys: kyberPreKeys
        )
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("decryptSignalOp") { (config: SessionOpConfig, message: Data, ourIdentityKeyPair: Data, existingSession: Data, remoteIdentity: Data?) -> DecryptSignalResult in
      do {
        return try runDecryptSignalOp(
          config: config,
          message: message,
          ourIdentityKeyPair: ourIdentityKeyPair,
          existingSession: existingSession,
          remoteIdentity: remoteIdentity
        )
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("createSenderKeyDistributionOp") { (config: SenderKeyOpConfig, distributionId: String, existingRecord: Data?) -> CreateSenderKeyDistributionResult in
      do {
        return try runCreateSenderKeyDistributionOp(config: config, distributionId: distributionId, existingRecord: existingRecord)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("processSenderKeyDistributionOp") { (config: SenderKeyOpConfig, distributionId: String, message: Data, existingRecord: Data?) -> ProcessSenderKeyDistributionResult in
      do {
        return try runProcessSenderKeyDistributionOp(config: config, distributionId: distributionId, message: message, existingRecord: existingRecord)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("groupEncryptOp") { (config: SenderKeyOpConfig, distributionId: String, plaintext: Data, existingRecord: Data) -> GroupEncryptResult in
      do {
        return try runGroupEncryptOp(config: config, distributionId: distributionId, plaintext: plaintext, existingRecord: existingRecord)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("groupDecryptOp") { (config: SenderKeyOpConfig, ciphertext: Data, existingRecord: Data) -> GroupDecryptResult in
      do {
        return try runGroupDecryptOp(config: config, ciphertext: ciphertext, existingRecord: existingRecord)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("deserializeServerCertificate") { (bytes: Data) -> ServerCertificateRef in
      do {
        let cert = try ServerCertificate(bytes)
        return ServerCertificateRef(cert: cert)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(ServerCertificateRef.self) {
      Function("serialize") { (ref: ServerCertificateRef) -> Data in ref.cert.serialize() }
      Function("keyId") { (ref: ServerCertificateRef) -> UInt32 in ref.cert.keyId }
      Function("signature") { (ref: ServerCertificateRef) -> Data in ref.cert.signatureBytes }
      Function("key") { (ref: ServerCertificateRef) -> PublicKeyRef in
        PublicKeyRef(key: ref.cert.publicKey)
      }
    }

    AsyncFunction("deserializeSenderCertificate") { (bytes: Data) -> SenderCertificateRef in
      do {
        let cert = try SenderCertificate(bytes)
        return SenderCertificateRef(cert: cert)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    Class(SenderCertificateRef.self) {
      Function("serialize") { (ref: SenderCertificateRef) -> Data in ref.cert.serialize() }
      // Lowercased to match Java's UUID.toString() (Foundation UUID is uppercase).
      Function("senderUuid") { (ref: SenderCertificateRef) -> String in ref.cert.senderUuid.lowercased() }
      Function("senderE164") { (ref: SenderCertificateRef) -> String? in ref.cert.senderE164 }
      Function("senderDeviceId") { (ref: SenderCertificateRef) -> UInt32 in ref.cert.deviceId }
      Function("expiration") { (ref: SenderCertificateRef) -> Double in Double(ref.cert.expiration) }
      Function("signatureKey") { (ref: SenderCertificateRef) -> PublicKeyRef in
        PublicKeyRef(key: ref.cert.publicKey)
      }
      Function("serverCertificate") { (ref: SenderCertificateRef) -> ServerCertificateRef in
        ServerCertificateRef(cert: ref.cert.serverCertificate)
      }
    }

    AsyncFunction("generateServerCertificateOp") { (keyId: UInt32, serverKey: Data, trustRoot: Data) -> GenerateServerCertificateResult in
      do {
        return try runGenerateServerCertificateOp(keyId: keyId, serverKeyBytes: serverKey, trustRootBytes: trustRoot)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("generateSenderCertificateOp") { (senderUuid: String, senderE164: String?, senderDeviceId: UInt32, senderKey: Data, expiration: Double, serverCert: Data, serverPrivateKey: Data) -> GenerateSenderCertificateResult in
      do {
        return try runGenerateSenderCertificateOp(senderUuid: senderUuid, senderE164: senderE164, senderDeviceId: senderDeviceId, senderKeyBytes: senderKey, expiration: expiration, serverCertBytes: serverCert, serverPrivateKeyBytes: serverPrivateKey)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("validateSenderCertificateOp") { (senderCert: Data, trustRoot: Data, validationTime: Double) -> Bool in
      do {
        return try runValidateSenderCertificateOp(senderCertBytes: senderCert, trustRootBytes: trustRoot, validationTime: validationTime)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("sealedSenderEncryptOp") { (config: SealedSenderEncryptOpConfig, senderCert: Data, plaintext: Data, existingSession: Data, existingRemoteIdentity: Data?, ourIdentityKeyPair: Data) -> SealedSenderEncryptResult in
      do {
        return try runSealedSenderEncryptOp(config: config, senderCertBytes: senderCert, plaintext: plaintext, existingSession: existingSession, existingRemoteIdentity: existingRemoteIdentity, ourIdentityKeyPair: ourIdentityKeyPair)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }

    AsyncFunction("sealedSenderDecryptOp") { (config: SealedSenderDecryptOpConfig, ciphertext: Data, trustRoot: Data, ourIdentityKeyPair: Data, kyberPreKeys: Data, preKeys: Data, signedPreKeys: Data) -> SealedSenderDecryptResult in
      do {
        return try runSealedSenderDecryptOp(config: config, ciphertext: ciphertext, trustRootBytes: trustRoot, ourIdentityKeyPair: ourIdentityKeyPair, kyberPreKeysBlob: kyberPreKeys, preKeysBlob: preKeys, signedPreKeysBlob: signedPreKeys)
      } catch {
        throw Exception(name: "LibsignalError", description: "\(error)")
      }
    }
  }
}
