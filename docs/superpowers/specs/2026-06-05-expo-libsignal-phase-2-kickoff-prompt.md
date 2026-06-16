# expo-libsignal Phase 2 Kickoff Prompt

Copy the content between the `---` markers below into a new session as the opening user prompt.

---

I'm continuing work on `expo-libsignal`, a public AGPL-3.0 Expo Module wrapping `signalapp/libsignal`. Phase 1 (Foundation) is shipped and tagged `foundation-complete` at `/Users/spence/dev/expo-libsignal/`. Time to design and execute Phase 2: **1:1 messaging** — PreKey bundles, X3DH session setup, Double Ratchet encrypt/decrypt.

## Where things stand

**Repos & branches:**
- Library: `/Users/spence/dev/expo-libsignal/` (its own git repo, branch `main`, tag `foundation-complete`)
- Parent project (consumer): `/Users/spence/dev/cvc-social/` (will integrate the library once Phase 2 + Phase 3 are done — not in scope here)
- Spec & plans for this work live under `/Users/spence/dev/cvc-social/docs/superpowers/`

**Read these first** (they have the full story):
- `/Users/spence/dev/cvc-social/docs/superpowers/specs/2026-06-05-expo-libsignal-design.md` — the original design spec (some assumptions in it turned out wrong; corrections in the Foundation plan)
- `/Users/spence/dev/cvc-social/docs/superpowers/plans/2026-06-05-expo-libsignal-foundation.md` — the Foundation implementation plan (what was supposed to ship in Phase 1)
- `/Users/spence/dev/expo-libsignal/README.md` — current public-facing usage doc

**Foundation is shipped:**
- `IdentityKeyPair.generate()` / `.deserialize()` / `.serialize()` / `.publicKey()` / `.privateKey()` works end-to-end on iOS + Android via JS → JSI → Swift/Kotlin → libsignal Rust → real X25519 keypair.
- Typed `LibsignalError` hierarchy (`LibsignalError`, `UntrustedIdentityError`, `InvalidMessageError`, `SessionNotFoundError`, `InvalidKeyError`, `DuplicateMessageError`) at `src/errors.ts`.
- Expo config plugin at `plugin/src/index.ts` handles all native plumbing automatically (see "Things we learned the hard way" below).
- CI workflow at `.github/workflows/ci.yml` runs lint + typecheck + tests + iOS/Android example builds.

## Things we learned the hard way during Phase 1

These are NOT in the original design spec — they're real upstream/integration gotchas the spec speculated about wrongly or missed entirely. **Honor them; do not "fix" them by reverting:**

1. **LibSignalClient is NOT on the CocoaPods trunk.** Consumers reference it via `:podspec => 'https://raw.githubusercontent.com/signalapp/libsignal/v0.94.4/LibSignalClient.podspec'`. Our config plugin injects this.

2. **The published LibSignalClient.podspec ships `LIBSIGNAL_FFI_PREBUILD_CHECKSUM=''`.** The download script uses `set -u` and fails immediately without it. Our plugin sets `ENV['LIBSIGNAL_FFI_PREBUILD_CHECKSUM']` at the top of the Podfile.

3. **LibSignalClient's `OTHER_LDFLAGS` and FFI build variables are scoped to the LibSignalClient pod target only.** When the consumer's app links, `$(LIBSIGNAL_FFI_LIB_TO_LINK)` expands to empty and the link fails. **Our own `ExpoLibsignal.podspec` declares `user_target_xcconfig` with these variables** to propagate them to dependents.

4. **`$(PROJECT_TEMP_DIR)` resolves per-target.** The FFI is extracted under the Pods xcodeproj's temp dir (`$(OBJROOT)/Pods.build/libsignal_ffi`), NOT the consumer's `$(PROJECT_TEMP_DIR)`. We hardcode `$(OBJROOT)/Pods.build/libsignal_ffi` in the podspec.

5. **`org.signal:libsignal-android` is not on Maven Central** for current versions — it's at `https://build-artifacts.signal.org/libraries/maven/`. Our plugin injects this URL into the consumer's root `build.gradle` `allprojects.repositories` block.

6. **libsignal-android uses Java 8+ APIs that require core library desugaring on minSdk 24.** Our plugin injects `compileOptions { coreLibraryDesugaringEnabled true; ... }` and `coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2.0.4'` into the consumer's `app/build.gradle`.

7. **Kotlin Expo Modules' `Class()` registration REQUIRES a `Constructor { }` block** — even for SharedObjects you don't intend to construct from JS. Swift is lenient about this. We provide throwing constructors with messages directing consumers to the factory functions.

8. **Expo Modules' `AsyncFunction` inside a `Class()` block becomes an instance method (auto-bound to the instance), NOT a static.** Factory functions for SharedObject creation must live at MODULE level. Instance methods declared `Function("foo") { (ref: MyRef) -> ... }` are auto-bound — JS calls them as `ref.foo()`, not `NativeModule.MyRef.foo(ref)`.

