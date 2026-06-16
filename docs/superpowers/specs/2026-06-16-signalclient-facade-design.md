# SignalClient Facade — Design

## Context

After Phase 4b shipped Sealed Sender, the library's cryptographic surface is complete: identity, 1:1 (X3DH + Double Ratchet + Kyber), groups (Sender Keys), sealed sender, SQLCipher persistence. What's left is ergonomics: every example screen today rewires its own `SessionBuilder` + `SessionCipher` + `GroupCipher` + store quintuple and hand-dispatches `preKeySignal`/`signal`/sealed envelopes.

The goal of this phase is to build the facade as the example app first — let the API shape itself against real usage — and only lift bits back into `src/` once we know what's natural. The library stays unchanged for this phase.

## Goal

Ship `example/src/client/SignalClient.ts` and a `example/src/screens/SignalClientScreen.tsx` chat demo that exercises 1:1 (with sealed-sender toggle) and groups (alice/bob/carol). Both platforms smoked. Defer the "what to lift into `src/`" decision to a follow-up.

## Architecture

`SignalClient` is a thin stateful wrapper around `SQLCipherProtocolStore` + the existing primitives. One instance per local persona. The facade owns:

- A `SQLCipherProtocolStore` opened from `{ databaseName, keyAlias }`.
- A local `ProtocolAddress` (lifted from `{ name, deviceId }`).
- Optional sealed-sender config (`{ trustRoot, senderCert }`), set once after open.
- Dispatch logic for `receive(envelope)`.

The app owns:

- Cert minting for sealed sender (trust root + server cert + sender certs).
- Transport — `send` returns an envelope, `receive` takes one; the app ships bytes between devices.
- Prekey rotation cadence.
- Group membership tracking.

The library stays unchanged. After the demo ships and we see what felt natural, we revisit which bits to lift.

## API surface

### Boundary types

```ts
type Address = { name: string; deviceId: number }

type PublishedBundle = {
  registrationId: number
  deviceId: number
  identityKey: Uint8Array         // serialized
  signedPreKeyId: number
  signedPreKeyPublic: Uint8Array
  signedPreKeySignature: Uint8Array
  kyberPreKeyId: number
  kyberPreKeyPublic: Uint8Array
  kyberPreKeySignature: Uint8Array
  preKeyId?: number
  preKeyPublic?: Uint8Array
}

type Envelope =
  | { type: 'preKeySignal' | 'signal'; from: Address; bytes: Uint8Array }
  | { type: 'sealed'; bytes: Uint8Array }
  | { type: 'sender-key-distribution'; from: Address; bytes: Uint8Array; distributionId: string }
  | { type: 'group'; from: Address; distributionId: string; bytes: Uint8Array }

type Received =
  | { kind: 'message'; from: Address; plaintext: string; sealed: boolean }
  | { kind: 'group-message'; from: Address; distributionId: string; plaintext: string }
  | { kind: 'group-welcome'; from: Address; distributionId: string }
```

Address is plain object at the boundary. Internally lifted to `ProtocolAddress`. The only place `ProtocolAddress` still surfaces is `identityKey()` callers that compare keys directly.

`PublishedBundle` mirrors the args of `PreKeyBundle.create` — a real app would deserialize this from server JSON and pass it to `startSession`.

`Envelope` and `Received` are discriminated unions. Receiver always calls `receive(envelope)` regardless of `type`, and switches on the returned `Received.kind`.

### SignalClient

```ts
class SignalClient {
  static async open(opts: {
    databaseName: string
    keyAlias: string
    self: Address
  }): Promise<SignalClient>

  async initializeIfNeeded(opts: { registrationId: number }): Promise<void>
  hasIdentity(): Promise<boolean>
  identityKey(): Promise<IdentityKey>

  async publishOneTimePreKey(opts: {
    preKeyId: number
    signedPreKeyId: number
    kyberPreKeyId: number
  }): Promise<PublishedBundle>

  async startSession(remote: Address, bundle: PublishedBundle): Promise<void>

  configureSealedSender(opts: { trustRoot: PublicKey; senderCert: SenderCertificate }): void

  async send(to: Address, plaintext: string, opts?: { sealed?: boolean }): Promise<Envelope>
  async receive(envelope: Envelope): Promise<Received>

  group(distributionId: string): SignalGroupClient

  async close(): Promise<void>
}
```

