import { GroupSessionBuilder } from '../core/GroupSessionBuilder'
import { ProtocolAddress } from '../core/ProtocolAddress'
import { SenderKeyDistributionMessage } from '../core/SenderKeyDistributionMessage'

const DISTRIBUTION_ID = '11111111-2222-3333-4444-555555555555'

const skdmBytes = new Uint8Array([0x77, 0x77])
const recordBytes = new Uint8Array([0x55, 0x55])

jest.mock('../ExpoLibsignalModule', () => ({
  NativeModule: {
    createSenderKeyDistributionOp: jest.fn(async () => ({
      message: skdmBytes,
      newRecord: recordBytes,
    })),
    processSenderKeyDistributionOp: jest.fn(async () => ({
      newRecord: recordBytes,
    })),
    deserializeSenderKeyDistributionMessage: jest.fn(async () => ({
      serialize: () => skdmBytes,
      distributionId: () => DISTRIBUTION_ID,
      chainId: () => 0,
      iteration: () => 0,
    })),
    deserializeSenderKeyRecord: jest.fn(async () => ({
      serialize: () => recordBytes,
    })),
    createProtocolAddress: jest.fn(async (name: string, deviceId: number) => ({
      name: () => name,
      deviceId: () => deviceId,
    })),
  },
}))

describe('GroupSessionBuilder', () => {
  test('createSenderKeyDistributionMessage stores the new record and returns the SKDM', async () => {
    const calls: Array<{ name: string; deviceId: number; id: string }> = []
    const stored: Array<{ name: string; deviceId: number; id: string; bytes: Uint8Array }> = []
    const store = {
      loadSenderKey: jest.fn(async (addr, id) => {
        calls.push({ name: addr.name(), deviceId: addr.deviceId(), id })
        return null
      }),
      storeSenderKey: jest.fn(async (addr, id, rec) => {
        stored.push({ name: addr.name(), deviceId: addr.deviceId(), id, bytes: rec.serialize() })
      }),
    }
    const builder = new GroupSessionBuilder(store)
    const sender = await ProtocolAddress.create('alice', 1)
    const message = await builder.createSenderKeyDistributionMessage(sender, DISTRIBUTION_ID)
    expect(message).toBeInstanceOf(SenderKeyDistributionMessage)
    expect(message.distributionId()).toBe(DISTRIBUTION_ID)
    expect(calls).toEqual([{ name: 'alice', deviceId: 1, id: DISTRIBUTION_ID }])
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ name: 'alice', deviceId: 1, id: DISTRIBUTION_ID })
  })

  test('processSenderKeyDistributionMessage stores the new record', async () => {
    const stored: Array<{ name: string; id: string }> = []
    const store = {
      loadSenderKey: jest.fn(async () => null),
      storeSenderKey: jest.fn(async (addr, id) => {
        stored.push({ name: addr.name(), id })
      }),
    }
    const builder = new GroupSessionBuilder(store)
    const sender = await ProtocolAddress.create('bob', 2)
    const message = await SenderKeyDistributionMessage.deserialize(skdmBytes)
    await builder.processSenderKeyDistributionMessage(sender, message)
    expect(stored).toEqual([{ name: 'bob', id: DISTRIBUTION_ID }])
  })
})
