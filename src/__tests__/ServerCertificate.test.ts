import { IdentityKeyPair } from '../core/IdentityKeyPair'
import { PublicKey } from '../core/PublicKey'
import { ServerCertificate } from '../core/ServerCertificate'

const certBytes = new Uint8Array([0xa1, 0xa2])
const sigBytes = new Uint8Array([0xb1, 0xb2])
const keyBytes = new Uint8Array([0xc1, 0xc2])

jest.mock('../ExpoLibsignalModule', () => {
  const ref = {
    serialize: () => certBytes,
    keyId: () => 99,
    signature: () => sigBytes,
    key: () => ({ serialize: () => keyBytes }),
  }
  return {
    NativeModule: {
      generateServerCertificateOp: jest.fn(async () => ({ certificate: certBytes })),
      deserializeServerCertificate: jest.fn(async () => ref),
      deserializeIdentityKeyPair: jest.fn(async () => ({
        serialize: () => new Uint8Array(),
        publicKey: () => ({ serialize: () => keyBytes }),
        privateKey: () => ({ serialize: () => new Uint8Array() }),
      })),
      deserializePublicKey: jest.fn(async () => ({ serialize: () => keyBytes })),
    },
  }
})

describe('ServerCertificate', () => {
  test('generate calls the native op with positional bytes and returns a ref', async () => {
    const trustRoot = await IdentityKeyPair.deserialize(new Uint8Array())
    const serverKey = await PublicKey.deserialize(new Uint8Array())
    const cert = await ServerCertificate.generate({ keyId: 99, serverKey, trustRoot })
    expect(cert.serialize()).toEqual(certBytes)
    expect(cert.keyId()).toBe(99)
    expect(cert.signature()).toEqual(sigBytes)
    expect((await cert.key()).serialize()).toEqual(keyBytes)
  })

  test('deserialize round-trips through the ref', async () => {
    const cert = await ServerCertificate.deserialize(certBytes)
    expect(cert.serialize()).toEqual(certBytes)
    expect(cert.keyId()).toBe(99)
  })
})