- `open` creates the store. `initializeIfNeeded` generates a fresh identity if one isn't already on disk; idempotent.
- `publishOneTimePreKey` mints + persists a one-time prekey, signed prekey, kyber prekey, and returns them in `PublishedBundle` shape for the app to ship to its server.
- `startSession` is the inverse: take a `PublishedBundle` (whatever the app got from its server) and call `processPreKeyBundle` internally. After this call, `send(remote, ...)` works.
- `configureSealedSender` must be called before `send(..., { sealed: true })`. Calling sealed-send without config throws `LibsignalError('SealedSender not configured')`.
- `send` returns `{ type, from, bytes }`. The app ships those bytes; the receiver calls `receive` on whatever it got.
- `receive` dispatches by `envelope.type`. Persists rotated session state. Returns the semantic outcome as a tagged `Received`.

### SignalGroupClient

```ts
class SignalGroupClient {
  async welcome(members: Address[]): Promise<Array<{ to: Address; envelope: Envelope }>>
  async send(plaintext: string): Promise<Envelope>
}
```

- `welcome(members)` creates one SKDM, wraps it in each member's 1:1 session, returns one `{to, envelope}` per member. Each envelope has `type: 'sender-key-distribution'`. Caller ships each.
- `send(plaintext)` group-encrypts via the existing `GroupCipher`, returns one `{type: 'group', ..., bytes}` envelope. Caller fans out to every member.

Group `receive` lives on the top-level `SignalClient.receive` — it inspects `envelope.type` and dispatches. There is no `group(distId).receive` to avoid duplicating dispatch.

## Data flow

### 1:1 send/receive

```
alice.send(bob, 'hi')                   → { type: 'preKeySignal' | 'signal', from: alice, bytes }
bob.receive(envelope)                   → { kind: 'message', from: alice, plaintext: 'hi', sealed: false }
```

The first message after `startSession` produces `preKeySignal`; subsequent ones produce `signal`. The receiver doesn't need to know — `receive` dispatches.

### Sealed send

```
alice.configureSealedSender({ trustRoot, senderCert })
alice.send(bob, 'hi', { sealed: true }) → { type: 'sealed', bytes }
bob.receive(envelope)                   → { kind: 'message', from: <recovered from cert>, plaintext: 'hi', sealed: true }
```

The recovered `from` field reflects the cert chain's verified sender, not the address the caller passed in. That's the whole point of sealed sender — the receiver doesn't know who sent it until after decrypting.

### Group welcome + send

```
const g = alice.group(distId)
const welcomes = await g.welcome([bob, carol])
// [{ to: bob, envelope: <SKDM wrapped in alice↔bob 1:1> },
//  { to: carol, envelope: <SKDM wrapped in alice↔carol 1:1> }]

bob.receive(welcomes[0].envelope)       → { kind: 'group-welcome', from: alice, distributionId }
carol.receive(welcomes[1].envelope)     → { kind: 'group-welcome', from: alice, distributionId }

const groupEnv = await g.send('hello group')
// app fans groupEnv out to bob and carol
bob.receive(groupEnv)                   → { kind: 'group-message', from: alice, plaintext: 'hello group' }
carol.receive(groupEnv)                 → { kind: 'group-message', from: alice, plaintext: 'hello group' }
```

The 1:1 must exist before the welcome ships. If bob hasn't called `startSession` on alice's bundle yet, `bob.receive(welcomeEnvelope)` throws `SessionNotFoundError`. The facade does not silently establish the 1:1 — that would hide a sequencing bug from the app.

## Error handling

All facade methods throw the existing typed `LibsignalError` subclasses from `src/errors.ts`:

- `SessionNotFoundError` — `send` to a remote that hasn't been `startSession`-ed, or `receive` of a welcome before the 1:1 exists.
- `UntrustedIdentityError` — remote identity changed and the underlying store rejected it.
- `InvalidMessageError` — bytes don't deserialize, signature bad, etc.
- `SenderKeyNotFoundError` — group encrypt/decrypt without an SKDM exchange.
- `DuplicateMessageError` — replayed message.
- `StoreError` — SQLCipher layer failure.

The demo screen catches all of these and renders them in the receiver's history pane as system rows. No new error types invented.

## Demo screen

`example/src/screens/SignalClientScreen.tsx` — split view, three stacked panels.

### Layout

Each persona (alice / bob / carol) gets a panel with:
- Header: persona name + 8-char identity-key fingerprint
- Scroll view of message history: outgoing bubbles (right), incoming bubbles (left), system rows (centered)
- Composer at the bottom: text input + Send button
- Target picker row: pills for `→ bob`, `→ carol`, `→ group`