9. **The example app uses `expo-libsignal: file:..` as its dependency.** On a fresh checkout, bun's `file:` resolution creates a real symlink to the repo root. The plugin must be built (`tsc -p plugin`) before the example's `expo prebuild` runs, because `app.plugin.js` does `require('./plugin/build')`.

10. **Expo SDK 56 / RN 0.85 / Bun 1.3 / Xcode 26.3 / Android NDK 27 / Java 17 / libsignal 0.94.4** is the verified stack. (The spec said SDK 55+, that's still the floor for consumers, but our example uses 56.)

## Phase 2 scope

**Goal:** End state is that Alice and Bob (two `IdentityKeyPair` instances) can establish a session via X3DH and exchange Double-Ratchet-encrypted messages, with the full flow verified in the example app.

**Library surface to add** (mirrors libsignal's API):

- `PreKeyRecord` — `static new(id, ecKeyPair)`, `id()`, `publicKey()`, `serialize()`, `deserialize()`
- `SignedPreKeyRecord` — `static new(id, timestamp, ecKeyPair, signature)`, `id()`, `timestamp()`, `signature()`, `serialize()`, `deserialize()`
- `KyberPreKeyRecord` — same shape (post-quantum)
- `PreKeyBundle` — constructor takes the whole bundle of public values; what gets published to the server
- `ProtocolAddress` — `(name: string, deviceId: number)` tuple
- `SessionRecord` (opaque, but needs deserialize/serialize for storage)
- `PreKeySignalMessage` and `SignalMessage` — discriminated union returned by encrypt
- `SessionBuilder` — `processPreKeyBundle(bundle)` — runs X3DH, establishes a session in the SessionStore
- `SessionCipher` — `encrypt(plaintext) → CiphertextMessage`, `decryptPreKeySignal(msg) → plaintext`, `decryptSignal(msg) → plaintext`
- Store **interfaces** (just the contracts; the SQLCipher implementations are Phase 3): `SessionStore`, `PreKeyStore`, `SignedPreKeyStore`, `KyberPreKeyStore`, `IdentityKeyStore`

**Out of scope for Phase 2 (deferred to later phases):**
- Default SQLCipher-backed store implementations (Phase 3)
- Sender Keys / group messaging (Phase 4)
- Sealed Sender (Phase 4)
- Provisioning protocol primitives (Phase 4)
- `SignalClient` facade (Phase 5)
- Example app full playground (Phase 5)

**For testing in Phase 2** — write minimal in-memory store implementations in the example app (not in the library) so we can prove session establishment + encrypt/decrypt without needing SQLCipher. The library only exposes the interfaces; consumers provide implementations.

## How to start

Use the `superpowers:brainstorming` skill to design Phase 2. This is creative work that benefits from up-front design — don't skip it.

When brainstorming:
- Confirm the API surface above matches libsignal's actual 0.94.4 Swift + Kotlin API by reading the headers / jar. Don't assume the spec is accurate. (Foundation taught us this lesson — the spec assumed `Curve.generateKeyPair()` existed in libsignal-android; it didn't. The whole construction chain was simpler than the spec said.)
- The naming convention for module-level factories that return SharedObjects has been `generateIdentityKeyPair`, `deserializeIdentityKeyPair`. Follow that pattern — module-level `generatePreKey`, `generateSignedPreKey`, etc. — unless you find a reason to deviate.
- Instance methods on SharedObjects use the auto-bind pattern: `Function("foo") { (ref: T) -> ... }` and JS calls `ref.foo()`. Stick to it.
- For the example app integration test, two-pane "Alice & Bob" with in-memory stores in JS is the right shape for now. The full playground (multi-tab, three personas, sender keys, sealed sender) is Phase 5.

Then use `superpowers:writing-plans` to produce a detailed implementation plan, and execute via `superpowers:subagent-driven-development`. The Foundation cycle is your template — Phase 2 should be smaller because the build/CI/plugin scaffolding is all in place.

## Expected size

Foundation was ~25 tasks and discovered ~10 upstream gotchas the spec didn't anticipate. Phase 2 should be smaller — call it ~20 tasks — because:
- The Swift/Kotlin/TS file layout is established
- The plugin handles all the native plumbing
- The error hierarchy is reusable
- The binding pattern is proven

But you WILL hit new API drift in libsignal 0.94.4 vs whatever the spec assumed. Read the actual headers/jars before writing code; don't trust the spec for class names or method signatures.

## A note on tone

We work in "wet claude" voice (file at `/Users/spence/.claude/skills/wet/SKILL.md` if it's installed) — direct, comfortable with uncertainty, no corporate hedging. The previous session committed in this style and the existing commit messages reflect it. Match.

Start by reading the three doc files above, then invoking `superpowers:brainstorming` to walk me through the Phase 2 design.
