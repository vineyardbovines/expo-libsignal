import Foundation
import ExpoModulesCore
import LibSignalClient

// MARK: - Argument and result records

struct ProcessPreKeyBundleArgs: Record {
  @Field var bundle: PreKeyBundleRef? = nil
  @Field var remoteAddress: ProtocolAddressRef? = nil
  @Field var localAddress: ProtocolAddressRef? = nil
  @Field var ourIdentityKeyPair: IdentityKeyPairRef? = nil
  @Field var ourRegistrationId: UInt32 = 0
  @Field var existingSession: SessionRecordRef? = nil
  @Field var existingRemoteIdentity: PublicIdentityKeyRef? = nil
  @Field var nowMs: Double = 0
}

struct ProcessPreKeyBundleResult: Record {
  @Field var newSession: SessionRecordRef? = nil
  @Field var identityChange: String = ""
  @Field var trustedRemoteIdentity: PublicIdentityKeyRef? = nil
}

// MARK: - Store seeding helpers

func seedStore(
  identityKeyPair: IdentityKeyPairRef,
  registrationId: UInt32,
  remoteAddress: ProtocolAddressRef? = nil,
  existingSession: SessionRecordRef? = nil,
  existingRemoteIdentity: PublicIdentityKeyRef? = nil
) throws -> InMemorySignalProtocolStore {
  let store = InMemorySignalProtocolStore(identity: identityKeyPair.keyPair, registrationId: registrationId)
  let ctx = NullContext()
  if let session = existingSession, let addr = remoteAddress {
    try store.storeSession(session.record, for: addr.address, context: ctx)
  }
  if let ident = existingRemoteIdentity, let addr = remoteAddress {
    _ = try store.saveIdentity(ident.key, for: addr.address, context: ctx)
  }
  return store
}

func identityChangeString(
  store: InMemorySignalProtocolStore,
  remoteAddress: ProtocolAddressRef,
  existing: PublicIdentityKeyRef?
) throws -> String {
  let now = try store.identity(for: remoteAddress.address, context: NullContext())
  if let now = now, let existing = existing, now == existing.key {
    return "newOrUnchanged"
  }
  return existing == nil ? "newOrUnchanged" : "replacedExisting"
}

// MARK: - processPreKeyBundleOp

func runProcessPreKeyBundleOp(_ args: ProcessPreKeyBundleArgs) throws -> ProcessPreKeyBundleResult {
  guard let bundleRef = args.bundle else {
    throw Exception(name: "LibsignalError", description: "bundle is required")
  }
  guard let remoteAddressRef = args.remoteAddress else {
    throw Exception(name: "LibsignalError", description: "remoteAddress is required")
  }
  guard let localAddressRef = args.localAddress else {
    throw Exception(name: "LibsignalError", description: "localAddress is required")
  }
  guard let identityKeyPairRef = args.ourIdentityKeyPair else {
    throw Exception(name: "LibsignalError", description: "ourIdentityKeyPair is required")
  }

  let ctx = NullContext()
  let store = try seedStore(
    identityKeyPair: identityKeyPairRef,
    registrationId: args.ourRegistrationId,
    remoteAddress: remoteAddressRef,
    existingSession: args.existingSession,
    existingRemoteIdentity: args.existingRemoteIdentity
  )

  try processPreKeyBundle(
    bundleRef.bundle,
    for: remoteAddressRef.address,
    ourAddress: localAddressRef.address,
    sessionStore: store,
    identityStore: store,
    now: Date(timeIntervalSince1970: args.nowMs / 1000.0),
    context: ctx
  )

  guard let newSession = try store.loadSession(for: remoteAddressRef.address, context: ctx) else {
    throw Exception(name: "LibsignalError", description: "processPreKeyBundle did not produce a session")
  }
  let trustedRemoteIdentity = try store.identity(for: remoteAddressRef.address, context: ctx)
    ?? bundleRef.bundle.identityKey
  let change = try identityChangeString(
    store: store,
    remoteAddress: remoteAddressRef,
    existing: args.existingRemoteIdentity
  )

  var result = ProcessPreKeyBundleResult()
  result.newSession = SessionRecordRef(record: newSession)
  result.identityChange = change
  result.trustedRemoteIdentity = PublicIdentityKeyRef(key: trustedRemoteIdentity)
  return result
}
