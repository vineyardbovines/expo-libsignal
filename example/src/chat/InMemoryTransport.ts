import type { Address, Envelope, Transport } from 'expo-libsignal'

function key(a: Address): string {
  return `${a.name}.${a.deviceId}`
}

/**
 * Singleton transport for the example app. The chat demo shares one instance
 * across alice/bob/carol so a `send` from one persona ends up in another's
 * `receive`. A real app would implement the Transport interface against its
 * own websocket / REST / push pipeline.
 */
export class InMemoryTransport implements Transport {
  private readonly subs = new Map<string, (envelope: Envelope) => void>()

  subscribe(self: Address, onEnvelope: (envelope: Envelope) => void): () => void {
    const k = key(self)
    this.subs.set(k, onEnvelope)
    return () => {
      if (this.subs.get(k) === onEnvelope) this.subs.delete(k)
    }
  }

  async send(to: Address, envelope: Envelope): Promise<void> {
    const cb = this.subs.get(key(to))
    if (cb === undefined) throw new Error(`InMemoryTransport: no subscriber for ${key(to)}`)
    queueMicrotask(() => cb(envelope))
  }
}

/** Shared instance used by the example screens. */
export const inMemoryTransport = new InMemoryTransport()
