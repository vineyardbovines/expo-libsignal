# Smoke test log

Manual on-device runs of the example app's integration screens, newest first.

## 2026-06-18 — Chat tab verified on Android

- Android emulator (Pixel 10 AVD): pass. Same scripted smoke as the iOS run on 2026-06-17, status:"ok" across runs. Closes the "pending Android re-run" caveat on the prior entry.

## 2026-06-17 — Chat tab verified on iOS Simulator

- iOS simulator (iPhone 17 Pro, iOS 26.4): pass (status:"ok", both scripted smoke steps green across three consecutive runs)
- Demo: `Chat` tab opens three `SignalClient` + `ChatStore` instances (alice, bob, carol) over their own SQLCipher databases (`${persona}.chat-libsignal.db` for libsignal state and `${persona}.chat.db` for messages and conversations). Pre-creates two direct conversations and one group per persona, mints a sealed-sender cert chain, and exposes a hand-rolled chat UI (ScrollView of bubbles + composer) per conversation. Persona switcher in the header swaps the active store/client; drill-in navigation is local component state. Transport interface (`Transport`) with an `InMemoryTransport` singleton brokers between personas.
- Android: not run this session. The chat tab is pure JS on top of the native module set verified by the SignalClient phase smoke (`2026-06-16`), so Android should pass the same way; pending a re-run when the emulator is back up.
- Three example-side bugs surfaced and fixed during smoke:
  - Pre-key reuse on welcome wrap. Step 1 of the scripted smoke consumed bob's prekey 5000 in his decryptPreKeySignal of alice's "hi bob". Alice's session with bob was still pending pre-key (no reply yet), so the SignalGroupClient.welcome wrap was another preKeySignal envelope referencing the already-consumed prekey 5000. Bob's decrypt threw InvalidKeyError, the welcome never processed, and the group ciphertext that followed threw SenderKeyNotFoundError. Fix: bob and carol each send a one-shot "ack" back to alice before welcomes ship, advancing alice's outbound sessions past the pre-key state. Welcomes are then signal-type and decrypt cleanly.
  - Async receive timing. The persona-level `attachReceiver` is fire-and-forget per envelope (subscriber callback wraps an async IIFE), so welcome processing and group decrypt raced. Bumped smoke wait windows from 50ms to 500ms between alice's welcome ship and group send, and again between group send and assertion. Real apps would replace this with an event-driven refresh.
  - react-native-gifted-chat install dance. The original plan called for gifted-chat. Every recent version pulls in four native peer deps (reanimated, keyboard-controller, gesture-handler, safe-area-context), and `expo install` plus `bun install` repeatedly hung on the file:.. workspace recursion. Flipped mid-execution to a hand-rolled chat UI (ScrollView of bubbles + TextInput composer); same integration story for the SignalClient facade with no new native deps. The plan doc carries a mid-execution amendment note.

## 2026-06-16 — Store layer migrated to expo-sqlite, verified on both platforms

