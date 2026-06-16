import { IdentityKeyPair } from '../core/IdentityKeyPair'
import { PublicKey } from '../core/PublicKey'
import { SenderCertificate } from '../core/SenderCertificate'
import { ServerCertificate } from '../core/ServerCertificate'

const senderCertBytes = new Uint8Array([0xd1, 0xd2])
const serverCertBytes = new Uint8Array([0xa1, 0xa2])
const sigKeyBytes = new Uint8Array([0xe1, 0xe2])
const serverKeyBytes = new Uint8Array([0xc1, 0xc2])

jest.mock('../ExpoLibsignalModule', () => {
  const serverRef = {
    serialize: () => serverCertBytes,
    keyId: () => 1,
    signature: () => new Uint8Array(),
    key: () => ({ serialize: () => serverKeyBytes }),
  }
  const senderRef = {
    serialize: () => senderCertBytes,
    senderUuid: () => 'aaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    senderE164: () => '+15555550100',
    senderDeviceId: () => 1,
    expiration: () => 1_700_000_000_000,
    signatureKey: () => ({ serialize: () => sigKeyBytes }),
    serverCertificate: () => serverRef,
  }
  return {
    NativeModule: {
      generateSenderCertificateOp: jest.fn(async () => ({ certificate: senderCertBytes })),
      deserializeSenderCertificate: jest.fn(async () => senderRef),
      generateServerCertificateOp: jest.fn(async () => ({ certificate: serverCertBytes })),
      deserializeServerCertificate: jest.fn(async () => serverRef),
      validateSenderCertificateOp: jest.fn(async () => true),
      deserializeIdentityKeyPair: jest.fn(async () => ({
        serialize: () => new Uint8Array(),
        publicKey: () => ({ serialize: () => serverKeyBytes }),
        privateKey: () => ({ serialize: () => new Uint8Array() }),
      })),
      deserializePublicKey: jest.fn(async () => ({ serialize: () => sigKeyBytes })),
    },
  }
})

describe('SenderCertificate', () => {
  test('deserialize exposes the cert getters', async () => {
    const cert = await SenderCertificate.deserialize(senderCertBytes)
    expect(cert.serialize()).toEqual(senderCertBytes)
    expect(cert.senderUuid()).toBe('aaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(cert.senderE164()).toBe('+15555550100')
    expect(cert.senderDeviceId()).toBe(1)
    expect(cert.expiration()).toBe(1_700_000_000_000)
    expect((await cert.signatureKey()).serialize()).toEqual(sigKeyBytes)
    expect((await cert.serverCertificate()).serialize()).toEqual(serverCertBytes)
  })

  test('generate calls the native op with positional bytes', async () => {
    const trustRoot = await IdentityKeyPair.deserialize(new Uint8Array())
    const serverKey = await PublicKey.deserialize(new Uint8Array())
    const serverCert = await ServerCertificate.generate({ keyId: 1, serverKey, trustRoot })
    const senderKey = await PublicKey.deserialize(new Uint8Array())
    const cert = await SenderCertificate.generate({
      senderUuid: 'aaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      senderE164: '+15555550100',
      senderDeviceId: 1,
      senderKey,
      expiration: 1_700_000_000_000,
      serverCert,
      serverKey: trustRoot.privateKey(),
    })
    expect(cert.serialize()).toEqual(senderCertBytes)
  })

  test('validate delegates to the native op', async () => {
    const cert = await SenderCertificate.deserialize(senderCertBytes)
    const trustRoot = await PublicKey.deserialize(new Uint8Array())
    expect(await cert.validate(trustRoot, 1_699_999_999_999)).toBe(true)
  })
})
