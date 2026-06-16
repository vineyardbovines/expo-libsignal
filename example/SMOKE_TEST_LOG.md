# Smoke test log

Manual on-device runs of the example app's integration screens, newest first.

## 2026-06-16 — Phase 4a: Sender Keys (groups) verified on both platforms

- iOS simulator (iPhone 17 Pro, iOS 26.4): pass (8 of 8 steps, fresh run)
- Android emulator (Pixel 10 AVD): pass (8 of 8 steps, fresh run)
- 3-party Alice/Bob/Carol scenario: pairwise 1:1 sessions, alice ships SKDM via 1:1 to bob and carol, both decrypt alice's group message, bob ships his own SKDM, alice and carol decrypt bob's group reply
- Resumed-run path: both platforms pass (`status=ok, runKind=resumed`) after `simctl terminate` / `am force-stop` + relaunch. Sender keys round-trip from on-disk state, no handshake needed.
- One iOS-only bug surfaced and fixed during smoke testing: `Foundation.UUID.uuidString` is uppercase, `Java.UUID.toString()` is lowercase. `SenderKeyDistributionMessage.distributionId()` returned the wrong case on iOS, so bob's `processSenderKeyDistributionMessage` keyed his stored row by uppercase while alice's `createSenderKeyDistributionMessage` keyed hers by the caller-passed lowercase. Composite-key SELECT in SQLCipher is case-sensitive — bob's row was effectively invisible to subsequent loads. Diagnosed by raw `sqlite_master` + `sender_keys` dump from a second op-sqlite connection inside the screen. Fixed by lowercasing the iOS accessor.

## 2026-06-16 — Android build regression from yesterday's iOS Sim fix, fixed

- Yesterday's `op-sqlite.sqliteFlags` addition in `example/package.json` broke the Android build: op-sqlite's Android Gradle reads `sqliteFlags` and forwards them to NDK clang via `add_compile_options`, so `-DSQLCIPHER_CRYPTO_CC` reached the SQLCipher amalgamation, which then tried to `#include <CommonCrypto/CommonCrypto.h>` — a header that doesn't exist on Android NDK.
- The README claim that the flags are "no-ops on Android" was wrong; verified by reading `example/node_modules/@op-engineering/op-sqlite/android/build.gradle` and `android/CMakeLists.txt`.
- op-sqlite has no per-platform `sqliteFlags` (one key, applied to both), so the fix is to drop `sqliteFlags` from `example/package.json` and inject the iOS flags from a CocoaPods `post_install` hook in `example/ios/Podfile` scoped to the `op-sqlite` pod target only.
- Verified after fix:
  - iOS Simulator (iPhone 17 Pro, iOS 26.4): `BUILD SUCCEEDED` via xcodebuild; the generated `Pods.xcodeproj` target build config for op-sqlite includes `-DSQLCIPHER_CRYPTO_CC` and `-DNDEBUG=1` in `OTHER_CFLAGS` (Debug and Release).
  - Android (Pixel 10 AVD): `BUILD SUCCESSFUL` for `:app:assembleDebug`. Android falls back to op-sqlite's default OpenSSL backend.

## 2026-06-16 — Phase 3: SQLCipher stores (iOS) — verified end to end