- iOS simulator (iPhone 17 Pro, iOS 26.4): pass (SignalClient screen 4 of 4 scripted steps green over expo-sqlite + SQLCipher)
- Android emulator (Pixel 10 AVD): pass (same)
- Migrated the default SQLCipher-backed store from `@op-engineering/op-sqlite` to `expo-sqlite` with the official `useSQLCipher` plugin option. Removed the iOS Podfile `post_install` hook (`SQLCIPHER_CRYPTO_CC` / `NDEBUG`), the `op-sqlite.sqlcipher` block from `package.json`, and the third-party dependency entirely. expo-sqlite's podspec swaps the vendored SQLite amalgamation for SQLCipher's and applies the right flags when `Podfile.properties.json["expo.sqlite.useSQLCipher"] == "true"`.
- Two environment issues hit during smoke and worth recording:
  - `npx expo install expo-sqlite` clobbered the workspace symlink for `expo-libsignal` again (same pattern as the `@types/jest` install earlier this session — `file:..` resolution under bun's workspace install). Repaired with a manual symlink to the repo root. Memory note (`example-workspace-install.md`) covers this.
  - `expo-modules-jsi`'s `build-xcframework.sh` uses `find ... -exec sed -i '' '<script>' {} +` to strip Swift `_ConstraintThatIsNotPartOfTheAPIOfThisLibrary` extensions from `.swiftinterface` files. Under the CocoaPods script-phase shell, the empty backup-extension arg `''` after `-i` was being coalesced away, so sed ended up reading the script as a filename and emitting `sed: can't read /^extension __ObjC\./...`. Patched the line locally to use `sed -i.tmp ... && find ... -name '*.swiftinterface.tmp' -delete`. The patch lives in `example/node_modules/expo-modules-jsi/apple/scripts/build-xcframework.sh` and will get nuked on the next install — worth upstreaming or wrapping in `patch-package`.
  - On the first build, `Podfile.properties.json` did not get the `expo.sqlite.useSQLCipher: "true"` key the plugin should write. The plugin runs at `expo prebuild`, but the iOS folder was already prebuilt from earlier work, so the plugin didn't apply. Fixed by editing the file directly and re-running `pod install` (which re-runs the podspec, which vendors the SQLCipher source). Cleaner future fix: `npx expo prebuild --clean` after adding the plugin.

## 2026-06-16 — SignalClient facade demo verified on both platforms

- iOS simulator (iPhone 17 Pro, iOS 26.4): pass (4 of 4 scripted steps green; interactive 1:1 + sealed + group sends manually exercised)
- Android emulator (Pixel 10 AVD): pass (4 of 4 scripted steps green)
- Demo: `Client` tab opens three `SignalClient` instances (alice / bob / carol), each over its own SQLCipher store (`alice.client.db` / `bob.client.db` / `carol.client.db`). Mount sequence: identities → six pairwise sessions → trust-root + server cert + three sender certs → every persona welcomes the other two → alice posts the first group message. Composer per panel + persona-targeted sends with a sealed toggle remain interactive after smoke.
- iOS prebuild path note: `npx expo run:ios` failed during this session inside an `expo-modules-jsi` pod build phase (`sed` script missing its `-e` flag — BSD sed treated the script as a filename and emitted "No such file or directory"). Workaround: start Metro directly (`npx expo start --port 8082 --dev-client`), let the already-installed dev client connect to it. Android Gradle path was unaffected — `npx expo run:android` builds and installs cleanly.
- Three example-side bugs surfaced and fixed during smoke:
  - Initial chat row format (`> bob: hi bob`) was visually ambiguous — could read as "from bob: hi bob". Switched to `↑ you → bob: ...` / `↓ alice → you: ...` so direction + sender + recipient are all explicit.
  - Only alice was calling `group.welcome` — bob and carol therefore had no sender key for the distribution and hit `SenderKeyNotFoundError` on their own group sends. Fix: scripted mount now has every persona welcome the other two.
  - `ship()` was fire-and-forget, so welcome SKDMs raced alice's first group encrypt; bob/carol decrypted the group message before their store knew alice's sender key. Fix: ship is now async-awaited inside the scripted flow.
- One environment issue noted: a subagent's `bun install` (to add `@types/jest`) clobbered the workspace link to `expo-libsignal` inside `example/node_modules`, breaking the expo config plugin. Repaired by replacing the broken dir with a real symlink to the repo root. Worth pinning the workspace install pattern — `file:..` recursion was the root cause and a `bun install --force` from inside `example/` reproduces it.

## 2026-06-16 — Phase 4b: Sealed Sender verified on both platforms

- iOS simulator (iPhone 17 Pro, iOS 26.4): pass (9 of 9 steps)
- Android emulator (Pixel 10 AVD): pass (9 of 9 steps)
- End-to-end: mint trust-root identity → server cert under trust root → sender cert issued to alice → alice/bob 1:1 session over PreKeyBundle → alice sealed-encrypt "hello sealed" → bob sealed-decrypt → plaintext recovered, recovered sender UUID matches the UUID baked into the cert
- Sealed envelope size: 2123 bytes (same on both platforms, reasonable for a one-shot PreKey-wrapped payload + cert chain)
- Two example-side bugs surfaced and fixed during smoke:
  - `crypto.randomUUID()` is not exposed on the React Native global; the screen now inlines a tiny `randomUuidV4()` helper.
  - The hard-coded `BOB_LOCAL_UUID = 'bob00000-...'` contained non-hex `o` characters. Java's `UUID.fromString` (called inside `SealedSessionCipher`'s ctor) rejected it with `For input string: "bob00000" under radix 16`. Foundation's `UUID(uuidString:)` is more lenient and accepted the string on iOS, masking the bug. Fixed by switching to `b0b00000-...`.
- No library-side changes were needed for smoke — Rounds 1-3 (TS + iOS + Android) all worked first try once the screen was authored correctly.

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
