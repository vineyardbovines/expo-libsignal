# expo-libsignal Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `expo-libsignal` library in a new public AGPL-3.0 repo and prove the full native binding chain works by getting `IdentityKeyPair.generate()` to return a real X25519 keypair on iOS + Android.

**Architecture:** Expo Module wrapping `signalapp/libsignal` (Rust). iOS via `LibSignalClient` CocoaPod 0.94.4 (script phase downloads prebuilt Rust FFI — no Rust toolchain in our CI). Android via `org.signal:libsignal-android:0.94.4` from Signal's Maven repo. TypeScript surface uses Expo's `SharedObject` JSI pattern.

**Tech Stack:** Expo SDK 55, Expo Modules API, Swift 6, Kotlin, TypeScript, Jest, Biome, GitHub Actions, changesets.

**Working directory:** All file paths in this plan are relative to `/Users/spence/dev/expo-libsignal/` (the NEW repo we're creating), unless stated otherwise. The plan file itself lives in `/Users/spence/dev/cvc-social/docs/superpowers/plans/`.

**Scope:** Foundation only — Phase 1 of 5. End state: a minimal Expo Module that exposes `IdentityKeyPair` with `generate()`, `serialize()`, `publicKey()`, `privateKey()` methods, with passing tests on both platforms and a CI workflow. Phases 2–5 (1:1 messaging, stores, groups/sealed-sender/provisioning, facade+plugin+example+release) are separate plans written after this one ships.

---

## File Structure

After this plan completes, the repo looks like:

```
/Users/spence/dev/expo-libsignal/
├── .github/workflows/
│   └── ci.yml                                # typecheck + lint + native tests
├── .gitignore
├── .npmignore
├── LICENSE                                   # AGPL-3.0 full text
├── README.md
├── SECURITY.md
├── biome.json
├── expo-module.config.json
├── package.json
├── tsconfig.json
├── android/
│   ├── build.gradle
│   ├── proguard-rules.pro
│   └── src/main/java/expo/modules/libsignal/
│       ├── ExpoLibsignalModule.kt           # module definition
│       ├── IdentityKeyPair.kt               # SharedObject wrapper
│       └── LibsignalErrors.kt               # error mapping
├── ios/
│   ├── ExpoLibsignal.podspec
│   ├── ExpoLibsignalModule.swift            # module definition
│   ├── IdentityKeyPair.swift                # SharedObject wrapper
│   └── LibsignalErrors.swift                # error mapping
└── src/
    ├── ExpoLibsignal.types.ts                # shared types
    ├── ExpoLibsignalModule.ts                # generated module accessor
    ├── core/
    │   └── IdentityKeyPair.ts                # public TS API
    ├── errors.ts                             # JS error class hierarchy
    ├── index.ts                              # main entry
    └── __tests__/
        └── IdentityKeyPair.test.ts
```

---

## Task 1: Verify integration prerequisites

**Files:**
- None yet (read-only verification)

- [ ] **Step 1: Check Node + Bun versions**

Run:
```bash
node --version    # expect v22.x or higher
bun --version     # expect 1.x
```
Expected: both present. If not, install via mise/asdf.

- [ ] **Step 2: Check Xcode + iOS deployment target**

Run:
```bash
xcodebuild -version          # expect Xcode 16+
xcrun --sdk iphoneos --show-sdk-version    # expect iOS 18.x
```
Expected: Xcode 16+, iOS SDK 18+.

- [ ] **Step 3: Check Android tools**

Run:
```bash
sdkmanager --list_installed 2>&1 | grep "platforms;android-3"
java -version    # expect Java 17 or 21
```
Expected: Android platform 34+, Java 17+.

- [ ] **Step 4: Verify libsignal artifacts are fetchable**

Run (sanity check):
```bash
curl -sI https://central.sonatype.com/artifact/org.signal/libsignal-android/0.86.5 | head -1
curl -sI https://github.com/signalapp/libsignal/releases/download/v0.94.4/libsignal-client-ios-build-v0.94.4.tar.gz.sha256 | head -1
```
Expected: both return `HTTP/2 200`. If either fails, stop and ask the user how to proceed.

---

## Task 2: Create the repo

**Files:**
- Create: `/Users/spence/dev/expo-libsignal/` (directory)

- [ ] **Step 1: Create directory and initialize git**

Run:
```bash
mkdir -p /Users/spence/dev/expo-libsignal
cd /Users/spence/dev/expo-libsignal
git init -b main
```
Expected: empty directory with `.git/` initialized.

- [ ] **Step 2: Create initial README**

Create `README.md`:
```markdown
# expo-libsignal

Expo Module wrapping [signalapp/libsignal](https://github.com/signalapp/libsignal) — the Signal Protocol cryptography library — for React Native and Expo apps.

**Status:** Pre-1.0. API is unstable. Not yet published to npm.

**License:** AGPL-3.0 (inherited from libsignal upstream).

## Supported

- Expo SDK 55+
- React Native new architecture (TurboModules / Fabric)
- iOS 15.0+
- Android API 24+

## Roadmap

| Phase | Status |
|---|---|
| Foundation (identity keys) | in progress |
| 1:1 messaging (X3DH, Double Ratchet) | pending |
| SQLCipher default stores | pending |
| Groups, Sealed Sender, Provisioning | pending |
| Facade API, config plugin, example app, release | pending |
```

- [ ] **Step 3: Create LICENSE file**

Create `LICENSE` with the full text of AGPL-3.0. Fetch it:
```bash
curl -sL https://www.gnu.org/licenses/agpl-3.0.txt -o /Users/spence/dev/expo-libsignal/LICENSE
head -3 /Users/spence/dev/expo-libsignal/LICENSE
```
Expected: file starts with `GNU AFFERO GENERAL PUBLIC LICENSE`.

- [ ] **Step 4: Create .gitignore**

Create `.gitignore`:
```
node_modules/
.expo/
.DS_Store
*.log

# iOS
ios/Pods/
ios/build/
ios/*.xcworkspace
ios/.xcode.env.local

# Android
android/.gradle/
android/build/
android/local.properties

# TypeScript
*.tsbuildinfo
dist/
build/

# Testing
coverage/

# Editor
.vscode/
.idea/

# Env / secrets
.env
.env.local
```

- [ ] **Step 5: Initial commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add -A
git commit -m "chore: initial repo scaffold"
```

---

## Task 3: Scaffold the Expo Module via template

**Files:**
- Created by the template: many

- [ ] **Step 1: Create the Expo Module from the SDK 55 template**

Run from a temporary directory (the template clones into a new subdir, then we move files in):
```bash
cd /tmp
npx --yes create-expo-module@latest tmp-expo-libsignal --no-recursive \
  --description "Expo Module wrapping signalapp/libsignal" \
  --author-name "Spencer Pope" \
  --author-url "https://github.com/vineyardbovines" \
  --repo "https://github.com/vineyardbovines/expo-libsignal" \
  --license "AGPL-3.0"
```
Expected: directory `tmp-expo-libsignal/` created with template files.

- [ ] **Step 2: Move template contents into our repo without overwriting**

```bash
cd /tmp/tmp-expo-libsignal
# Move everything except files we already created
rsync -av --exclude='.git' --exclude='LICENSE' --exclude='README.md' --exclude='.gitignore' ./ /Users/spence/dev/expo-libsignal/
# Clean up
rm -rf /tmp/tmp-expo-libsignal
```

- [ ] **Step 3: Inspect what landed**

```bash
cd /Users/spence/dev/expo-libsignal
ls -la
```
Expected to see: `package.json`, `expo-module.config.json`, `tsconfig.json`, `src/`, `ios/`, `android/`, `example/`.

- [ ] **Step 4: Verify the template's example app structure**

```bash
ls /Users/spence/dev/expo-libsignal/example/
```
Expected: an Expo project with `app/`, `package.json`, `app.json`. We will simplify this later.

- [ ] **Step 5: Commit the template**

```bash
cd /Users/spence/dev/expo-libsignal
git add -A
git commit -m "chore: scaffold via create-expo-module template"
```

---

## Task 4: Configure package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Overwrite package.json with our canonical version**

Read the current file first to preserve any template-specific fields, then overwrite:

```json
{
  "name": "expo-libsignal",
  "version": "0.0.1",
  "description": "Expo Module wrapping signalapp/libsignal — Signal Protocol cryptography for React Native.",
  "main": "build/index.js",
  "types": "build/index.d.ts",
  "scripts": {
    "build": "expo-module build",
    "clean": "expo-module clean",
    "lint": "biome check .",
    "format": "biome check --write .",
    "test": "jest",
    "typecheck": "tsc --noEmit",
    "prepare": "expo-module prepare",
    "prepublishOnly": "expo-module prepublishOnly",
    "expo-module": "expo-module",
    "open:ios": "open -a 'Xcode' example/ios",
    "open:android": "open -a 'Android Studio' example/android"
  },
  "keywords": [
    "react-native",
    "expo",
    "signal",
    "libsignal",
    "e2ee",
    "cryptography"
  ],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/vineyardbovines/expo-libsignal.git"
  },
  "bugs": {
    "url": "https://github.com/vineyardbovines/expo-libsignal/issues"
  },
  "author": "Spencer Pope <spencerfpope@gmail.com>",
  "license": "AGPL-3.0",
  "homepage": "https://github.com/vineyardbovines/expo-libsignal#readme",
  "devDependencies": {
    "@biomejs/biome": "^2.0.0",
    "@types/jest": "^29.5.12",
    "@types/react": "~19.2.2",
    "expo-module-scripts": "^4.1.0",
    "expo-modules-core": "~2.4.0",
    "jest": "^29.7.0",
    "jest-expo": "~55.0.0",
    "ts-jest": "^29.2.5",
    "typescript": "~6.0.3"
  },
  "peerDependencies": {
    "expo": ">=55.0.0",
    "expo-secure-store": "*",
    "react": "*",
    "react-native": "*"
  },
  "files": [
    "build",
    "ios",
    "android",
    "src",
    "expo-module.config.json",
    "LICENSE",
    "README.md"
  ]
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd /Users/spence/dev/expo-libsignal
bun install
```
Expected: no errors. `node_modules/` populated.

- [ ] **Step 3: Verify typecheck baseline passes**

```bash
bun run typecheck
```
Expected: PASS (no type errors). If errors come from template-generated files, fix or remove them.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: configure package.json"
```

---

## Task 5: Configure TypeScript

**Files:**
- Create or modify: `tsconfig.json`

- [ ] **Step 1: Write tsconfig.json**

```json
{
  "extends": "expo-module-scripts/tsconfig.base",
  "compilerOptions": {
    "outDir": "./build",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "moduleResolution": "bundler",
    "lib": ["ES2023", "DOM"],
    "target": "ES2022",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["node_modules", "build", "example", "**/*.test.ts"]
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tsconfig.json
git commit -m "chore: tighten tsconfig"
```

---

## Task 6: Configure Biome

**Files:**
- Create: `biome.json`

- [ ] **Step 1: Write biome.json**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignore": ["build/**", "node_modules/**", "example/**", "ios/Pods/**", "android/.gradle/**", "android/build/**"]
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": {
        "useImportType": "error",
        "useExportType": "error"
      },
      "correctness": {
        "noUnusedVariables": "error",
        "noUnusedImports": "error"
      },
      "suspicious": {
        "noExplicitAny": "error"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "all",
      "semicolons": "asNeeded"
    }
  }
}
```

- [ ] **Step 2: Run lint**

```bash
bun run lint
```
Expected: PASS or actionable errors. Fix any errors that appear in `src/`.

- [ ] **Step 3: Commit**

```bash
git add biome.json
git commit -m "chore: add biome config"
```

---

## Task 7: Configure Jest

**Files:**
- Create: `jest.config.js`
- Create: `jest.setup.js`

- [ ] **Step 1: Write jest.config.js**

```javascript
module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'node',
  setupFilesAfterEach: ['<rootDir>/jest.setup.js'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
  moduleNameMapper: {
    '^expo-libsignal$': '<rootDir>/src/index.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
}
```

- [ ] **Step 2: Write jest.setup.js (empty for now)**

```javascript
// Reserved for future test setup (mocks, polyfills).
```

- [ ] **Step 3: Add a smoke test**

Create `src/__tests__/smoke.test.ts`:
```typescript
describe('expo-libsignal package', () => {
  it('loads without crashing', () => {
    expect(true).toBe(true)
  })
})
```

- [ ] **Step 4: Run tests**

```bash
bun test
```
Expected: 1 passing test.

- [ ] **Step 5: Commit**

```bash
git add jest.config.js jest.setup.js src/__tests__/smoke.test.ts
git commit -m "chore: configure jest"
```

---

## Task 8: Add libsignal as a native dependency on iOS

**Files:**
- Modify: `ios/ExpoLibsignal.podspec`

- [ ] **Step 1: Read the current podspec**

The template generates an `ExpoLibsignal.podspec`. Read its current contents.

- [ ] **Step 2: Add LibSignalClient dependency**

Edit `ios/ExpoLibsignal.podspec` to add the dependency line. The full podspec should look like:

```ruby
require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ExpoLibsignal'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.platforms = {
    :ios => '15.0',
    :tvos => '15.0'
  }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/vineyardbovines/expo-libsignal' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'LibSignalClient', '0.94.4'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
```

- [ ] **Step 3: Test that pod install works in the example app**

```bash
cd /Users/spence/dev/expo-libsignal/example
bunx expo prebuild --clean --platform ios
cd ios
pod install
```
Expected: pod install completes successfully. `LibSignalClient` appears in `ios/Pods/`. Script phase downloads the prebuilt `libsignal_ffi.a` archive — this may take ~30-60 seconds the first time.

Verify the FFI archive landed:
```bash
ls -la /Users/spence/dev/expo-libsignal/example/ios/Pods/LibSignalClient/swift/Sources/SignalFfi/ 2>&1 | head -5
```
Expected: at least one `.h` file present.

**If pod install fails** with a network or checksum error, run with verbose output to diagnose:
```bash
pod install --verbose 2>&1 | tail -50
```

- [ ] **Step 4: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add ios/ExpoLibsignal.podspec
git commit -m "feat(ios): add LibSignalClient 0.94.4 as a pod dependency"
```

---

## Task 9: Add libsignal as a native dependency on Android

**Files:**
- Modify: `android/build.gradle`

- [ ] **Step 1: Edit android/build.gradle to add the Signal Maven repo and dependency**

The full `android/build.gradle` should look approximately like:

```gradle
apply plugin: 'com.android.library'
apply plugin: 'kotlin-android'

group = 'expo.modules.libsignal'
version = '0.0.1'

def expoModulesCorePlugin = new File(project(":expo-modules-core").projectDir.absolutePath, "ExpoModulesCorePlugin.gradle")
apply from: expoModulesCorePlugin
applyKotlinExpoModulesCorePlugin()
useCoreDependencies()
useExpoPublishing()

android {
  namespace "expo.modules.libsignal"
  compileSdk 35

  defaultConfig {
    minSdk 24
    targetSdk 35
    consumerProguardFiles 'proguard-rules.pro'
  }

  compileOptions {
    sourceCompatibility JavaVersion.VERSION_17
    targetCompatibility JavaVersion.VERSION_17
  }

  kotlinOptions {
    jvmTarget = '17'
  }

  publishing {
    singleVariant("release") {
      withSourcesJar()
    }
  }
}

repositories {
  maven {
    name = "SignalBuildArtifacts"
    url = uri("https://build-artifacts.signal.org/libraries/maven/")
  }
  mavenCentral()
  google()
}

dependencies {
  implementation 'org.signal:libsignal-android:0.94.4'
  implementation 'org.signal:libsignal-client:0.94.4'
}
```

- [ ] **Step 2: Create proguard rules file**

Create `android/proguard-rules.pro`:
```proguard
# Keep all libsignal classes (used via reflection in some code paths)
-keep class org.signal.libsignal.** { *; }
-keep class org.whispersystems.** { *; }
-keepclassmembers class org.signal.libsignal.protocol.** { *; }
```

- [ ] **Step 3: Test that gradle dependency resolution works**

```bash
cd /Users/spence/dev/expo-libsignal/example
bunx expo prebuild --clean --platform android
cd android
./gradlew :expo-libsignal:dependencies --configuration releaseCompileClasspath 2>&1 | grep "libsignal"
```
Expected: lines mentioning `org.signal:libsignal-android:0.94.4` and `org.signal:libsignal-client:0.94.4`.

**If resolution fails**, the most likely cause is the Signal Maven URL — try:
```bash
curl -sI "https://build-artifacts.signal.org/libraries/maven/org/signal/libsignal-android/0.94.4/libsignal-android-0.94.4.pom" | head -1
```
Expected: `HTTP/2 200`. If 404, fall back to Maven Central version 0.86.5 (older but officially mirrored).

- [ ] **Step 4: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add android/build.gradle android/proguard-rules.pro
git commit -m "feat(android): add org.signal:libsignal-android 0.94.4 as a dependency"
```

---

## Task 10: Define LibsignalError class hierarchy in TS

**Files:**
- Create: `src/errors.ts`
- Test: `src/__tests__/errors.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/errors.test.ts`:
```typescript
import {
  LibsignalError,
  UntrustedIdentityError,
  InvalidMessageError,
  SessionNotFoundError,
  InvalidKeyError,
  DuplicateMessageError,
  fromNative,
} from '../errors'

describe('LibsignalError hierarchy', () => {
  it('every subclass inherits LibsignalError', () => {
    expect(new UntrustedIdentityError('x')).toBeInstanceOf(LibsignalError)
    expect(new InvalidMessageError('x')).toBeInstanceOf(LibsignalError)
    expect(new SessionNotFoundError('x')).toBeInstanceOf(LibsignalError)
    expect(new InvalidKeyError('x')).toBeInstanceOf(LibsignalError)
    expect(new DuplicateMessageError('x')).toBeInstanceOf(LibsignalError)
  })

  it('fromNative maps known kinds to the right subclass', () => {
    expect(fromNative({ kind: 'UntrustedIdentity', message: 'm' })).toBeInstanceOf(UntrustedIdentityError)
    expect(fromNative({ kind: 'InvalidMessage', message: 'm' })).toBeInstanceOf(InvalidMessageError)
    expect(fromNative({ kind: 'SessionNotFound', message: 'm' })).toBeInstanceOf(SessionNotFoundError)
  })

  it('fromNative falls back to LibsignalError for unknown kinds', () => {
    const err = fromNative({ kind: 'SomeUnknownKind', message: 'm' })
    expect(err).toBeInstanceOf(LibsignalError)
    expect(err.constructor.name).toBe('LibsignalError')
  })

  it('error name property matches class name', () => {
    expect(new UntrustedIdentityError('x').name).toBe('UntrustedIdentityError')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/__tests__/errors.test.ts
```
Expected: FAIL — `Cannot find module '../errors'`.

- [ ] **Step 3: Implement errors.ts**

Create `src/errors.ts`:
```typescript
export class LibsignalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LibsignalError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class UntrustedIdentityError extends LibsignalError {
  constructor(message: string) {
    super(message)
    this.name = 'UntrustedIdentityError'
  }
}

export class InvalidMessageError extends LibsignalError {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidMessageError'
  }
}

export class SessionNotFoundError extends LibsignalError {
  constructor(message: string) {
    super(message)
    this.name = 'SessionNotFoundError'
  }
}

export class InvalidKeyError extends LibsignalError {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidKeyError'
  }
}

export class DuplicateMessageError extends LibsignalError {
  constructor(message: string) {
    super(message)
    this.name = 'DuplicateMessageError'
  }
}

export interface NativeErrorPayload {
  kind: string
  message: string
}

const ERROR_REGISTRY: Record<string, new (msg: string) => LibsignalError> = {
  UntrustedIdentity: UntrustedIdentityError,
  InvalidMessage: InvalidMessageError,
  SessionNotFound: SessionNotFoundError,
  InvalidKey: InvalidKeyError,
  DuplicateMessage: DuplicateMessageError,
}

export function fromNative(payload: NativeErrorPayload): LibsignalError {
  const Ctor = ERROR_REGISTRY[payload.kind] ?? LibsignalError
  return new Ctor(payload.message)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test src/__tests__/errors.test.ts
```
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts src/__tests__/errors.test.ts
git commit -m "feat(errors): typed error class hierarchy"
```

---

## Task 11: Define IdentityKeyPair in Swift as a SharedObject

**Files:**
- Create: `ios/IdentityKeyPair.swift`
- Create: `ios/LibsignalErrors.swift`

- [ ] **Step 1: Write LibsignalErrors.swift**

Create `ios/LibsignalErrors.swift`:
```swift
import Foundation
import ExpoModulesCore
import LibSignalClient

enum LibsignalErrorKind: String {
  case untrustedIdentity = "UntrustedIdentity"
  case invalidMessage = "InvalidMessage"
  case sessionNotFound = "SessionNotFound"
  case invalidKey = "InvalidKey"
  case duplicateMessage = "DuplicateMessage"
  case generic = "Generic"
}

struct LibsignalErrorPayload: Record {
  @Field var kind: String
  @Field var message: String
}

func mapSignalError(_ error: Error) -> LibsignalErrorPayload {
  let payload = LibsignalErrorPayload()
  payload.message = "\(error)"

  if let signalError = error as? SignalError {
    switch signalError {
    case .untrustedIdentity:
      payload.kind = LibsignalErrorKind.untrustedIdentity.rawValue
    case .invalidMessage, .invalidCiphertext:
      payload.kind = LibsignalErrorKind.invalidMessage.rawValue
    case .sessionNotFound:
      payload.kind = LibsignalErrorKind.sessionNotFound.rawValue
    case .invalidKey, .invalidKeyIdentifier:
      payload.kind = LibsignalErrorKind.invalidKey.rawValue
    case .duplicateMessage:
      payload.kind = LibsignalErrorKind.duplicateMessage.rawValue
    default:
      payload.kind = LibsignalErrorKind.generic.rawValue
    }
  } else {
    payload.kind = LibsignalErrorKind.generic.rawValue
  }
  return payload
}
```

- [ ] **Step 2: Write IdentityKeyPair.swift**

Create `ios/IdentityKeyPair.swift`:
```swift
import Foundation
import ExpoModulesCore
import LibSignalClient

final class IdentityKeyPairRef: SharedObject {
  let keyPair: IdentityKeyPair

  init(keyPair: IdentityKeyPair) {
    self.keyPair = keyPair
    super.init()
  }
}

final class PublicIdentityKeyRef: SharedObject {
  let key: IdentityKey

  init(key: IdentityKey) {
    self.key = key
    super.init()
  }
}

final class PrivateKeyRef: SharedObject {
  let key: PrivateKey

  init(key: PrivateKey) {
    self.key = key
    super.init()
  }
}
```

- [ ] **Step 3: Commit (will not compile yet — module wiring comes in Task 13)**

```bash
git add ios/IdentityKeyPair.swift ios/LibsignalErrors.swift
git commit -m "feat(ios): IdentityKeyPair SharedObject wrappers"
```

---

## Task 12: Define IdentityKeyPair in Kotlin as a SharedObject

**Files:**
- Create: `android/src/main/java/expo/modules/libsignal/IdentityKeyPair.kt`
- Create: `android/src/main/java/expo/modules/libsignal/LibsignalErrors.kt`

- [ ] **Step 1: Write LibsignalErrors.kt**

Create `android/src/main/java/expo/modules/libsignal/LibsignalErrors.kt`:
```kotlin
package expo.modules.libsignal

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import org.signal.libsignal.protocol.InvalidKeyException
import org.signal.libsignal.protocol.InvalidKeyIdException
import org.signal.libsignal.protocol.InvalidMessageException
import org.signal.libsignal.protocol.DuplicateMessageException
import org.signal.libsignal.protocol.NoSessionException
import org.signal.libsignal.protocol.UntrustedIdentityException

class LibsignalErrorPayload : Record {
  @Field var kind: String = "Generic"
  @Field var message: String = ""
}

fun mapSignalError(error: Throwable): LibsignalErrorPayload {
  val payload = LibsignalErrorPayload()
  payload.message = error.message ?: error.javaClass.simpleName
  payload.kind = when (error) {
    is UntrustedIdentityException -> "UntrustedIdentity"
    is InvalidMessageException -> "InvalidMessage"
    is NoSessionException -> "SessionNotFound"
    is InvalidKeyException, is InvalidKeyIdException -> "InvalidKey"
    is DuplicateMessageException -> "DuplicateMessage"
    else -> "Generic"
  }
  return payload
}
```

- [ ] **Step 2: Write IdentityKeyPair.kt**

Create `android/src/main/java/expo/modules/libsignal/IdentityKeyPair.kt`:
```kotlin
package expo.modules.libsignal

import expo.modules.kotlin.sharedobjects.SharedObject
import org.signal.libsignal.protocol.IdentityKey
import org.signal.libsignal.protocol.IdentityKeyPair as SignalIdentityKeyPair
import org.signal.libsignal.protocol.ecc.ECPrivateKey

class IdentityKeyPairRef(val keyPair: SignalIdentityKeyPair) : SharedObject()

class PublicIdentityKeyRef(val key: IdentityKey) : SharedObject()

class PrivateKeyRef(val key: ECPrivateKey) : SharedObject()
```

- [ ] **Step 3: Commit**

```bash
git add android/src/main/java/expo/modules/libsignal/IdentityKeyPair.kt \
  android/src/main/java/expo/modules/libsignal/LibsignalErrors.kt
git commit -m "feat(android): IdentityKeyPair SharedObject wrappers"
```

---

## Task 13: Wire IdentityKeyPair into the iOS module definition

**Files:**
- Modify: `ios/ExpoLibsignalModule.swift`

- [ ] **Step 1: Read the template's module file to understand its current shape**

Read `ios/ExpoLibsignalModule.swift`. It'll have a `definition()` block.

- [ ] **Step 2: Replace ExpoLibsignalModule.swift with our definition**

```swift
import Foundation
import ExpoModulesCore
import LibSignalClient

public final class ExpoLibsignalModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoLibsignal")

    Class(IdentityKeyPairRef.self) {
      AsyncFunction("generate") { () -> IdentityKeyPairRef in
        let keyPair = IdentityKeyPair.generate()
        return IdentityKeyPairRef(keyPair: keyPair)
      }

      AsyncFunction("deserialize") { (bytes: Data) -> IdentityKeyPairRef in
        do {
          let kp = try IdentityKeyPair(bytes: Array(bytes))
          return IdentityKeyPairRef(keyPair: kp)
        } catch {
          throw Exception(name: "LibsignalError", description: "\(error)")
        }
      }

      Function("serialize") { (ref: IdentityKeyPairRef) -> Data in
        return Data(ref.keyPair.serialize())
      }

      Function("publicKey") { (ref: IdentityKeyPairRef) -> PublicIdentityKeyRef in
        return PublicIdentityKeyRef(key: ref.keyPair.identityKey)
      }

      Function("privateKey") { (ref: IdentityKeyPairRef) -> PrivateKeyRef in
        return PrivateKeyRef(key: ref.keyPair.privateKey)
      }
    }

    Class(PublicIdentityKeyRef.self) {
      Function("serialize") { (ref: PublicIdentityKeyRef) -> Data in
        return Data(ref.key.serialize())
      }
    }

    Class(PrivateKeyRef.self) {
      Function("serialize") { (ref: PrivateKeyRef) -> Data in
        return Data(ref.key.serialize())
      }
    }
  }
}
```

- [ ] **Step 3: Verify it compiles via the example app**

```bash
cd /Users/spence/dev/expo-libsignal/example
bunx expo prebuild --clean --platform ios
cd ios
pod install
xcodebuild -workspace expolibsignalexample.xcworkspace \
  -scheme expolibsignalexample \
  -configuration Debug \
  -destination "generic/platform=iOS Simulator" \
  -derivedDataPath ./build \
  build 2>&1 | tail -30
```
Expected: `BUILD SUCCEEDED`. If errors, read them carefully — most likely cause is API surface drift in LibSignalClient (we pinned 0.94.4 but the `IdentityKeyPair` initializer signature may differ slightly).

- [ ] **Step 4: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add ios/ExpoLibsignalModule.swift
git commit -m "feat(ios): wire IdentityKeyPair into module definition"
```

---

## Task 14: Wire IdentityKeyPair into the Android module definition

**Files:**
- Modify: `android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt`

- [ ] **Step 1: Replace ExpoLibsignalModule.kt with our definition**

```kotlin
package expo.modules.libsignal

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.signal.libsignal.protocol.IdentityKey
import org.signal.libsignal.protocol.IdentityKeyPair as SignalIdentityKeyPair
import org.signal.libsignal.protocol.ecc.Curve

class ExpoLibsignalModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoLibsignal")

    Class(IdentityKeyPairRef::class) {
      AsyncFunction("generate") Coroutine { ->
        val privateKey = Curve.generateKeyPair().privateKey
        val publicKey = privateKey.publicKey()
        val keyPair = SignalIdentityKeyPair(IdentityKey(publicKey), privateKey)
        IdentityKeyPairRef(keyPair)
      }

      AsyncFunction("deserialize") Coroutine { bytes: ByteArray ->
        try {
          IdentityKeyPairRef(SignalIdentityKeyPair(bytes))
        } catch (e: Throwable) {
          throw RuntimeException(mapSignalError(e).message)
        }
      }

      Function("serialize") { ref: IdentityKeyPairRef ->
        ref.keyPair.serialize()
      }

      Function("publicKey") { ref: IdentityKeyPairRef ->
        PublicIdentityKeyRef(ref.keyPair.publicKey)
      }

      Function("privateKey") { ref: IdentityKeyPairRef ->
        PrivateKeyRef(ref.keyPair.privateKey)
      }
    }

    Class(PublicIdentityKeyRef::class) {
      Function("serialize") { ref: PublicIdentityKeyRef ->
        ref.key.serialize()
      }
    }

    Class(PrivateKeyRef::class) {
      Function("serialize") { ref: PrivateKeyRef ->
        ref.key.serialize()
      }
    }
  }
}
```

- [ ] **Step 2: Verify it compiles via the example app**

```bash
cd /Users/spence/dev/expo-libsignal/example
bunx expo prebuild --clean --platform android
cd android
./gradlew :expo-libsignal:assembleRelease 2>&1 | tail -30
```
Expected: `BUILD SUCCESSFUL`. If errors, most likely cause is API drift in libsignal-android — check `org.signal.libsignal.protocol.IdentityKeyPair` constructor signatures via:
```bash
./gradlew :expo-libsignal:dependencies | grep libsignal
```

- [ ] **Step 3: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add android/src/main/java/expo/modules/libsignal/ExpoLibsignalModule.kt
git commit -m "feat(android): wire IdentityKeyPair into module definition"
```

---

## Task 15: Write the TypeScript surface for IdentityKeyPair

**Files:**
- Create: `src/core/IdentityKeyPair.ts`
- Create: `src/ExpoLibsignalModule.ts`
- Create: `src/index.ts`

- [ ] **Step 1: Write the native module accessor**

Create `src/ExpoLibsignalModule.ts`:
```typescript
import { requireNativeModule } from 'expo'

// Internal — consumers should not import this directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const NativeModule: any = requireNativeModule('ExpoLibsignal')
```

(The `any` here is intentional and isolated — every public TS function below provides proper types.)

- [ ] **Step 2: Write IdentityKeyPair.ts**

Create `src/core/IdentityKeyPair.ts`:
```typescript
import { NativeModule } from '../ExpoLibsignalModule'

// Native SharedObject refs — opaque to consumers.
type IdentityKeyPairRef = object
type PublicIdentityKeyRef = object
type PrivateKeyRef = object

export class IdentityKey {
  private readonly ref: PublicIdentityKeyRef
  constructor(ref: PublicIdentityKeyRef) {
    this.ref = ref
  }
  serialize(): Uint8Array {
    return NativeModule.serialize.call(this.ref)
  }
}

export class PrivateKey {
  private readonly ref: PrivateKeyRef
  constructor(ref: PrivateKeyRef) {
    this.ref = ref
  }
  serialize(): Uint8Array {
    return NativeModule.serialize.call(this.ref)
  }
}

export class IdentityKeyPair {
  private readonly ref: IdentityKeyPairRef

  private constructor(ref: IdentityKeyPairRef) {
    this.ref = ref
  }

  static async generate(): Promise<IdentityKeyPair> {
    const ref = await NativeModule.IdentityKeyPair.generate()
    return new IdentityKeyPair(ref)
  }

  static async deserialize(bytes: Uint8Array): Promise<IdentityKeyPair> {
    const ref = await NativeModule.IdentityKeyPair.deserialize(bytes)
    return new IdentityKeyPair(ref)
  }

  serialize(): Uint8Array {
    return NativeModule.IdentityKeyPair.serialize(this.ref)
  }

  publicKey(): IdentityKey {
    return new IdentityKey(NativeModule.IdentityKeyPair.publicKey(this.ref))
  }

  privateKey(): PrivateKey {
    return new PrivateKey(NativeModule.IdentityKeyPair.privateKey(this.ref))
  }
}
```

- [ ] **Step 3: Write the package entry point**

Create `src/index.ts`:
```typescript
export { IdentityKey, IdentityKeyPair, PrivateKey } from './core/IdentityKeyPair'
export * from './errors'
```

- [ ] **Step 4: Run typecheck**

```bash
cd /Users/spence/dev/expo-libsignal
bun run typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/IdentityKeyPair.ts src/ExpoLibsignalModule.ts src/index.ts
git commit -m "feat(ts): IdentityKeyPair public API surface"
```

---

## Task 16: Write integration test for IdentityKeyPair via the example app

**Files:**
- Modify: `example/app/(tabs)/index.tsx` (or wherever the template put the entry screen)
- Create: `example/app/__tests__/IdentityKeyPair.e2e.tsx` (optional — for now, manual)

The Jest tests we wrote in Task 10 (errors.ts) ran without a native module because they're pure TS. To test the actual native binding, we need to run code in a real RN runtime. For Foundation, this means a manual smoke test in the example app.

- [ ] **Step 1: Update the example app's main screen**

Find the example app's root screen. It may be at `example/app/index.tsx`, `example/App.tsx`, or `example/app/(tabs)/index.tsx` depending on what `create-expo-module` generated. Replace its contents with:

```typescript
import { useEffect, useState } from 'react'
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native'
import { IdentityKeyPair } from 'expo-libsignal'

export default function Index() {
  const [status, setStatus] = useState<string>('idle')
  const [keyPairHex, setKeyPairHex] = useState<string>('')
  const [publicKeyHex, setPublicKeyHex] = useState<string>('')

  const hex = (bytes: Uint8Array) =>
    Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')

  async function runSmokeTest() {
    try {
      setStatus('generating...')
      const kp = await IdentityKeyPair.generate()
      const serialized = kp.serialize()
      const pub = kp.publicKey().serialize()
      setKeyPairHex(hex(serialized))
      setPublicKeyHex(hex(pub))
      setStatus('ok')

      // Round-trip test
      const restored = await IdentityKeyPair.deserialize(serialized)
      const restoredPub = restored.publicKey().serialize()
      if (hex(restoredPub) !== hex(pub)) {
        setStatus('FAIL: round-trip mismatch')
      } else {
        setStatus('ok (round-trip verified)')
      }
    } catch (e) {
      setStatus(`error: ${String(e)}`)
    }
  }

  useEffect(() => {
    runSmokeTest()
  }, [])

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>expo-libsignal smoke test</Text>
      <Text style={styles.status}>Status: {status}</Text>
      <Button title="Re-run" onPress={runSmokeTest} />
      <Text style={styles.label}>Serialized key pair (hex):</Text>
      <Text style={styles.hex}>{keyPairHex || '—'}</Text>
      <Text style={styles.label}>Public key (hex):</Text>
      <Text style={styles.hex}>{publicKeyHex || '—'}</Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 18, fontWeight: '600' },
  status: { fontSize: 14, fontFamily: 'Courier' },
  label: { fontSize: 12, fontWeight: '600', marginTop: 8 },
  hex: { fontSize: 11, fontFamily: 'Courier', flexWrap: 'wrap' },
})
```

- [ ] **Step 2: Build and run on iOS simulator**

```bash
cd /Users/spence/dev/expo-libsignal/example
bunx expo run:ios
```
Expected: app launches, screen shows "Status: ok (round-trip verified)" with two hex strings.

The serialized key pair should be 64 bytes (128 hex chars): 32-byte public key + 32-byte private key.

- [ ] **Step 3: Build and run on Android emulator**

```bash
bunx expo run:android
```
Expected: same result on Android.

- [ ] **Step 4: Save a "manual test passed" marker**

Create `example/SMOKE_TEST_LOG.md`:
```markdown
# Smoke test log

## 2026-06-XX — IdentityKeyPair.generate()
- iOS simulator: ok (round-trip verified)
- Android emulator: ok (round-trip verified)
- Serialized length: 64 bytes
- Public key length: 32 bytes
```

(Date should be the actual date you ran the test. Future automated tests will replace this manual log.)

- [ ] **Step 5: Commit**

```bash
cd /Users/spence/dev/expo-libsignal
git add example/ -A
git commit -m "test: example app smoke test for IdentityKeyPair"
```

---

## Task 17: CI workflow — typecheck + lint + unit tests

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the CI workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint-and-typecheck:
    name: Lint + Typecheck + Unit Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.x
      - run: bun install --frozen-lockfile
      - run: bun run lint
      - run: bun run typecheck
      - run: bun test

  build-ios-example:
    name: Build iOS example
    runs-on: macos-14
    needs: lint-and-typecheck
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.x
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: bun install --frozen-lockfile
      - run: cd example && bunx expo prebuild --clean --platform ios
      - run: |
          cd example/ios
          pod install
      - run: |
          cd example/ios
          xcodebuild -workspace expolibsignalexample.xcworkspace \
            -scheme expolibsignalexample \
            -configuration Debug \
            -destination "generic/platform=iOS Simulator" \
            -derivedDataPath ./build \
            build

  build-android-example:
    name: Build Android example
    runs-on: ubuntu-latest
    needs: lint-and-typecheck
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'
      - run: bun install --frozen-lockfile
      - run: cd example && bunx expo prebuild --clean --platform android
      - run: cd example/android && ./gradlew assembleDebug
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: typecheck, lint, unit tests, iOS + Android example builds"
```

(We don't push to a remote yet — that happens once the user creates the GitHub repo.)

---

## Task 18: SECURITY.md and remaining docs

**Files:**
- Create: `SECURITY.md`
- Modify: `README.md`

- [ ] **Step 1: Write SECURITY.md**

```markdown
# Security Policy

`expo-libsignal` is a wrapper around [signalapp/libsignal](https://github.com/signalapp/libsignal). Most cryptographic security questions belong with the upstream project.

## Reporting a vulnerability

For vulnerabilities **in this wrapper** (the binding layer, the TypeScript surface, the SQLCipher store implementation, the config plugin):

- Open a private security advisory on GitHub: `https://github.com/vineyardbovines/expo-libsignal/security/advisories/new`
- Or email `security@<domain>` (replace with the maintainer's email when published).
- Acknowledgement within 72 hours; critical patches within 7 days where feasible.

For vulnerabilities **in libsignal itself** — Rust crypto code, the Signal Protocol specification — please report directly to Signal: https://signal.org/security/

## Coordinated disclosure

We prefer coordinated disclosure. We'll work with you to establish a disclosure timeline that balances user safety against your right to publish your research.

## Supported versions

Only the latest minor version receives security updates while we are pre-1.0.
```

- [ ] **Step 2: Expand README.md with installation + usage**

```markdown
# expo-libsignal

Expo Module wrapping [signalapp/libsignal](https://github.com/signalapp/libsignal) — the Signal Protocol cryptography library — for React Native and Expo apps.

**Status:** Pre-1.0. API is unstable. Not yet published to npm.

**License:** AGPL-3.0 (inherited from libsignal upstream).

## Supported

- Expo SDK 55+
- React Native new architecture (TurboModules / Fabric)
- iOS 15.0+
- Android API 24+

## Installation (when published)

```bash
bun add expo-libsignal
bunx expo prebuild
```

## Usage

```typescript
import { IdentityKeyPair } from 'expo-libsignal'

const kp = await IdentityKeyPair.generate()
const publicKeyBytes = kp.publicKey().serialize()
const serialized = kp.serialize()
const restored = await IdentityKeyPair.deserialize(serialized)
```

## Roadmap

| Phase | Status |
|---|---|
| Foundation (identity keys) | ✅ shipped |
| 1:1 messaging (X3DH, Double Ratchet) | pending |
| SQLCipher default stores | pending |
| Groups, Sealed Sender, Provisioning | pending |
| Facade API, config plugin, example app, release | pending |

## License

AGPL-3.0. See [LICENSE](./LICENSE). If you link this library into a binary you distribute, your binary must also be AGPL-3.0 (or compatible).

## Security

See [SECURITY.md](./SECURITY.md).
```

- [ ] **Step 3: Commit**

```bash
git add SECURITY.md README.md
git commit -m "docs: SECURITY.md and expanded README"
```

---

## Task 19: Self-verification of the full Foundation

- [ ] **Step 1: Confirm directory structure matches the plan**

```bash
cd /Users/spence/dev/expo-libsignal
find . -type f -not -path './node_modules/*' -not -path './.git/*' -not -path './example/node_modules/*' -not -path './example/ios/Pods/*' -not -path './example/android/.gradle/*' -not -path './example/android/build/*' | sort
```
Expected files exist:
- `LICENSE`, `README.md`, `SECURITY.md`, `package.json`, `tsconfig.json`, `biome.json`, `jest.config.js`, `jest.setup.js`, `expo-module.config.json`
- `ios/ExpoLibsignal.podspec`, `ios/ExpoLibsignalModule.swift`, `ios/IdentityKeyPair.swift`, `ios/LibsignalErrors.swift`
- `android/build.gradle`, `android/proguard-rules.pro`, `android/src/main/java/expo/modules/libsignal/*.kt` (three files)
- `src/index.ts`, `src/errors.ts`, `src/ExpoLibsignalModule.ts`, `src/core/IdentityKeyPair.ts`, `src/__tests__/*.test.ts`
- `.github/workflows/ci.yml`
- `example/SMOKE_TEST_LOG.md`

- [ ] **Step 2: Run the full local CI equivalent**

```bash
bun run lint && bun run typecheck && bun test
```
Expected: all three pass.

- [ ] **Step 3: Run the iOS example end-to-end**

```bash
cd example
bunx expo run:ios
```
Expected: app shows "ok (round-trip verified)" with two hex strings of expected lengths.

- [ ] **Step 4: Run the Android example end-to-end**

```bash
bunx expo run:android
```
Expected: same.

- [ ] **Step 5: Final commit with a foundation tag**

```bash
cd /Users/spence/dev/expo-libsignal
git log --oneline | head -20
git tag foundation-complete
echo "Foundation phase complete. Ready for Phase 2 (1:1 messaging)."
```

---

## Out of scope for this plan (covered in later phases)

- PreKeyRecord / SignedPreKeyRecord / KyberPreKeyRecord (Phase 2)
- SessionBuilder / SessionCipher (Phase 2)
- SQLCipher default store implementations (Phase 3)
- Sender keys / group sessions (Phase 4)
- Sealed Sender (Phase 4)
- Provisioning primitives (Phase 4)
- SignalClient facade (Phase 5)
- Expo config plugin (Phase 5)
- Three-persona example playground (Phase 5)
- changesets / release workflow (Phase 5)
- npm publishing (Phase 5)

---

## After this plan ships

Next plan: `2026-06-XX-expo-libsignal-1to1-messaging.md` — covering PreKey records, PreKeyBundle, SessionBuilder, SessionCipher, and proving Alice and Bob can exchange encrypted messages end-to-end.
