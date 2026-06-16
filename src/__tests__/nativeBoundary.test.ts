// The op boundary: argument Records carry only primitives (Expo Modules on
// Android converts incoming Records via plain maps, which cannot carry
// SharedObjects or typed arrays), every byte payload is a positional
// Uint8Array argument, and SharedObject refs are only valid positionally
// (factories, PreKeyBundle) or as direct return values. tsc can't enforce
// this (NativeModule is `any`), so these tests pin the contract at the mock
// boundary with identity assertions.
jest.mock('../ExpoLibsignalModule', () => ({
  NativeModule: {
    generateIdentityKeyPair: jest.fn(),
    generateSignedPreKeyRecord: jest.fn(),
    generateKyberPreKeyRecord: jest.fn(),
    createPreKeyBundle: jest.fn(),
    processPreKeyBundleOp: jest.fn(),
    encryptOp: jest.fn(),
    decryptPreKeySignalOp: jest.fn(),
    decryptSignalOp: jest.fn(),
    deserializeSessionRecord: jest.fn(),
    deserializeIdentityKey: jest.fn(),
    deserializeSignalMessage: jest.fn(),
    deserializePreKeySignalMessage: jest.fn(),
  },
}))

import { IdentityKey, IdentityKeyPair } from '../core/IdentityKeyPair'
import { KyberPreKeyRecord } from '../core/KyberPreKeyRecord'
import { PreKeySignalMessage, SignalMessage } from '../core/messages'
import { PreKeyBundle } from '../core/PreKeyBundle'
import { PreKeyRecord } from '../core/PreKeyRecord'
import { ProtocolAddress } from '../core/ProtocolAddress'
import { PublicKey } from '../core/PublicKey'
import { encodeRecordList } from '../core/recordList'
import { SessionBuilder } from '../core/SessionBuilder'
import { SessionCipher } from '../core/SessionCipher'
import { SessionRecord } from '../core/SessionRecord'
import { SignedPreKeyRecord } from '../core/SignedPreKeyRecord'
import { NativeModule } from '../ExpoLibsignalModule'

// Sentinel byte payloads — identity (===) is what matters.
const ikpBytes = new Uint8Array([1])
const remoteIdentityBytes = new Uint8Array([2])
const identityKeyBytes = new Uint8Array([3])
const spkPublicBytes = new Uint8Array([4])
const pkPublicBytes = new Uint8Array([5])
const sessionBytes = new Uint8Array([6])
const preKeyBytes = new Uint8Array([7])
const signedPreKeyBytes = new Uint8Array([8])
const kyberPreKeyBytes = new Uint8Array([9])
const kyberPreKey2Bytes = new Uint8Array([14])
const messageBytes = new Uint8Array([10])
const newSessionBytes = new Uint8Array([11])
const trustedIdentityBytes = new Uint8Array([12])
const outMessageBytes = new Uint8Array([13])

// Sentinel native refs. Wrappers call ref.serialize() synchronously, so each
// ref serves its sentinel bytes.
const ikpRef = { serialize: () => ikpBytes }
const remoteIdentityRef = { serialize: () => remoteIdentityBytes }
const identityKeyRef = { serialize: () => identityKeyBytes }
const spkPublicRef = { serialize: () => spkPublicBytes }
const pkPublicRef = { serialize: () => pkPublicBytes }
const bundleRef = { kind: 'PreKeyBundleRef' }
const remoteAddrRef = { name: () => 'bob', deviceId: () => 1 }
const localAddrRef = { name: () => 'alice', deviceId: () => 2 }
const sessionRef = { serialize: () => sessionBytes }
const preKeyRef = { serialize: () => preKeyBytes }
const signedPreKeyRef = { serialize: () => signedPreKeyBytes }
const kyberPreKeyRef = { serialize: () => kyberPreKeyBytes }
const kyberPreKey2Ref = { serialize: () => kyberPreKey2Bytes }
const preKeySignalMsgRef = {
  serialize: () => messageBytes,
  preKeyId: () => 100,
  signedPreKeyId: () => 200,
}
const signalMsgRef = { serialize: () => messageBytes }
const newSessionRef = { serialize: () => newSessionBytes }
const trustedIdentityRef = { serialize: () => trustedIdentityBytes }

