import { SenderKeyDistributionMessage } from '../core/SenderKeyDistributionMessage'

jest.mock('../ExpoLibsignalModule', () => {
  const skdmBytes = new Uint8Array([0x33, 0x33, 0x33])
  const ref = {
    serialize: () => skdmBytes,
    distributionId: () => 'aaaa-1111-2222-3333-444444444444',
    chainId: () => 7,
    iteration: () => 0,
  }
  return {
    NativeModule: {
      deserializeSenderKeyDistributionMessage: jest.fn(async () => ref),
    },
  }
})

describe('SenderKeyDistributionMessage', () => {
  test('deserialize then serialize round-trips through the ref', async () => {
    const msg = await SenderKeyDistributionMessage.deserialize(new Uint8Array([0x33, 0x33, 0x33]))
    expect(msg.serialize()).toEqual(new Uint8Array([0x33, 0x33, 0x33]))
    expect(msg.distributionId()).toBe('aaaa-1111-2222-3333-444444444444')
    expect(msg.chainId()).toBe(7)
    expect(msg.iteration()).toBe(0)
  })
})
