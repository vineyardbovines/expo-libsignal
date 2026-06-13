const getItemAsync = jest.fn<Promise<string | null>, [string, Record<string, unknown>?]>()
const setItemAsync = jest.fn<Promise<void>, [string, string, Record<string, unknown>?]>()
const deleteItemAsync = jest.fn<Promise<void>, [string, Record<string, unknown>?]>()

jest.mock(
  'expo-secure-store',
  () => ({
    getItemAsync,
    setItemAsync,
    deleteItemAsync,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
  }),
  { virtual: true },
)

jest.mock('../ExpoLibsignalModule', () => ({
  NativeModule: {
    generateRandomBytes: jest.fn(async (n: number) => new Uint8Array(n).fill(0xab)),
  },
}))

import { StoreError } from '../errors'
import { deleteDatabaseKey, resolveDatabaseKey, toHex } from '../stores/keys'

beforeEach(() => {
  jest.clearAllMocks()
  getItemAsync.mockResolvedValue(null)
  setItemAsync.mockResolvedValue(undefined)
  deleteItemAsync.mockResolvedValue(undefined)
})

describe('resolveDatabaseKey', () => {
  test('generates, hex-encodes, and stores a 32-byte key on first open', async () => {
    const key = await resolveDatabaseKey({ keyAlias: 'test.dbkey' })
    expect(key).toBe('ab'.repeat(32))
    expect(setItemAsync).toHaveBeenCalledWith('test.dbkey', 'ab'.repeat(32), {
      keychainService: 'test.dbkey',
      keychainAccessible: 7,
      requireAuthentication: false,
    })
  })

  test('returns the existing key without writing', async () => {
    getItemAsync.mockResolvedValue('deadbeef')
    const key = await resolveDatabaseKey({ keyAlias: 'test.dbkey' })
    expect(key).toBe('deadbeef')
    expect(setItemAsync).not.toHaveBeenCalled()
  })

  test('passes a keychainAccessible override through', async () => {
    await resolveDatabaseKey({ keyAlias: 'test.dbkey', keychainAccessible: 3 })
    expect(setItemAsync.mock.calls[0]?.[2]).toMatchObject({ keychainAccessible: 3 })
  })

  test('keyProvider bypasses secure-store entirely', async () => {
    const key = await resolveDatabaseKey({
      keyAlias: 'unused',
      keyProvider: async () => 'from-provider',
    })
    expect(key).toBe('from-provider')
    expect(getItemAsync).not.toHaveBeenCalled()
    expect(setItemAsync).not.toHaveBeenCalled()
  })

  test('an empty keyProvider result throws StoreError', async () => {
    await expect(
      resolveDatabaseKey({ keyAlias: 'unused', keyProvider: async () => '' }),
    ).rejects.toBeInstanceOf(StoreError)
  })
})

describe('deleteDatabaseKey', () => {
  test('deletes under the same keychainService', async () => {
    await deleteDatabaseKey('test.dbkey')
    expect(deleteItemAsync).toHaveBeenCalledWith('test.dbkey', { keychainService: 'test.dbkey' })
  })
})

describe('toHex', () => {
  test('zero-pads bytes', () => {
    expect(toHex(new Uint8Array([0, 1, 255]))).toBe('0001ff')
  })
})
