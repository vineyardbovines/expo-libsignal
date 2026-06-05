import { ProtocolAddress } from '../core/ProtocolAddress'

describe('ProtocolAddress validation', () => {
  it('rejects deviceId below 1', async () => {
    await expect(ProtocolAddress.create('alice', 0)).rejects.toThrow(/deviceId/)
  })

  it('rejects deviceId above 127', async () => {
    await expect(ProtocolAddress.create('alice', 128)).rejects.toThrow(/deviceId/)
  })

  it('rejects non-integer deviceId', async () => {
    await expect(ProtocolAddress.create('alice', 1.5)).rejects.toThrow(/deviceId/)
  })

  it('rejects empty name', async () => {
    await expect(ProtocolAddress.create('', 1)).rejects.toThrow(/name/)
  })
})
