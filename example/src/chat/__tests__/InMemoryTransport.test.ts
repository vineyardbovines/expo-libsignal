import { InMemoryTransport } from '../InMemoryTransport'

function envelope(text: string) {
  // The Transport interface doesn't care about envelope shape; any object works
  // for these tests. Use a sentinel so we can compare identity.
  return { type: 'signal', from: { name: 'alice', deviceId: 1 }, bytes: new Uint8Array([0x1]), tag: text } as never
}

describe('InMemoryTransport', () => {
  test('subscribe + send delivers to the subscribed callback', async () => {
    const transport = new InMemoryTransport()
    const received: unknown[] = []
    transport.subscribe({ name: 'bob', deviceId: 1 }, (env) => received.push(env))
    await transport.send({ name: 'bob', deviceId: 1 }, envelope('a'))
    // queueMicrotask delivery; let it drain.
    await new Promise<void>((r) => queueMicrotask(r))
    expect(received).toHaveLength(1)
  })

  test('unsubscribe stops delivery', async () => {
    const transport = new InMemoryTransport()
    const received: unknown[] = []
    const unsub = transport.subscribe({ name: 'bob', deviceId: 1 }, (env) => received.push(env))
    unsub()
    await expect(
      transport.send({ name: 'bob', deviceId: 1 }, envelope('a')),
    ).rejects.toThrow(/no subscriber/)
    expect(received).toHaveLength(0)
  })

  test('send to unsubscribed address throws', async () => {
    const transport = new InMemoryTransport()
    await expect(
      transport.send({ name: 'nobody', deviceId: 1 }, envelope('a')),
    ).rejects.toThrow(/no subscriber/)
  })

  test('multiple subscribers on different addresses do not interfere', async () => {
    const transport = new InMemoryTransport()
    const bobReceived: unknown[] = []
    const carolReceived: unknown[] = []
    transport.subscribe({ name: 'bob', deviceId: 1 }, (env) => bobReceived.push(env))
    transport.subscribe({ name: 'carol', deviceId: 1 }, (env) => carolReceived.push(env))
    await transport.send({ name: 'bob', deviceId: 1 }, envelope('a'))
    await new Promise<void>((r) => queueMicrotask(r))
    expect(bobReceived).toHaveLength(1)
    expect(carolReceived).toHaveLength(0)
  })

  test('subscribing twice on the same address overwrites the previous handler', async () => {
    const transport = new InMemoryTransport()
    const first: unknown[] = []
    const second: unknown[] = []
    transport.subscribe({ name: 'bob', deviceId: 1 }, (env) => first.push(env))
    transport.subscribe({ name: 'bob', deviceId: 1 }, (env) => second.push(env))
    await transport.send({ name: 'bob', deviceId: 1 }, envelope('a'))
    await new Promise<void>((r) => queueMicrotask(r))
    expect(first).toHaveLength(0)
    expect(second).toHaveLength(1)
  })
})
