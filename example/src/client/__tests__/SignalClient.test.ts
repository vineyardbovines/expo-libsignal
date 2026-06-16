jest.mock('expo-libsignal/stores', () => {
  const store: Record<string, unknown> = {
    hasLocalIdentity: jest.fn(async () => false),
    initializeLocalIdentity: jest.fn(async () => {}),
    getIdentityKeyPair: jest.fn(async () => ({
      publicKey: () => ({ serialize: () => new Uint8Array([1, 2, 3]) }),
    })),
    close: jest.fn(async () => {}),
    runExclusive: jest.fn(async (fn: () => Promise<unknown>) => fn()),
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

describe('SignalClient — 1:1 send/receive', () => {
  beforeEach(() => jest.clearAllMocks())

  test('publishOneTimePreKey persists records and returns a bundle', async () => {
    const PreKeyRecord = require('expo-libsignal').PreKeyRecord
    PreKeyRecord.generate = jest.fn(async () => ({
      serialize: () => new Uint8Array([0xa]),
      publicKey: () => ({ serialize: () => new Uint8Array([0xb]) }),
    }))
    const SignedPreKeyRecord = require('expo-libsignal').SignedPreKeyRecord
    SignedPreKeyRecord.generate = jest.fn(async () => ({
      serialize: () => new Uint8Array([0xc]),
      publicKey: () => ({ serialize: () => new Uint8Array([0xd]) }),
      signature: () => new Uint8Array([0xe]),
    }))
    const KyberPreKeyRecord = require('expo-libsignal').KyberPreKeyRecord
    KyberPreKeyRecord.generate = jest.fn(async () => ({
      serialize: () => new Uint8Array([0xf]),
      kyberPublicKey: () => new Uint8Array([0x11]),
      signature: () => new Uint8Array([0x12]),
    }))
    stores.__store.storePreKey = jest.fn(async () => {})
    stores.__store.storeSignedPreKey = jest.fn(async () => {})
    stores.__store.storeKyberPreKey = jest.fn(async () => {})
    stores.__store.getLocalRegistrationId = jest.fn(async () => 42)
    stores.__store.getIdentityKeyPair = jest.fn(async () => ({
      publicKey: () => ({ serialize: () => new Uint8Array([0x99]) }),
    }))

    const client = await SignalClient.open({
      databaseName: 'a.db',
      keyAlias: 'a.k',
      self: { name: 'alice', deviceId: 1 },
    })
    const bundle = await client.publishOneTimePreKey({
      preKeyId: 100,
      signedPreKeyId: 200,
      kyberPreKeyId: 300,
    })
    expect(bundle.registrationId).toBe(42)
    expect(bundle.deviceId).toBe(1)
    expect(bundle.preKeyId).toBe(100)
    expect(bundle.signedPreKeyId).toBe(200)
    expect(bundle.kyberPreKeyId).toBe(300)
    expect(stores.__store.storePreKey).toHaveBeenCalledWith(100, expect.anything())
    expect(stores.__store.storeSignedPreKey).toHaveBeenCalledWith(200, expect.anything())
    expect(stores.__store.storeKyberPreKey).toHaveBeenCalledWith(300, expect.anything())
  })

  test('send returns a tagged envelope and persists session state', async () => {
    const encrypted = {
      type: 'preKeySignal',
      serialize: () => new Uint8Array([0xaa, 0xbb]),
    }
    const SessionCipher = require('expo-libsignal').SessionCipher
    SessionCipher.prototype.encrypt = jest.fn(async () => encrypted)

    const client = await SignalClient.open({
      databaseName: 'a.db',
      keyAlias: 'a.k',
      self: { name: 'alice', deviceId: 1 },
    })
    const env = await client.send({ name: 'bob', deviceId: 1 }, 'hi')
    expect(env.type).toBe('preKeySignal')
    expect(env).toMatchObject({ from: { name: 'alice', deviceId: 1 } })
    if (env.type === 'preKeySignal' || env.type === 'signal') {
      expect(env.bytes).toEqual(new Uint8Array([0xaa, 0xbb]))
    } else {
      throw new Error('wrong type')
    }
  })

  test('receive dispatches preKeySignal envelope to decryptPreKeySignal', async () => {
    const SessionCipher = require('expo-libsignal').SessionCipher
    SessionCipher.prototype.decryptPreKeySignal = jest.fn(async () =>
      new TextEncoder().encode('hi'),
    )
    const PreKeySignalMessage = require('expo-libsignal').PreKeySignalMessage
    PreKeySignalMessage.deserialize = jest.fn(async (b: Uint8Array) => ({
      serialize: () => b,
    }))

    const client = await SignalClient.open({
      databaseName: 'b.db',
      keyAlias: 'b.k',
      self: { name: 'bob', deviceId: 1 },
    })
    const received = await client.receive({
      type: 'preKeySignal',
      from: { name: 'alice', deviceId: 1 },
      bytes: new Uint8Array([0xaa, 0xbb]),
    })
    expect(received).toEqual({
      kind: 'message',
      from: { name: 'alice', deviceId: 1 },
      plaintext: 'hi',
      sealed: false,
    })
  })
})

describe('SignalClient — sealed sender', () => {
  beforeEach(() => jest.clearAllMocks())

  test('send({sealed:true}) throws if configureSealedSender was not called', async () => {
    const client = await SignalClient.open({
      databaseName: 'a.db',
      keyAlias: 'a.k',
      self: { name: 'alice', deviceId: 1 },
    })
    await expect(
      client.send({ name: 'bob', deviceId: 1 }, 'hi', { sealed: true }),
    ).rejects.toThrow(/SealedSender not configured/)
  })

  test('configured sealed send returns a sealed envelope', async () => {
    const SealedSender = require('expo-libsignal').SealedSender
    SealedSender.encrypt = jest.fn(async () => new Uint8Array([0xc1, 0xc2]))
    const client = await SignalClient.open({
      databaseName: 'a.db',
      keyAlias: 'a.k',
      self: { name: 'alice', deviceId: 1 },
    })
    client.configureSealedSender({
      trustRoot: { serialize: () => new Uint8Array() } as never,
      senderCert: { serialize: () => new Uint8Array() } as never,
    })
    const env = await client.send({ name: 'bob', deviceId: 1 }, 'hi', {
      sealed: true,
    })
    expect(env.type).toBe('sealed')
    if (env.type === 'sealed') {
      expect(env.bytes).toEqual(new Uint8Array([0xc1, 0xc2]))
    }
  })

  test('sealed receive returns the recovered sender', async () => {
    const SealedSender = require('expo-libsignal').SealedSender
    SealedSender.decryptMessage = jest.fn(async () => ({
      message: new TextEncoder().encode('hi'),
      senderUuid: 'alice-uuid',
      senderE164: null,
      senderDeviceId: 1,
    }))
    const client = await SignalClient.open({
      databaseName: 'b.db',
      keyAlias: 'b.k',
      self: { name: 'bob', deviceId: 1 },
    })
    client.configureSealedSender({
      trustRoot: { serialize: () => new Uint8Array() } as never,
      senderCert: { serialize: () => new Uint8Array() } as never,
    })
    const received = await client.receive({
      type: 'sealed',
      bytes: new Uint8Array([0xc1, 0xc2]),
    })
    expect(received).toEqual({
      kind: 'message',
      from: { name: 'alice-uuid', deviceId: 1 },
      plaintext: 'hi',
      sealed: true,
    })
  })
})

describe('SignalClient — groups', () => {
  beforeEach(() => jest.clearAllMocks())

  test('group(distId).welcome wraps SKDM in a 1:1 envelope per member', async () => {
    const skdmBytes = new Uint8Array([0xed, 0xed])
    const GroupSessionBuilder = require('expo-libsignal').GroupSessionBuilder
    GroupSessionBuilder.prototype.createSenderKeyDistributionMessage = jest.fn(
      async () => ({
        serialize: () => skdmBytes,
        distributionId: () => 'dist-1',
      }),
    )
    const SessionCipher = require('expo-libsignal').SessionCipher
    SessionCipher.prototype.encrypt = jest.fn(async () => ({
      type: 'signal',
      serialize: () => new Uint8Array([0x77]),
    }))

    const alice = await SignalClient.open({
      databaseName: 'a.db',
      keyAlias: 'a.k',
      self: { name: 'alice', deviceId: 1 },
    })
    const out = await alice
      .group('11111111-2222-3333-4444-555555555555')
      .welcome([
        { name: 'bob', deviceId: 1 },
        { name: 'carol', deviceId: 1 },
      ])
    expect(out).toHaveLength(2)
    const first = out[0]
    if (first === undefined) throw new Error('expected first envelope')
    expect(first.to).toEqual({ name: 'bob', deviceId: 1 })
    expect(first.envelope.type).toBe('sender-key-distribution')
    if (first.envelope.type === 'sender-key-distribution') {
      expect(first.envelope.distributionId).toBe(
        '11111111-2222-3333-4444-555555555555',
      )
    }
  })

  test('group(distId).send returns a group envelope', async () => {
    const GroupCipher = require('expo-libsignal').GroupCipher
    GroupCipher.prototype.encrypt = jest.fn(
      async () => new Uint8Array([0xc0, 0xff, 0xee]),
    )

    const alice = await SignalClient.open({
      databaseName: 'a.db',
      keyAlias: 'a.k',
      self: { name: 'alice', deviceId: 1 },
    })
    const env = await alice
      .group('11111111-2222-3333-4444-555555555555')
      .send('hi all')
    expect(env.type).toBe('group')
    if (env.type === 'group') {
      expect(env.distributionId).toBe('11111111-2222-3333-4444-555555555555')
      expect(env.bytes).toEqual(new Uint8Array([0xc0, 0xff, 0xee]))
      expect(env.from).toEqual({ name: 'alice', deviceId: 1 })
    }
  })

  test('receive(sender-key-distribution) decrypts inner 1:1, processes SKDM, returns welcome', async () => {
    const PreKeySignalMessage = require('expo-libsignal').PreKeySignalMessage
    PreKeySignalMessage.deserialize = jest.fn(async () => {
      throw new Error('not a preKeySignal')
    })
    const SignalMessage = require('expo-libsignal').SignalMessage
    SignalMessage.deserialize = jest.fn(async (b: Uint8Array) => ({
      serialize: () => b,
    }))
    const SessionCipher = require('expo-libsignal').SessionCipher
    SessionCipher.prototype.decryptSignal = jest.fn(
      async () => new Uint8Array([0xed, 0xed]),
    )
    const SenderKeyDistributionMessage =
      require('expo-libsignal').SenderKeyDistributionMessage
    SenderKeyDistributionMessage.deserialize = jest.fn(async () => ({
      distributionId: () => 'dist-1',
    }))
    const GroupSessionBuilder = require('expo-libsignal').GroupSessionBuilder
    GroupSessionBuilder.prototype.processSenderKeyDistributionMessage = jest.fn(
      async () => {},
    )

    const bob = await SignalClient.open({
      databaseName: 'b.db',
      keyAlias: 'b.k',
      self: { name: 'bob', deviceId: 1 },
    })
    const received = await bob.receive({
      type: 'sender-key-distribution',
      from: { name: 'alice', deviceId: 1 },
      bytes: new Uint8Array([0x77]),
      distributionId: 'dist-1',
    })
    expect(received).toEqual({
      kind: 'group-welcome',
      from: { name: 'alice', deviceId: 1 },
      distributionId: 'dist-1',
    })
  })

  test('receive(group) returns the group-message kind', async () => {
    const GroupCipher = require('expo-libsignal').GroupCipher
    GroupCipher.prototype.decrypt = jest.fn(
      async () => new TextEncoder().encode('hi all'),
    )

    const bob = await SignalClient.open({
      databaseName: 'b.db',
      keyAlias: 'b.k',
      self: { name: 'bob', deviceId: 1 },
    })
    const received = await bob.receive({
      type: 'group',
      from: { name: 'alice', deviceId: 1 },
      distributionId: 'dist-1',
      bytes: new Uint8Array([0xc0]),
    })
    expect(received).toEqual({
      kind: 'group-message',
      from: { name: 'alice', deviceId: 1 },
      distributionId: 'dist-1',
      plaintext: 'hi all',
    })
  })
})
