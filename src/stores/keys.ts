import { NativeModule } from '../ExpoLibsignalModule'
import { StoreError } from '../errors'
import { requireSecureStore } from './optionalRequire'

export interface ResolveKeyOptions {
  keyAlias: string
  keyProvider?: (() => Promise<string>) | undefined
  keychainAccessible?: number | undefined
}

// The SQLCipher key: 32 random bytes from the OS CSPRNG, hex-encoded, stored
// in the platform keychain/keystore via expo-secure-store. The hex string is
// fed to `PRAGMA key` as a SQLCipher passphrase (PBKDF2 runs over a string
// carrying 256 bits of entropy). A keyProvider bypasses secure-store for
// passphrase-derived keys.
export async function resolveDatabaseKey(options: ResolveKeyOptions): Promise<string> {
  if (options.keyProvider) {
    const key = await options.keyProvider()
    if (key.length === 0) throw new StoreError('keyProvider returned an empty key')
    return key
  }
  const SecureStore = requireSecureStore()
  const existing = await SecureStore.getItemAsync(options.keyAlias, {
    keychainService: options.keyAlias,
  })
  if (existing !== null) return existing
  const bytes: Uint8Array = await NativeModule.generateRandomBytes(32)
  const hex = toHex(bytes)
  await SecureStore.setItemAsync(options.keyAlias, hex, {
    keychainService: options.keyAlias,
    keychainAccessible: options.keychainAccessible ?? SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: false,
  })
  return hex
}

export async function deleteDatabaseKey(keyAlias: string): Promise<void> {
  const SecureStore = requireSecureStore()
  await SecureStore.deleteItemAsync(keyAlias, { keychainService: keyAlias })
}

export function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}
