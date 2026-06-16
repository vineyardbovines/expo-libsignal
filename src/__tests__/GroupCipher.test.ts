import { GroupCipher } from '../core/GroupCipher'
import { ProtocolAddress } from '../core/ProtocolAddress'
import { SenderKeyRecord } from '../core/SenderKeyRecord'
import { SenderKeyNotFoundError } from '../errors'

const DISTRIBUTION_ID = '11111111-2222-3333-4444-555555555555'

const recordBytes = new Uint8Array([0x55, 0x55])
const ciphertextBytes = new Uint8Array([0x99])
const plaintextBytes = new Uint8Array([0x68, 0x69]) // "hi"

jest.mock('../ExpoLibsignalModule', () => ({
  NativeModule: {
    groupEncryptOp: jest.fn(async () => ({ ciphertext: ciphertextBytes, newRecord: recordBytes })),
    groupDecryptOp: jest.fn(async () => ({ plaintext: plaintextBytes, newRecord: recordBytes })),
    deserializeSenderKeyRecord: jest.fn(async () => ({ serialize: () => recordBytes })),
    createProtocolAddress: jest.fn(async (name: string, deviceId: number) => ({
      name: () => name,
      deviceId: () => deviceId,
    })),
  },
}))

describe('GroupCipher', () => {
  test('encrypt looks up the record, calls native, stores the rotated record', async () => {
    const stored: Array<{ name: string; id: string }> = []
    const store = {
      loadSenderKey: jest.fn(async () => SenderKeyRecord.deserialize(recordBytes)),
      storeSenderKey: jest.fn(async (addr, id) => {
        stored.push({ name: addr.name(), id })
      }),
    }
    const sender = await ProtocolAddress.create('alice', 1)
    const cipher = new GroupCipher(store, sender)
    const out = await cipher.encrypt(DISTRIBUTION_ID, new Uint8Array([0x68, 0x69]))
    expect(out).toEqual(ciphertextBytes)
    expect(stored).toEqual([{ name: 'alice', id: DISTRIBUTION_ID }])
  })

  test('encrypt throws if no record is in the store', async () => {
    const store = {
      loadSenderKey: jest.fn(async () => null),
      storeSenderKey: jest.fn(),
    }
    const sender = await ProtocolAddress.create('alice', 1)
    const cipher = new GroupCipher(store, sender)
    await expect(cipher.encrypt(DISTRIBUTION_ID, new Uint8Array())).rejects.toThrow(
      SenderKeyNotFoundError,
    )
  })

  test('decrypt looks up by sender, calls native, stores the rotated record', async () => {
    const stored: Array<{ name: string }> = []
    const store = {
      loadSenderKey: jest.fn(async () => SenderKeyRecord.deserialize(recordBytes)),
      storeSenderKey: jest.fn(async (addr) => {
        stored.push({ name: addr.name() })
      }),
    }
    const sender = await ProtocolAddress.create('bob', 1)
    const cipher = new GroupCipher(store, sender)
    const out = await cipher.decrypt(DISTRIBUTION_ID, ciphertextBytes)
    expect(out).toEqual(plaintextBytes)
    expect(stored).toEqual([{ name: 'bob' }])
  })

  test('decrypt throws if no record is in the store', async () => {
    const store = {
      loadSenderKey: jest.fn(async () => null),
      storeSenderKey: jest.fn(),
    }
    const sender = await ProtocolAddress.create('bob', 1)
    const cipher = new GroupCipher(store, sender)
    await expect(cipher.decrypt(DISTRIBUTION_ID, ciphertextBytes)).rejects.toThrow(
      SenderKeyNotFoundError,
    )
  })
})
