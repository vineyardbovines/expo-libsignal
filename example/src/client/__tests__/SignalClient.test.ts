jest.mock('expo-libsignal/stores', () => {
  const store = {
    hasLocalIdentity: jest.fn(async () => false),
    initializeLocalIdentity: jest.fn(async () => {}),
    getIdentityKeyPair: jest.fn(async () => ({
      publicKey: () => ({ serialize: () => new Uint8Array([1, 2, 3]) }),
    })),
    close: jest.fn(async () => {}),
  }
  return {
    SQLCipherProtocolStore: {
      open: jest.fn(async () => store),
    },
    __store: store,
  }
})
jest.mock('expo-libsignal', () => {
  const actual = jest.requireActual('expo-libsignal')
  return {
    ...actual,
    IdentityKeyPair: { generate: jest.fn(async () => ({ tag: 'kp' })) },
    ProtocolAddress: {
      create: jest.fn(async (name: string, deviceId: number) => ({
        name: () => name,
        deviceId: () => deviceId,
      })),
    },
  }
})

import { SignalClient } from '../SignalClient'
const stores = jest.requireMock('expo-libsignal/stores')

describe('SignalClient — open + initialize', () => {
  beforeEach(() => jest.clearAllMocks())

  test('open creates a store and returns a client tied to self', async () => {
    const client = await SignalClient.open({
      databaseName: 'alice.db',
      keyAlias: 'alice.dbkey',
      self: { name: 'alice', deviceId: 1 },
    })
    expect(stores.SQLCipherProtocolStore.open).toHaveBeenCalledWith({
      databaseName: 'alice.db',
      keyAlias: 'alice.dbkey',
    })
    expect(client).toBeInstanceOf(SignalClient)
  })

  test('initializeIfNeeded generates an identity when none exists', async () => {
    const client = await SignalClient.open({
      databaseName: 'a.db',
      keyAlias: 'a.k',
      self: { name: 'alice', deviceId: 1 },
    })
    await client.initializeIfNeeded({ registrationId: 12345 })
    expect(stores.__store.initializeLocalIdentity).toHaveBeenCalledTimes(1)
    expect(stores.__store.initializeLocalIdentity.mock.calls[0][1]).toBe(12345)
  })

  test('initializeIfNeeded is a no-op when identity already exists', async () => {
    stores.__store.hasLocalIdentity.mockResolvedValueOnce(true)
    const client = await SignalClient.open({
      databaseName: 'a.db',
      keyAlias: 'a.k',
      self: { name: 'alice', deviceId: 1 },
    })
    await client.initializeIfNeeded({ registrationId: 12345 })
    expect(stores.__store.initializeLocalIdentity).not.toHaveBeenCalled()
  })

  test('hasIdentity delegates to the store', async () => {
    stores.__store.hasLocalIdentity.mockResolvedValueOnce(true)
    const client = await SignalClient.open({
      databaseName: 'a.db',
      keyAlias: 'a.k',
      self: { name: 'alice', deviceId: 1 },
    })
    expect(await client.hasIdentity()).toBe(true)
  })

  test('close delegates to the store', async () => {
    const client = await SignalClient.open({
      databaseName: 'a.db',
      keyAlias: 'a.k',
      self: { name: 'alice', deviceId: 1 },
    })
    await client.close()
    expect(stores.__store.close).toHaveBeenCalled()
  })
})