async function makeIdentityKeyPair(): Promise<IdentityKeyPair> {
  NativeModule.generateIdentityKeyPair.mockResolvedValueOnce(ikpRef)
  return IdentityKeyPair.generate()
}

function makeAddresses() {
  return {
    remote: new ProtocolAddress(remoteAddrRef as never),
    local: new ProtocolAddress(localAddrRef as never),
  }
}

function makeStores(opts: { existingSession?: SessionRecord | null } = {}) {
  return {
    sessionStore: {
      loadSession: jest.fn(async () => opts.existingSession ?? null),
      storeSession: jest.fn(async () => {}),
      removeSession: jest.fn(async () => {}),
    },
    identityStore: {
      getIdentityKeyPair: jest.fn(async () => makeIdentityKeyPair()),
      getLocalRegistrationId: jest.fn(async () => 42),
      getIdentity: jest.fn(async () => new IdentityKey(remoteIdentityRef as never)),
      saveIdentity: jest.fn(async () => 'newOrUnchanged' as const),
      isTrustedIdentity: jest.fn(async () => true),
    },
    preKeyStore: {
      loadPreKey: jest.fn(async () => new PreKeyRecord(preKeyRef as never)),
      loadPreKeys: jest.fn(async () => [new PreKeyRecord(preKeyRef as never)]),
      storePreKey: jest.fn(async () => {}),
      removePreKey: jest.fn(async () => {}),
    },
    signedPreKeyStore: {
      loadSignedPreKey: jest.fn(async () => new SignedPreKeyRecord(signedPreKeyRef as never)),
      loadSignedPreKeys: jest.fn(async () => [new SignedPreKeyRecord(signedPreKeyRef as never)]),
      storeSignedPreKey: jest.fn(async () => {}),
    },
    kyberPreKeyStore: {
      loadKyberPreKey: jest.fn(async () => new KyberPreKeyRecord(kyberPreKeyRef as never)),
      loadKyberPreKeys: jest.fn(async () => [
        new KyberPreKeyRecord(kyberPreKeyRef as never),
        new KyberPreKeyRecord(kyberPreKey2Ref as never),
      ]),
      storeKyberPreKey: jest.fn(async () => {}),
      markKyberPreKeyUsed: jest.fn(async () => {}),
    },
  }
}

function expectCommonAddressFields(args: Record<string, unknown>) {
  expect(args.remoteName).toBe('bob')
  expect(args.remoteDeviceId).toBe(1)
  expect(args.localName).toBe('alice')
  expect(args.localDeviceId).toBe(2)
}

beforeEach(() => {
  jest.clearAllMocks()
  NativeModule.deserializeSessionRecord.mockResolvedValue(newSessionRef)
  NativeModule.deserializeIdentityKey.mockResolvedValue(trustedIdentityRef)
  NativeModule.deserializeSignalMessage.mockResolvedValue(signalMsgRef)
  NativeModule.deserializePreKeySignalMessage.mockResolvedValue(preKeySignalMsgRef)
})

describe('record factories pass the IdentityKeyPair ref positionally', () => {
  test('SignedPreKeyRecord.generate', async () => {
    const ikp = await makeIdentityKeyPair()
    NativeModule.generateSignedPreKeyRecord.mockResolvedValueOnce(signedPreKeyRef)
    await SignedPreKeyRecord.generate(1, ikp, 1234)
    expect(NativeModule.generateSignedPreKeyRecord.mock.calls[0][1]).toBe(ikpRef)
  })

  test('KyberPreKeyRecord.generate', async () => {
    const ikp = await makeIdentityKeyPair()
    NativeModule.generateKyberPreKeyRecord.mockResolvedValueOnce(kyberPreKeyRef)
    await KyberPreKeyRecord.generate(1, ikp, 1234)
    expect(NativeModule.generateKyberPreKeyRecord.mock.calls[0][1]).toBe(ikpRef)
  })
})