Above the panels:
- A `[ ] sealed` toggle — disabled when target is `→ group`
- A "Start group" button — disabled once a group has been started this session

### Mount sequence

1. Open three `SignalClient` instances (alice/bob/carol) via `SignalClient.open` over three SQLCipher stores (`alice.client.db`, `bob.client.db`, `carol.client.db` with corresponding key aliases).
2. `initializeIfNeeded` on each with a fresh registration id.
3. For each ordered pair: receiver `publishOneTimePreKey` to mint a bundle, sender calls `startSession(receiver, bundle)`. Six bundles, six `startSession` calls — alice↔bob, alice↔carol, bob↔carol.
4. Mint the sealed-sender cert chain at the screen level: trust-root `IdentityKeyPair`, server `IdentityKeyPair`, server cert under trust root, one sender cert per persona signed by the server cert. Call `configureSealedSender` on each client.
5. Mark the app "ready" — composers enabled.

### Transport

```ts
function ship(env: Envelope, target: Address | 'group', members?: Address[]) {
  if (target === 'group') {
    for (const m of members!) clients[m.name].receive(env).then(handleReceived).catch(handleError)
  } else {
    clients[target.name].receive(env).then(handleReceived).catch(handleError)
  }
}
```

`handleReceived` appends a message row to the receiver's history. `handleError` appends a system row.

### Group start

The "Start group" button:
1. Generates a fresh distribution id (`randomUuidV4` from Phase 4b).
2. `const g = alice.group(distId)`
3. `const welcomes = await g.welcome([bob, carol])`
4. For each welcome: `ship(welcome.envelope, welcome.to)`

After "Start group" lands, the `→ group` pill becomes selectable. Group sends fan out to both other personas.

### Smoke verification

The screen auto-runs a deterministic scripted sequence on mount (after setup completes):

1. `alice.send(bob, 'hi')` → bob receives
2. `alice.send(bob, 'hi sealed', { sealed: true })` → bob receives
3. `bob.send(alice, 'hi back')` → alice receives
4. Start group → bob and carol receive welcomes
5. `alice.group(distId).send('hello group')` → bob and carol receive
6. `bob.group(distId).send('hi from bob')` → alice and carol receive

Then emits `[SIGNALCLIENT-SUMMARY]` JSON with the same `{ status, steps: [{ label, ok, detail }] }` shape as the other screens. Grep target: `[SIGNALCLIENT-SUMMARY]`.

After the scripted sequence, the UI remains interactive — composers work, manual sends route through the same `ship` helper.

## Testing

### Unit

`example/src/client/__tests__/SignalClient.test.ts`. Jest. Mocks the underlying classes (`SessionBuilder`, `SessionCipher`, `GroupCipher`, `GroupSessionBuilder`, `SealedSender`, `SQLCipherProtocolStore`). Asserts:

- `Address` round-trips through `send` / `receive` (string-name preserved on both ends).
- `receive` dispatches by `envelope.type` and returns the correct `Received.kind`.
- Calling `send(..., { sealed: true })` before `configureSealedSender` throws.
- `group(id).welcome(members)` returns one envelope per member, each tagged `sender-key-distribution`.

### Integration

The demo screen, smoked on both platforms with `[SIGNALCLIENT-SUMMARY]`. Same pattern as Phase 4a/4b smoke runs. Updates `example/SMOKE_TEST_LOG.md`.

## Library lift candidates (post-demo)

Things expected to be worth lifting:

- `Address = { name, deviceId }` boundary type and a `ProtocolAddress.fromObject` static helper. Pure ergonomics.
- The `Envelope` / `Received` tag types — stable shape lots of apps would converge on independently.
- The `PublishedBundle` plain-object shape and a `PreKeyBundle.fromPublished` static. Real apps deserialize from server JSON.

Things not expected to lift:

- `SignalClient` itself. Transport-agnostic but app-specific in many small ways.
- Sealed-sender cert minting helpers. Stays in app territory.
- Group welcome/send fan-out. Membership tracking is fundamentally an app concern.

The lift decision happens after the demo ships. Not part of this phase.

## Out of scope

- Lifting any of the facade or boundary types into `src/`. Separate phase.
- npm publishing prep.
- Web (WASM) support.
- Provisioning (defer until libsignal exposes standalone primitives or the Net binding is in scope).
- PreKey rotation logic (app responsibility).
- Group membership persistence (app responsibility).
- Identity-change UX (out per brainstorming; library still throws `UntrustedIdentityError`).
