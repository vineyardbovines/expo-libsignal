# Changelog

All notable changes to `expo-libsignal` are documented here. Format roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/). 0.x releases may change the SQLCipher store schema without a migration path — entries call this out when it happens.

## 0.1.0 — 2026-06-18

First public release. Wraps libsignal 0.94.4 (iOS pod `LibSignalClient`, Android `org.signal:libsignal-android`).

### Added

- Identity (`IdentityKeyPair`, `IdentityKey`, `PrivateKey`, `PublicKey`, `ProtocolAddress`).
- 1:1 messaging: `SessionBuilder`, `SessionCipher`, `PreKeyBundle`, `PreKeyRecord`, `SignedPreKeyRecord`, `KyberPreKeyRecord`, `SessionRecord`. X3DH + Double Ratchet + Kyber PQ hybrid.
- Groups: `GroupSessionBuilder`, `GroupCipher`, `SenderKeyRecord`, `SenderKeyDistributionMessage`.
- Sealed sender: `SealedSender`, `SenderCertificate`, `ServerCertificate`.
- Pluggable store interfaces (`SessionStore`, `IdentityKeyStore`, `PreKeyStore`, `SignedPreKeyStore`, `KyberPreKeyStore`, `SenderKeyStore`).
- Default SQLCipher-backed store at `expo-libsignal/stores` (`SQLCipherProtocolStore`), keyed via `expo-secure-store` by default.
- Messaging transport seam: `Address`, `Envelope`, `Received`, `Transport`, `dispatchReceived`.
- Typed error hierarchy: `LibsignalError`, `UntrustedIdentityError`, `SessionNotFoundError`, `SenderKeyNotFoundError`, `InvalidMessageError`, `DuplicateMessageError`, `InvalidKeyError`, `StoreError`, `SchemaTooNewError`.
- Expo config plugin: pins the libsignal iOS pod and verifies its FFI prebuild checksum at `pod install`; injects Signal's Maven repo and enables core library desugaring on Android.
- Example app with `Client` and `Chat` tabs exercising 1:1, sealed sender, and groups across three personas. Verified on iOS Simulator and Android emulator (see `example/SMOKE_TEST_LOG.md`).

### Known limitations

- Kyber base-key replay detection is not yet enforced for last-resort kyber prekeys; see `SECURITY.md`.
- Provisioning is not bound. libsignal 0.94.4 exposes it only through the chat-connection layer, which we do not wrap.
- Group membership is the app's responsibility.
- The `SignalClient` facade lives in `example/src/client/SignalClient.ts` and is not exported from the package. Copy it into your app.
