# Phase 4b Kickoff: Sealed Sender

Scoped lighter than Phase 4a — no new store interface, no schema bump, mostly cert plumbing + two stateless functions.

## Where things stand

Latest on `main` at `/Users/spence/dev/expo-libsignal/`:
- Phases 1-3 shipped (identity, 1:1 messaging, SQLCipher stores). iOS + Android verified.
- Phase 4a (Sender Keys / Groups) shipped. iPhone 17 Pro Sim (iOS 26.4) + Pixel 10 AVD both pass 8/8 fresh + 4/4 resumed.
- Plan doc precedent: `docs/superpowers/plans/2026-06-16-expo-libsignal-phase-4-sender-keys.md` (full bite-sized plan).
- Kickoff doc precedent: `docs/superpowers/specs/2026-06-05-expo-libsignal-phase-2-kickoff-prompt.md` (this doc matches that lighter style).

## Goal

Wrap libsignal's Sealed Sender so the example can: mint a server cert under a test trust root, issue a sender cert to alice, alice sends a sealed-sender envelope to bob, bob verifies the cert against the trust root and recovers the plaintext + alice's identity. Both platforms.

## API surface to add

```ts
class ServerCertificate {
  static async generate(opts: { keyId: number; serverKey: PublicKey; trustRoot: IdentityKeyPair }): Promise<ServerCertificate>
  static deserialize(bytes: Uint8Array): Promise<ServerCertificate>
  serialize(): Uint8Array
  keyId(): number
  signature(): Uint8Array
  key(): PublicKey
}

class SenderCertificate {
  static async generate(opts: {
    senderUuid: string
    senderE164?: string
    senderDeviceId: number
    senderKey: PublicKey
    expiration: number
    serverCert: ServerCertificate
    serverKey: PrivateKey
  }): Promise<SenderCertificate>
  static deserialize(bytes: Uint8Array): Promise<SenderCertificate>
  serialize(): Uint8Array
  senderUuid(): string
  senderE164(): string | null
  senderDeviceId(): number
  expiration(): number
  signatureKey(): PublicKey
  serverCertificate(): ServerCertificate
  validate(trustRoot: PublicKey, validationTime: number): Promise<boolean>
}

namespace SealedSender {
  function encrypt(opts: {
    destination: ProtocolAddress
    senderCert: SenderCertificate
    message: Uint8Array
    sessionStore: SessionStore
    identityStore: IdentityKeyStore
  }): Promise<Uint8Array>

  function decryptMessage(opts: {
    ciphertext: Uint8Array
    trustRoot: PublicKey
    timestamp: number
    localUuid: string
    localE164?: string
    localDeviceId: number
    stores: SessionCipherStores
  }): Promise<{
    message: Uint8Array
    senderUuid: string
    senderE164: string | null
    senderDeviceId: number
  }>
}
```

Notes:
- `generate` factory methods exist for test setup (we mint test certs). Production callers receive certs from a server and only call `deserialize`.
- `validate` is a JS wrapper around libsignal's signature check; it's also called internally by `decryptMessage` so callers usually don't need to call it directly.
- `decryptMessage` returns a tagged plaintext so the caller can route by sender identity without re-parsing.

## Native ops

Mirror the Phase 2 / Phase 4a pattern: positional byte arguments, in-memory store seeded from JS-provided bytes, ops return updated session bytes for JS to persist.

1. `generateServerCertificateOp(keyId, serverKeyBytes, trustRootBytes)` → server cert bytes
2. `generateSenderCertificateOp(senderUuid, senderE164?, senderDeviceId, senderKeyBytes, expiration, serverCertBytes, serverKeyBytes)` → sender cert bytes
3. `validateSenderCertificateOp(senderCertBytes, trustRootBytes, validationTime)` → bool
4. `sealedSenderEncryptOp(config, destinationName, destinationDeviceId, senderCertBytes, plaintext, existingSession, existingRemoteIdentity?, ourIdentityBytes)` → `{ ciphertext, newSession, identityChange }`
5. `sealedSenderDecryptOp(config, ciphertext, trustRootBytes, timestamp, localUuid, localE164?, localDeviceId, ourIdentityBytes, existingSession?, existingRemoteIdentity?, preKey?, signedPreKey, kyberPreKeys)` → `{ plaintext, senderUuid, senderE164, senderDeviceId, newSession, identityChange, consumedPreKeyId?, kyberPreKeyId? }`

Cert SharedObject classes (`ServerCertificateRef`, `SenderCertificateRef`) follow the same shape as `SenderKeyDistributionMessageRef` and `SessionRecordRef`.

## Out of scope

- Sealed Sender multi-recipient send (group sealed sender). Punt to a possible Phase 4d.
- Sender cert chain validation beyond the single-server-cert-under-trust-root case.
- Provisioning (Phase 4c, separate kickoff).
- Schema changes — Sealed Sender stores nothing new. Existing `SQLCipherProtocolStore` covers it via the existing session + identity stores.

## Testing

Library jest tests mock `NativeModule` and verify cert getters + signature flow at the TS layer.

Example integration: new `SealedSenderScreen.tsx` modeled on `AliceBobScreen.tsx`. Three-step flow:

1. Mint a trust-root keypair (just an `IdentityKeyPair.generate`). Generate a server keypair. Issue a server cert under the trust root.
2. Issue a sender cert to alice, signed by the server cert. Set up alice/bob 1:1 session (PreKeyBundle as in AliceBob).
3. Alice `SealedSender.encrypt({destination: bob, senderCert, message: "hello"})`, bob `SealedSender.decryptMessage({ciphertext, trustRoot, ...})`. Assert plaintext recovered + sender identity matches alice's UUID.

Smoke: same `[SEALED-SUMMARY]` console.log pattern, grep on both platforms. Update `example/SMOKE_TEST_LOG.md`.

## UUID-case note for iOS

Phase 4a surfaced that `Foundation.UUID.uuidString` is uppercase while Java's `UUID.toString()` is lowercase. The fix at `71560bf7fcde` lowercases iOS's `SenderKeyDistributionMessageRef.distributionId()`. Apply the same pattern to any UUID accessor on SenderCertificate / ServerCertificate to keep parity. Specifically: `SenderCertificate.senderUuid()` returns a string — lowercase it on iOS at the accessor.

## How to execute

Plan-then-execute via subagent-driven development, same flow as Phase 4a. A full bite-sized plan in `docs/superpowers/plans/2026-06-16-expo-libsignal-phase-4b-sealed-sender.md` is overkill for ~3 cert classes + 2 stateless functions. A medium-grain plan listing per-round file targets and test expectations is enough.

Suggested rounds:
1. **TS foundation** — ServerCertificate, SenderCertificate classes; types; jest tests with mocked NativeModule.
2. **iOS native** — Refs + Ops for cert generate/deserialize/validate.
3. **Android native** — same.
4. **TS SealedSender namespace** — encrypt/decrypt that wraps the native ops and lifts errors through `rethrowAsLibsignal`.
5. **Example screen** — SealedSenderScreen.tsx + tab wiring + smoke verification.

Expected size: ~10-12 implementer tasks total, vs Phase 4a's 15.

## Tone

Plain engineering writeup. No claudespeak. Match the existing commit voice and the previous kickoff style.
