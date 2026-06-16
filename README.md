# expo-libsignal

Expo Module wrapping [signalapp/libsignal](https://github.com/signalapp/libsignal) — the Signal Protocol cryptography library — for React Native and Expo apps.

**Status:** Pre-1.0. API is unstable. Not yet published to npm. Foundation (identity keys) is shipped; 1:1 messaging, groups, sealed sender, and the SQLCipher store layer are scoped for later phases.

**License:** AGPL-3.0 (inherited from libsignal upstream). If you link this library into a binary you distribute, your binary must also be AGPL-3.0 or compatible. See [LICENSE](./LICENSE).

## Supported

- Expo SDK 55+
- React Native new architecture (TurboModules / Fabric)
- iOS 15.0+
- Android API 24+

Not supported (yet):
- Web (WASM)
- Old (legacy bridge) architecture

## Installation (when published)

```bash
bun add expo-libsignal
```

Add the config plugin to your `app.json` or `app.config.ts`:

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

The plugin handles the platform-specific plumbing automatically:
- **iOS:** Injects the LibSignalClient pod into your Podfile (Signal hosts the podspec at their own URL, not on the CocoaPods trunk). Sets the FFI download checksum. Propagates the FFI linker flags from LibSignalClient's pod scope to your app target via `user_target_xcconfig`.
- **Android:** Injects Signal's Maven repo (`https://build-artifacts.signal.org/libraries/maven/`) into your root `build.gradle`. Enables core library desugaring in your `app/build.gradle` so libsignal's Java 8+ APIs work on the minSdk we target (24).

## Usage

Generate an identity keypair, serialize it, restore it, derive the public key:

```typescript
import { IdentityKeyPair } from 'expo-libsignal'

// First-run: generate a fresh identity (X25519 keypair)
const kp = await IdentityKeyPair.generate()

// Serialize to bytes for storage
const serialized = kp.serialize()
// → Uint8Array, 64 bytes (32-byte public key + 32-byte private key)

// Get the public identity key (33 bytes — 1 type byte + 32 raw key)
const publicKey = kp.publicKey().serialize()

// Restore from bytes
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

// Alice receives Bob's published PreKeyBundle and establishes a session.
const bobAddress = await ProtocolAddress.create('bob-user-id', 1)
const aliceAddress = await ProtocolAddress.create('alice-user-id', 1)

const builder = new SessionBuilder(
  { sessionStore: alice.sessionStore, identityStore: alice.identityStore },
  bobAddress,
  aliceAddress,
)
await builder.processPreKeyBundle(bundle)

// Now Alice can encrypt to Bob.
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
  // First message after a session is established. Bob's side calls
  // SessionCipher.decryptPreKeySignal on receipt.
} else {
  // Ongoing ratcheted message. Bob's side calls SessionCipher.decryptSignal.
}
```

Store implementations are pluggable. Implement the `SessionStore`,
`IdentityKeyStore`, `PreKeyStore`, `SignedPreKeyStore`, and `KyberPreKeyStore`
interfaces yourself, or use the default SQLCipher-backed store:

```typescript
import { SQLCipherProtocolStore } from 'expo-libsignal/stores'

const store = await SQLCipherProtocolStore.open()
if (!(await store.hasLocalIdentity())) {
  await store.initializeLocalIdentity(await IdentityKeyPair.generate(), registrationId)
}

// One object implements all five interfaces.
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

// Wrap each protocol operation so its store reads/writes are atomic.
const ciphertext = await store.runExclusive(() => cipher.encrypt(plaintext))
```

The default store requires two optional peer dependencies:

```bash
bunx expo install expo-secure-store
bun add @op-engineering/op-sqlite
```

and SQLCipher enabled in **your app's** package.json (op-sqlite reads this
from the app root; a library cannot set it):

```json
"op-sqlite": {
  "sqlcipher": true
}
```

On iOS, SQLCipher needs two extra C flags: `-DSQLCIPHER_CRYPTO_CC` routes it
through Apple's CommonCrypto instead of OpenSSL (the OpenSSL backend hangs on
the first page-cipher HMAC call inside iOS Simulator, and CommonCrypto is also
the conventional and hardware-accelerated choice on Apple platforms);
`-DNDEBUG=1` matches what SQLite's amalgamation expects in non-debug builds
(without it, a clean rebuild of the SQLCipher amalgamation under Xcode Debug
fails on `assert()` references to debug-only struct members).

