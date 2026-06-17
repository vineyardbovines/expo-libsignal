# expo-libsignal

The Signal Protocol as an Expo Module for React Native apps. Identity, 1:1
messaging (X3DH, Double Ratchet, Kyber), groups (Sender Keys), and Sealed
Sender. Pluggable stores with a SQLCipher-backed implementation included.

**License:** AGPL-3.0. Linking this into a binary makes that binary AGPL-3.0
or compatible. See [LICENSE](./LICENSE).

**Supported runtimes:** Expo SDK 55+, React Native new architecture, iOS 15.0+,
Android API 24+. Legacy bridge is not supported.

## Roadmap

| Surface | State |
|---|---|
| Identity (`IdentityKeyPair`, `ProtocolAddress`) | shipped |
| 1:1 messaging (`SessionBuilder`, `SessionCipher`), X3DH, Double Ratchet, Kyber | shipped |
| Default SQLCipher-backed store (`expo-libsignal/stores`) | shipped |
| Groups (`GroupSessionBuilder`, `GroupCipher`, Sender Keys) | shipped |
| Sealed Sender (`SealedSender`, `SenderCertificate`, `ServerCertificate`) | shipped |
| Example `SignalClient` facade (in `example/src/client/`) | shipped |
| Provisioning | deferred (no standalone primitive in libsignal 0.94.4) |

## Quickstart

Two personas exchange a message. Each holds a `SignalClient` from
`example/src/client/SignalClient.ts`. Copy it into your app and adapt;
this pattern will likely move into the library after some real-world
feedback.

```typescript
import { SignalClient } from './client/SignalClient'

const alice = await SignalClient.open({
  databaseName: 'alice.db',
  keyAlias: 'alice.dbkey',
  self: { name: 'alice-uuid', deviceId: 1 },
})
await alice.initializeIfNeeded({ registrationId: 12345 })

const bob = await SignalClient.open({
  databaseName: 'bob.db',
  keyAlias: 'bob.dbkey',
  self: { name: 'bob-uuid', deviceId: 1 },
})
await bob.initializeIfNeeded({ registrationId: 67890 })

// Bob publishes a one-time prekey bundle; alice consumes it to start a session.
const bobsBundle = await bob.publishOneTimePreKey({
  preKeyId: 100, signedPreKeyId: 200, kyberPreKeyId: 300,
})
await alice.startSession({ name: 'bob-uuid', deviceId: 1 }, bobsBundle)

// Alice encrypts. The returned envelope is what your app ships to bob (over
// your own transport: push, websocket, REST, whatever).
const envelope = await alice.send({ name: 'bob-uuid', deviceId: 1 }, 'hello')

// Bob decrypts whatever envelope landed.
const received = await bob.receive(envelope)
console.log(received.plaintext)  // 'hello'
```

A working three-persona chat demo lives on the `Client` tab of the
example app. It exercises 1:1, sealed sender, and groups end to end on
both platforms.

## Install

```bash
bun add expo-libsignal
```

Add the config plugin to `app.json` or `app.config.ts`:

```json
{
  "expo": {
    "plugins": ["expo-libsignal"]
  }
}
```

Then prebuild:

```bash
bunx expo prebuild --clean
```

The plugin handles the platform plumbing:

- **iOS** injects the `LibSignalClient` pod (Signal hosts the podspec at
  their own URL, not the CocoaPods trunk), sets the FFI download
  checksum, and propagates the FFI linker flags from the
  `LibSignalClient` pod scope to your app target via
  `user_target_xcconfig`.
- **Android** injects Signal's Maven repository
  (`https://build-artifacts.signal.org/libraries/maven/`) into your root
  `build.gradle` and enables core library desugaring in your
  `app/build.gradle` so libsignal's Java 8+ APIs work on minSdk 24.

