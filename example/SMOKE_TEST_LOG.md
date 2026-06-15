# Smoke test log

Manual on-device runs of the example app's integration screens, newest first.

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