- iOS simulator (iPhone 17 Pro, iOS 26.4): pass (fresh and resumed)
- Fresh run: 9 of 9 steps green, `run=fresh`, `kyberUsedId=101` (decoy at 100 untouched)
- Resumed run (after `simctl terminate` + relaunch): 4 of 4 steps green, `run=resumed`, first message `type=signal` (no handshake), so the session was restored from on-disk SQLCipher state
- Alice & Bob regression: 12 of 12, kyber id mapping confirmed
- Root cause of the previous hang: the SQLCipher amalgamation defaults to its OpenSSL crypto provider, which on iOS Simulator stalls on the first `sqlcipher_page_hmac` call (the path the wrong-key crash dump from 2026-06-15 also points at)
- Fix lives in `example/package.json` under `op-sqlite.sqliteFlags`: `-DSQLCIPHER_CRYPTO_CC` switches SQLCipher to Apple's CommonCrypto backend; `-DNDEBUG=1` matches what SQLite's amalgamation expects in non-debug builds (Xcode Debug does not set it, op-sqlite's podspec does not set it, so a clean rebuild of `cpp/sqlcipher/sqlite3.c` was failing on `assert(EdupBuf.zEnd)` and similar)
- Library code is unchanged; the fix is in the example app's config only
- op-sqlite pinned to 15.2.14 to match what was actually installed and verified (package.json had drifted to 16.2.1 with no lockfile)
- Physical iPhone run still TBD as additional ground truth

## 2026-06-15 — Phase 3: SQLCipher stores (Android)

- Android emulator (Pixel 10 AVD, emulator-5554): pass (9 of 9 steps on fresh run, 4 of 4 on resumed run)
- Alice & Bob regression: pass (12 of 12 steps, kyber decoy untouched)
- Fresh run: `run=fresh`, `kyberUsedId=101` (decoy at id 100 not touched), session persisted to disk
- Resumed run (after `am force-stop` + relaunch): `run=resumed`, first message type=signal (no handshake), session restored from on-disk SQLCipher state
- On-disk verification: `alice.db` header bytes are random (no SQLite magic), so SQLCipher is encrypting pages
- WAL mode active (`alice.db-wal` present, 185 KB after fresh run)

## 2026-06-15 — Phase 3: SQLCipher stores (iOS)

- iOS simulator (iPhone 17 Pro, iOS 26.4): NOT verified end to end
- Alice & Bob regression: pass (12 of 12 steps), kyber id mapping fix confirmed on iOS
- SQLCipher path hangs on the first write (`CREATE TABLE`) when op-sqlite 16.2.1 is built with SQLCipher on iOS Simulator. Reads succeed (`PRAGMA cipher_version`, `SELECT count(*) FROM sqlite_master`); the first write never returns. Disabling encryption makes the same code complete fast.
- Stack at hang (from sampling a crash dump from one earlier wrong-key run): `sqlcipher_shield` → `sqlcipher_page_hmac` → `sqlcipher_page_cipher` → `sqlite3Codec` inside op-sqlite's `execute` thread pool. Looks environmental (op-sqlite + SQLCipher + iOS Simulator), not in this library: same JS path passes on Android.
- The example app's iOS entitlements now declare `keychain-access-groups` (via `ios.entitlements` in `app.json`) so expo-secure-store works on Xcode simulator builds without team signing.
- Recommended: re-run on a physical iOS device or revisit when op-sqlite ships a fix.
- Version bisection (2026-06-15 evening): the hang reproduces identically on op-sqlite 15.2.14, 16.2.1, and 16.2.2. Pre- and post-PR #409 (the SQLCipher key API switch in 16.1.0) both hang the same way, so the bug is older and broader than that change. Constants across all three versions: iOS Simulator + bundled SQLCipher + OpenSSL-Universal.
- Related upstream context (not a fix): op-sqlite [issue #202](https://github.com/OP-Engineering/op-sqlite/issues/202) calls out a shared thread pool with no concurrency guarantees; [issue #245](https://github.com/OP-Engineering/op-sqlite/issues/245) and [issue #360](https://github.com/OP-Engineering/op-sqlite/issues/360) document other SQLCipher / iOS Simulator quirks; [issue #417](https://github.com/OP-Engineering/op-sqlite/issues/417) was a 16.2.1 UTF-8 regression, reverted in 16.2.2.
- Next steps: try a physical iPhone, or file an issue against op-sqlite with a minimal repro.

## 2026-06-12 — Phase 2: 1:1 messaging (Android)

- Android emulator (Pixel 10 AVD, emulator-5554): ok (12 of 12 steps passed)
- First message type: preKeySignal (1761 bytes)
- Subsequent message type: signal (72 bytes)
- One-time prekey consumed: verified
- Kyber prekey marked used: verified
- Ratchet round-trips: 3/3 ok

## 2026-06-12 — Phase 2: 1:1 messaging (iOS)

- iOS simulator (iPhone 17 Pro, iOS 26.3): ok (12 of 12 steps passed)
- First message type: preKeySignal (1761 bytes)
- Subsequent message type: signal (72 bytes)
- One-time prekey consumed: verified
- Kyber prekey marked used: verified
- Ratchet round-trips: 3/3 ok
