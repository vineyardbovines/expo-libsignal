import { ProtocolAddress } from '../core/ProtocolAddress'
import { SealedSender } from '../core/SealedSender'
import { SenderCertificate } from '../core/SenderCertificate'

const sealedBytes = new Uint8Array([0xf1, 0xf2, 0xf3])
const plaintext = new Uint8Array([0x68, 0x69]) // "hi"

jest.mock('../ExpoLibsignalModule', () => ({
  NativeModule: {
    deserializeSenderCertificate: jest.fn(async () => ({
      serialize: () => new Uint8Array([0xaa]),
      senderUuid: () => 'alice-uuid',
      senderE164: () => null,
      senderDeviceId: () => 1,
      expiration: () => 0,
      signatureKey: () => ({ serialize: () => new Uint8Array() }),
      serverCertificate: () => ({
        serialize: () => new Uint8Array(),
        keyId: () => 0,
        signature: () => new Uint8Array(),
        key: () => ({ serialize: () => new Uint8Array() }),
      }),
    })),
    sealedSenderEncryptOp: jest.fn(async () => ({
      ciphertext: sealedBytes,
      newSession: new Uint8Array([0x01]),
      identityChange: 'newOrUnchanged',
    })),
    sealedSenderDecryptOp: jest.fn(async () => ({
      plaintext,
      senderUuid: 'alice-uuid',
      senderE164: null,
      senderDeviceId: 1,
      newSession: new Uint8Array([0x02]),
      identityChange: 'newOrUnchanged',
      consumedPreKeyId: 7,
      kyberPreKeyId: 11,
    })),
    deserializeSessionRecord: jest.fn(async (bytes: Uint8Array) => ({ serialize: () => bytes })),
    deserializeIdentityKeyPair: jest.fn(async () => ({
      serialize: () => new Uint8Array(),
      publicKey: () => ({ serialize: () => new Uint8Array() }),
      privateKey: () => ({ serialize: () => new Uint8Array() }),
    })),
    createProtocolAddress: jest.fn(async (name: string, deviceId: number) => ({
      name: () => name,
      deviceId: () => deviceId,
    })),
    deserializePublicKey: jest.fn(async () => ({ serialize: () => new Uint8Array() })),
  },
}))

describe('SealedSender', () => {
  test('encrypt calls the op and persists the rotated session', async () => {
    const calls = { storeSession: 0 }
    const sessionStore = {
      loadSession: jest.fn(async () => ({ serialize: () => new Uint8Array([0x99]) })),
      storeSession: jest.fn(async () => {
        calls.storeSession++
      }),
    }
    const identityStore = {
      getIdentityKeyPair: jest.fn(async () => ({ serialize: () => new Uint8Array() })),
      getLocalRegistrationId: jest.fn(async () => 1),
      getIdentity: jest.fn(async () => null),
      saveIdentity: jest.fn(async () => 'newOrUnchanged'),
      isTrustedIdentity: jest.fn(async () => true),
    }
    const destination = await ProtocolAddress.create('bob', 1)
    const senderCert = await SenderCertificate.deserialize(new Uint8Array([0xaa]))
    const out = await SealedSender.encrypt({
      destination,
      senderCert,
      message: new Uint8Array([0x10]),
      sessionStore: sessionStore as never,
      identityStore: identityStore as never,
    })
    expect(out).toEqual(sealedBytes)
    expect(calls.storeSession).toBe(1)
  })

  test('decryptMessage seeds prekey records, persists session under sender address, and consumes used keys', async () => {
    const persistedSessions: Array<{ name: string; deviceId: number }> = []
    const removedPreKeys: number[] = []
    const usedKyberKeys: number[] = []
    const sessionStore = {
      loadSession: jest.fn(async () => null),
      storeSession: jest.fn(async (addr: ProtocolAddress) => {
        persistedSessions.push({ name: addr.name(), deviceId: addr.deviceId() })
      }),
    }
    const identityStore = {
      getIdentityKeyPair: jest.fn(async () => ({ serialize: () => new Uint8Array() })),
      getLocalRegistrationId: jest.fn(async () => 1),
      getIdentity: jest.fn(async () => null),
      saveIdentity: jest.fn(async () => 'newOrUnchanged'),
      isTrustedIdentity: jest.fn(async () => true),
    }
    const preKeyStore = {
      loadPreKey: jest.fn(),
      loadPreKeys: jest.fn(async () => [{ serialize: () => new Uint8Array([0x01]) }]),
      storePreKey: jest.fn(),
      removePreKey: jest.fn(async (id: number) => {
        removedPreKeys.push(id)
      }),
    }
    const signedPreKeyStore = {
      loadSignedPreKey: jest.fn(),
      loadSignedPreKeys: jest.fn(async () => [{ serialize: () => new Uint8Array([0x02]) }]),
      storeSignedPreKey: jest.fn(),
    }
    const kyberPreKeyStore = {
      loadKyberPreKey: jest.fn(),
      loadKyberPreKeys: jest.fn(async () => [{ serialize: () => new Uint8Array([0x03]) }]),
      storeKyberPreKey: jest.fn(),
      markKyberPreKeyUsed: jest.fn(async (id: number) => {
        usedKyberKeys.push(id)
      }),
    }
    const trustRoot = { serialize: () => new Uint8Array() }
    const out = await SealedSender.decryptMessage({
      ciphertext: new Uint8Array([0x20]),
      trustRoot: trustRoot as never,
      timestamp: 1_700_000_000_000,
      localUuid: 'bob-uuid',
      localDeviceId: 1,
      stores: {
        sessionStore: sessionStore as never,
        identityStore: identityStore as never,
        preKeyStore: preKeyStore as never,
        signedPreKeyStore: signedPreKeyStore as never,
        kyberPreKeyStore: kyberPreKeyStore as never,
      },
    })
    expect(out.message).toEqual(plaintext)
    expect(out.senderUuid).toBe('alice-uuid')
    expect(out.senderDeviceId).toBe(1)
    expect(preKeyStore.loadPreKeys).toHaveBeenCalled()
    expect(signedPreKeyStore.loadSignedPreKeys).toHaveBeenCalled()
    expect(kyberPreKeyStore.loadKyberPreKeys).toHaveBeenCalled()
    expect(persistedSessions).toEqual([{ name: 'alice-uuid', deviceId: 1 }])
    expect(removedPreKeys).toEqual([7])
    expect(usedKyberKeys).toEqual([11])
  })
})