If you want the default SQLCipher-backed store, see
[Persistence](#persistence) for the one extra step.

## Usage

The library ships two layers. The facade in
`example/src/client/SignalClient.ts` wraps everything (identity, 1:1,
sealed sender, groups, persistence) behind one class. Most apps copy
and adapt it. The primitives underneath (`SessionBuilder`,
`SessionCipher`, `GroupCipher`, `SealedSender`, store interfaces) are
exported from the package root for cases where you want finer control.

### Facade

See the [Quickstart](#quickstart) above and
`example/src/screens/SignalClientScreen.tsx` for the full three-persona
chat demo. The facade source is short, has no hidden state, and is
meant to be read top to bottom before you copy it.

### Primitives

If you want the lower-level building blocks the facade wraps:

```typescript
import { IdentityKeyPair } from 'expo-libsignal'

// First run: generate a fresh identity (X25519 keypair).
const kp = await IdentityKeyPair.generate()

// Serialize to bytes for storage.
const serialized = kp.serialize()
// Uint8Array, 64 bytes (32-byte public key + 32-byte private key)

// Public identity key (33 bytes: 1 type byte + 32 raw key).
const publicKey = kp.publicKey().serialize()

// Restore.
const restored = await IdentityKeyPair.deserialize(serialized)
```

Build a session and exchange messages:

```typescript
import {
  SessionBuilder,
  SessionCipher,
  ProtocolAddress,
  PreKeyBundle,
} from 'expo-libsignal'

const bobAddress = await ProtocolAddress.create('bob-user-id', 1)
const aliceAddress = await ProtocolAddress.create('alice-user-id', 1)

const builder = new SessionBuilder(
  { sessionStore: alice.sessionStore, identityStore: alice.identityStore },
  bobAddress,
  aliceAddress,
)
await builder.processPreKeyBundle(bundle)

const cipher = new SessionCipher(
  {
    sessionStore: alice.sessionStore,
    identityStore: alice.identityStore,
    preKeyStore: alice.preKeyStore,
    signedPreKeyStore: alice.signedPreKeyStore,
    kyberPreKeyStore: alice.kyberPreKeyStore,
  },
  bobAddress,
  aliceAddress,
)
const ciphertext = await cipher.encrypt(new TextEncoder().encode('hello'))

if (ciphertext.type === 'preKeySignal') {
  // First message after a session is established. Bob calls
  // SessionCipher.decryptPreKeySignal on receipt.
} else {
  // Ongoing ratcheted message. Bob calls SessionCipher.decryptSignal.
}
```

Group messaging exposes `GroupSessionBuilder` and `GroupCipher`; sealed
sender exposes `SealedSender.encrypt` / `SealedSender.decryptMessage`.
The shapes mirror libsignal upstream so existing protocol knowledge
transfers.

## Persistence

Store implementations are pluggable. Implement the `SessionStore`,
`IdentityKeyStore`, `PreKeyStore`, `SignedPreKeyStore`,
`KyberPreKeyStore`, and `SenderKeyStore` interfaces yourself, or use
the default SQLCipher-backed store that ships with the library:

```typescript
import { SQLCipherProtocolStore } from 'expo-libsignal/stores'

const store = await SQLCipherProtocolStore.open()
if (!(await store.hasLocalIdentity())) {
  await store.initializeLocalIdentity(await IdentityKeyPair.generate(), registrationId)
}

// One object satisfies every interface.
const cipher = new SessionCipher(
  {
    sessionStore: store,
    identityStore: store,
    preKeyStore: store,
    signedPreKeyStore: store,
    kyberPreKeyStore: store,
  },
  remoteAddress,
  localAddress,
)

// Wrap each protocol operation so its store reads and writes stay atomic.
const ciphertext = await store.runExclusive(() => cipher.encrypt(plaintext))
```

### Enabling SQLCipher

The store needs two peer dependencies:

```bash
bunx expo install expo-secure-store expo-sqlite
```

Add the expo-sqlite plugin with `useSQLCipher` to your `app.json`:

```json
{
  "expo": {
    "plugins": [
      "expo-libsignal",
      "expo-secure-store",
      ["expo-sqlite", { "useSQLCipher": true }]
    ]
  }
}
```

Prebuild:

```bash
bunx expo prebuild --clean
```

That swaps expo-sqlite's vendored SQLite amalgamation for SQLCipher's
(CommonCrypto backend on iOS, OpenSSL on Android) and applies the
SQLite flags SQLCipher needs (`SQLITE_HAS_CODEC`, `NDEBUG`, etc.). The
store verifies SQLCipher is active via `PRAGMA cipher_version` after
applying the key, and refuses to open if the encryption layer is
missing.

### Key handling

The SQLCipher key is 32 random bytes from the OS CSPRNG, hex-encoded,
kept in the iOS Keychain or Android Keystore via expo-secure-store
(`WHEN_UNLOCKED_THIS_DEVICE_ONLY` by default). Override
`keychainAccessible` in the `open` options, or supply your own
`keyProvider` to skip secure-store entirely.

### Schema migrations

Forward-only. During 0.x a release may change the schema without a
data migration path; release notes call this out when it happens. The
library refuses to open a database whose schema is newer than what it
understands, which keeps a downgrade from corrupting your data.

### Implementing your own store

See `src/core/stores.ts` for the interface contract. One non-obvious
detail: `PreKeyStore`, `SignedPreKeyStore`, and `KyberPreKeyStore`
each need a bulk-load method (`loadPreKeys`, `loadSignedPreKeys`,
`loadKyberPreKeys`). Sealed sender decrypt and kyber prekey
resolution seed every candidate up front because the in-envelope ids
only surface after decryption begins.

## Errors

Every error from the library extends `LibsignalError`. Specific
subclasses let callers act on the cause without parsing strings:

| Class | Cause |
|---|---|
| `UntrustedIdentityError` | Remote identity changed and the store rejected it. |
| `SessionNotFoundError` | Tried to encrypt or fetch a session that does not exist. |
| `SenderKeyNotFoundError` | Group encrypt or decrypt with no SKDM exchanged. |
| `InvalidMessageError` | Bytes do not deserialize, signature is bad, or the format is wrong. |
| `DuplicateMessageError` | Replay of a message already processed. |
| `InvalidKeyError` | PreKey, signed prekey, or kyber prekey lookup failed. |
| `StoreError` | SQLCipher layer failure (bad key, locked file, etc.). |
| `SchemaTooNewError` | Database schema is from a newer library version than the installed one. |

```typescript
import {
  IdentityKeyPair,
  LibsignalError,
  InvalidMessageError,
  UntrustedIdentityError,
} from 'expo-libsignal'

try {
  await IdentityKeyPair.deserialize(corruptedBytes)
} catch (e) {
  if (e instanceof InvalidMessageError) {
    // Bytes were not a valid serialized keypair.
  } else if (e instanceof UntrustedIdentityError) {
    // Identity rotation; surface a safety-number-changed banner.
  } else if (e instanceof LibsignalError) {
    // Some other libsignal-side issue.
  }
}
```

## Threat model

Protocol-level guarantees (forward secrecy, post-compromise security,
PQ hybrid in X3DH, sealed sender, group sender authentication) are
libsignal's. See [signal.org/docs](https://signal.org/docs/) and the
[libsignal](https://github.com/signalapp/libsignal) repository.

Specific to this wrapping:

- Native binding correctness is verified by on-device smoke
  (`example/SMOKE_TEST_LOG.md`). Not third-party audited.
- The config plugin pins `LIBSIGNAL_FFI_PREBUILD_CHECKSUM` and verifies
  it at `pod install`. Bumping libsignal requires updating version and
  checksum.
- SQLCipher key: 32 OS-CSPRNG bytes in `expo-secure-store`
  (`WHEN_UNLOCKED_THIS_DEVICE_ONLY` by default). Override `keyProvider`
  to own key custody.
- Schema migrations are forward-only; downgrades throw
  `SchemaTooNewError`. During 0.x a release may change schema without
  migration. Release notes flag this when it happens.
- Provisioning is not bound. libsignal 0.94.4 exposes it only through
  the chat-connection layer, which we do not wrap.
- Group membership is the app's responsibility. Shipping a sender key
  to a non-member adds them to the group.
- Identity-change UX is the app's responsibility. The library raises
  `UntrustedIdentityError`; surfacing the safety-number banner is up
  to you.

## How it works

No Rust FFI is bundled. The build pulls Signal's prebuilt artifacts:

- **iOS:** `LibSignalClient` CocoaPod 0.94.4.
- **Android:** `org.signal:libsignal-android:0.94.4` from Signal's
  Maven repository.

Pinned by exact version. To bump, update `LIBSIGNAL_VERSION` and
`LIBSIGNAL_IOS_FFI_SHA256` in `plugin/src/index.ts`, and the version
pin in `ios/ExpoLibsignal.podspec` and `android/build.gradle`.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Security

See [SECURITY.md](./SECURITY.md).