describe('PreKeyBundle.create', () => {
  test('record holds only primitives; keys and signatures are positional bytes', async () => {
    NativeModule.createPreKeyBundle.mockResolvedValueOnce(bundleRef)
    const signedSig = new Uint8Array([21])
    const kyberPub = new Uint8Array([22])
    const kyberSig = new Uint8Array([23])
    await PreKeyBundle.create({
      registrationId: 1,
      deviceId: 1,
      identityKey: new IdentityKey(identityKeyRef as never),
      signedPreKeyId: 200,
      signedPreKeyPublic: new PublicKey(spkPublicRef as never),
      signedPreKeySignature: signedSig,
      kyberPreKeyId: 200,
      kyberPreKeyPublic: kyberPub,
      kyberPreKeySignature: kyberSig,
      preKeyId: 100,
      preKeyPublic: new PublicKey(pkPublicRef as never),
    })
    const call = NativeModule.createPreKeyBundle.mock.calls[0]
    expect(call[0]).toEqual({
      registrationId: 1,
      deviceId: 1,
      signedPreKeyId: 200,
      kyberPreKeyId: 200,
      preKeyId: 100,
    })
    expect(call[1]).toBe(identityKeyBytes)
    expect(call[2]).toBe(spkPublicBytes)
    expect(call[3]).toBe(signedSig)
    expect(call[4]).toBe(kyberPub)
    expect(call[5]).toBe(kyberSig)
    expect(call[6]).toBe(pkPublicBytes)
  })
})

describe('SessionBuilder.processPreKeyBundle', () => {
  test('sends bytes in the record, bundle ref positionally, rehydrates results', async () => {
    const { remote, local } = makeAddresses()
    const stores = makeStores({ existingSession: new SessionRecord(sessionRef as never) })
    NativeModule.processPreKeyBundleOp.mockResolvedValueOnce({
      newSession: newSessionBytes,
      identityChange: 'newOrUnchanged',
      trustedRemoteIdentity: trustedIdentityBytes,
    })
    const builder = new SessionBuilder(
      { sessionStore: stores.sessionStore, identityStore: stores.identityStore },
      remote,
      local,
    )
    await builder.processPreKeyBundle(new PreKeyBundle(bundleRef as never))

    const [config, bundleArg, ikpArg, sessionArg, identityArg] =
      NativeModule.processPreKeyBundleOp.mock.calls[0]
    expectCommonAddressFields(config)
    expect(bundleArg).toBe(bundleRef)
    expect(ikpArg).toBe(ikpBytes)
    expect(sessionArg).toBe(sessionBytes)
    expect(identityArg).toBe(remoteIdentityBytes)

    expect(NativeModule.deserializeSessionRecord).toHaveBeenCalledWith(newSessionBytes)
    expect(NativeModule.deserializeIdentityKey).toHaveBeenCalledWith(trustedIdentityBytes)
    expect(stores.sessionStore.storeSession).toHaveBeenCalled()
    expect(stores.identityStore.saveIdentity).toHaveBeenCalled()
  })
})