op-sqlite's package.json `sqliteFlags` knob is platform-shared — anything you
put there is forwarded to Android's NDK clang too, and `-DSQLCIPHER_CRYPTO_CC`
makes the SQLCipher amalgamation `#include <CommonCrypto/CommonCrypto.h>`,
which doesn't exist on Android. Inject the flags from a CocoaPods
`post_install` hook in your app's `ios/Podfile` instead, scoped to the
op-sqlite pod target:

```ruby
post_install do |installer|
  # ... existing post_install logic (Expo, React Native) ...
  installer.pods_project.targets.each do |t|
    next unless t.name == 'op-sqlite'
    t.build_configurations.each do |config|
      cflags = config.build_settings['OTHER_CFLAGS']
      cflags = ['$(inherited)'] if cflags.nil? || cflags.empty?
      cflags = [cflags] if cflags.is_a?(String)
      cflags += ['-DSQLCIPHER_CRYPTO_CC', '-DNDEBUG=1']
      config.build_settings['OTHER_CFLAGS'] = cflags
    end
  end
end
```

Android uses the default OpenSSL backend op-sqlite bundles and needs no
extra flags. The store refuses to open if op-sqlite was built
without SQLCipher. The
database key is 32 random bytes, hex-encoded, kept in the iOS Keychain /
Android Keystore via expo-secure-store (`WHEN_UNLOCKED_THIS_DEVICE_ONLY` by
default; override `keychainAccessible`, or supply your own `keyProvider`).
Schema migrations are forward-only; during 0.x a release may change the
schema without a data migration path, and the release notes will say so.

**Breaking change (unreleased 0.x):** `KyberPreKeyStore` gained
`loadKyberPreKeys(): Promise<KyberPreKeyRecord[]>`. libsignal 0.94.4 does not
expose the kyber prekey id on `PreKeySignalMessage`, so decryption seeds all
stored kyber prekeys and reports back the id actually used.

**Breaking change (unreleased 0.x):** `PreKeyStore` gained
`loadPreKeys(): Promise<PreKeyRecord[]>`; `SignedPreKeyStore` gained
`loadSignedPreKeys(): Promise<SignedPreKeyRecord[]>`. Sealed Sender decrypt
seeds every candidate prekey because the in-envelope ids only surface after
decryption begins.

Errors come back as typed subclasses of `LibsignalError`:

```typescript
import {
  IdentityKeyPair,
  LibsignalError,
  UntrustedIdentityError,
  InvalidMessageError,
} from 'expo-libsignal'

try {
  await IdentityKeyPair.deserialize(corruptedBytes)
} catch (e) {
  if (e instanceof InvalidMessageError) {
    // Bytes weren't a valid serialized keypair
  } else if (e instanceof LibsignalError) {
    // Some other libsignal-side issue
  }
}
```

## Roadmap

| Phase | Status |
|---|---|
| Foundation (identity keys) | ✅ shipped |
| 1:1 messaging (X3DH, Double Ratchet, PreKey bundles) | ✅ shipped |
| Default SQLCipher-backed stores | ✅ shipped (Android and iOS Simulator both verified end to end — see `example/SMOKE_TEST_LOG.md`; iOS requires the Podfile `post_install` hook shown above) |
| Groups (Sender Keys) | ✅ shipped (Android and iOS Simulator both verified end to end — see `example/SMOKE_TEST_LOG.md`) |
| Sealed Sender, Provisioning | pending |
| Ergonomic `SignalClient` facade, full example playground, npm publishing | pending |

## How it works under the hood

`expo-libsignal` is a thin Expo Module that bridges libsignal's native types (`IdentityKeyPair`, eventually `SessionRecord`, `PreKeyBundle`, etc.) to JavaScript as Expo `SharedObject` instances. Each native object is GC-managed via the JSI SharedObject pattern — when the JS reference is collected, the underlying Rust handle is released by a finalizer.

The library does not bundle a pre-built Rust FFI — it relies on Signal's official prebuilt artifacts:
- **iOS:** `LibSignalClient` CocoaPod 0.94.4, which has a script phase that downloads `libsignal-client-ios-build-v0.94.4.tar.gz` from Signal's GitHub release.
- **Android:** `org.signal:libsignal-android:0.94.4` from Signal's own Maven repo.

Both are pinned by exact version. To bump libsignal, update `LIBSIGNAL_VERSION` and `LIBSIGNAL_IOS_FFI_SHA256` in `plugin/src/index.ts` and the version pin in `ios/ExpoLibsignal.podspec` / `android/build.gradle`.

## Contributing

Contributions are welcome. Please open an issue first for anything beyond a small fix — the API is still in flux and we want to coordinate on direction.

## License

AGPL-3.0. See [LICENSE](./LICENSE).

## Security

See [SECURITY.md](./SECURITY.md).
