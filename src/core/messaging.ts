// Boundary types and a transport interface for the messaging surface that
// sits on top of the core cryptographic primitives. These shapes are stable
// across the apps that build on this library; they are not tied to the
// example facade. Apps that build their own client class are free to use
// them.

/** Plain-object peer address. Apps never construct ProtocolAddress directly. */
export type Address = { name: string; deviceId: number }

/**
 * Tagged transport union. A `Client` produces an Envelope on send; the app
 * ships its `bytes` over its own transport (websocket / REST / push); the
 * recipient feeds the same Envelope back into `receive`.
 */
export type Envelope =
  | { type: 'preKeySignal' | 'signal'; from: Address; bytes: Uint8Array }
  | { type: 'sealed'; bytes: Uint8Array }
  | {
      type: 'sender-key-distribution'
      from: Address
      bytes: Uint8Array
      distributionId: string
    }
  | { type: 'group'; from: Address; distributionId: string; bytes: Uint8Array }

/** Result of a successful `receive`. App switches on `kind`. */
export type Received =
  | { kind: 'message'; from: Address; plaintext: string; sealed: boolean }
  | {
      kind: 'group-message'
      from: Address
      distributionId: string
      plaintext: string
    }
  | { kind: 'group-welcome'; from: Address; distributionId: string }

/**
 * Transport seam for shipping envelopes between peers. Implementors:
 * `send` delivers the envelope to whatever is reachable (real network, push
 * inbox, etc.); `subscribe` registers a callback for envelopes addressed to
 * `self` and returns an unsubscribe function.
 */
export interface Transport {
  send(to: Address, envelope: Envelope): Promise<void>
  subscribe(self: Address, onEnvelope: (envelope: Envelope) => void): () => void
}

/**
 * Exhaustive handler table for `dispatchReceived`. Each handler is keyed by
 * the `Received.kind` it accepts; TypeScript narrows the argument type to the
 * matching variant. Handlers may be sync or async; the dispatcher awaits.
 */
export type ReceivedHandlers = {
  message?: (r: Extract<Received, { kind: 'message' }>) => Promise<void> | void
  'group-message'?: (r: Extract<Received, { kind: 'group-message' }>) => Promise<void> | void
  'group-welcome'?: (r: Extract<Received, { kind: 'group-welcome' }>) => Promise<void> | void
}

/**
 * Route a `Received` value to the matching handler, awaiting if the handler
 * returns a promise. Missing handlers are silently ignored, which keeps app
 * code free of `if (r.kind === ...)` chains when only a subset of kinds is
 * interesting.
 */
export async function dispatchReceived(
  received: Received,
  handlers: ReceivedHandlers,
): Promise<void> {
  if (received.kind === 'message') {
    const h = handlers.message
    if (h !== undefined) await h(received)
    return
  }
  if (received.kind === 'group-message') {
    const h = handlers['group-message']
    if (h !== undefined) await h(received)
    return
  }
  if (received.kind === 'group-welcome') {
    const h = handlers['group-welcome']
    if (h !== undefined) await h(received)
  }
}