describe('SessionCipher ops', () => {
  function makeCipher(stores: ReturnType<typeof makeStores>) {
    const { remote, local } = makeAddresses()
    return new SessionCipher(
      {
        sessionStore: stores.sessionStore,
        identityStore: stores.identityStore,
        preKeyStore: stores.preKeyStore,
        signedPreKeyStore: stores.signedPreKeyStore,
        kyberPreKeyStore: stores.kyberPreKeyStore,
      },
      remote,
      local,
    )
  }

  test('encrypt sends bytes and rehydrates the message', async () => {
    const stores = makeStores({ existingSession: new SessionRecord(sessionRef as never) })
    NativeModule.encryptOp.mockResolvedValueOnce({
      messageType: 'preKeySignal',
      preKeySignalMessage: outMessageBytes,
      signalMessage: null,
      newSession: newSessionBytes,
      identityChange: null,
    })
    const plaintext = new Uint8Array([1, 2, 3])
    const msg = await makeCipher(stores).encrypt(plaintext)

    const [config, plaintextArg, ikpArg, sessionArg, identityArg] =
      NativeModule.encryptOp.mock.calls[0]
    expectCommonAddressFields(config)
    expect(plaintextArg).toBe(plaintext)
    expect(ikpArg).toBe(ikpBytes)
    expect(sessionArg).toBe(sessionBytes)
    expect(identityArg).toBe(remoteIdentityBytes)

    expect(NativeModule.deserializeSessionRecord).toHaveBeenCalledWith(newSessionBytes)
    expect(NativeModule.deserializePreKeySignalMessage).toHaveBeenCalledWith(outMessageBytes)
    expect(msg.type).toBe('preKeySignal')
  })

  test('decryptPreKeySignal sends bytes for message and prekeys', async () => {
    const stores = makeStores()
    NativeModule.decryptPreKeySignalOp.mockResolvedValueOnce({
      plaintext: new Uint8Array([1]),
      newSession: newSessionBytes,
      identityChange: null,
      consumedPreKeyId: 100,
      kyberPreKeyId: 200,
    })
    await makeCipher(stores).decryptPreKeySignal(
      new PreKeySignalMessage(preKeySignalMsgRef as never),
    )

    const [config, messageArg, ikpArg, sessionArg, identityArg, preKeyArg, spkArg, kyberArg] =
      NativeModule.decryptPreKeySignalOp.mock.calls[0]
    expectCommonAddressFields(config)
    expect(messageArg).toBe(messageBytes)
    expect(ikpArg).toBe(ikpBytes)
    expect(sessionArg).toBeNull()
    expect(identityArg).toBe(remoteIdentityBytes)
    expect(preKeyArg).toBe(preKeyBytes)
    expect(spkArg).toBe(signedPreKeyBytes)
    expect(kyberArg).toEqual(encodeRecordList([kyberPreKeyBytes, kyberPreKey2Bytes]))
    expect(stores.kyberPreKeyStore.loadKyberPreKeys).toHaveBeenCalled()

    expect(stores.preKeyStore.removePreKey).toHaveBeenCalledWith(100)
    expect(stores.kyberPreKeyStore.markKyberPreKeyUsed).toHaveBeenCalledWith(200)
  })

  test('decryptPreKeySignal skips markKyberPreKeyUsed when kyberPreKeyId is null', async () => {
    const stores = makeStores({ existingSession: new SessionRecord(sessionRef as never) })
    NativeModule.decryptPreKeySignalOp.mockResolvedValueOnce({
      plaintext: new Uint8Array([1]),
      newSession: newSessionBytes,
      identityChange: null,
      consumedPreKeyId: null,
      kyberPreKeyId: null,
    })
    await makeCipher(stores).decryptPreKeySignal(
      new PreKeySignalMessage(preKeySignalMsgRef as never),
    )
    expect(stores.kyberPreKeyStore.markKyberPreKeyUsed).not.toHaveBeenCalled()
    expect(stores.preKeyStore.removePreKey).not.toHaveBeenCalled()
  })

  test('decryptSignal sends bytes', async () => {
    const stores = makeStores({ existingSession: new SessionRecord(sessionRef as never) })
    NativeModule.decryptSignalOp.mockResolvedValueOnce({
      plaintext: new Uint8Array([1]),
      newSession: newSessionBytes,
      identityChange: null,
    })
    await makeCipher(stores).decryptSignal(new SignalMessage(signalMsgRef as never))

    const [config, messageArg, ikpArg, sessionArg, identityArg] =
      NativeModule.decryptSignalOp.mock.calls[0]
    expectCommonAddressFields(config)
    expect(messageArg).toBe(messageBytes)
    expect(ikpArg).toBe(ikpBytes)
    expect(sessionArg).toBe(sessionBytes)
    expect(identityArg).toBe(remoteIdentityBytes)
    expect(NativeModule.deserializeSessionRecord).toHaveBeenCalledWith(newSessionBytes)
  })
})
