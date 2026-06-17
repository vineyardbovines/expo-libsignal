import type { Envelope } from '../client/SignalClient'

export type Address = { name: string; deviceId: number }

export interface Transport {
  /** Ship an envelope addressed to `to`. Throws if no subscriber is registered. */
  send(to: Address, envelope: Envelope): Promise<void>
  /** Register a callback for envelopes addressed to `self`. Returns an unsubscribe fn. */
  subscribe(self: Address, onEnvelope: (envelope: Envelope) => void): () => void
}
