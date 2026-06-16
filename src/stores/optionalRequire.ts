import { StoreError } from '../errors'
import type { SqlModule } from './sqlTypes'

// expo-sqlite and expo-secure-store are optional peer dependencies, resolved
// lazily so the main package entry never references them. This module is only
// reachable from the 'expo-libsignal/stores' subpath.
declare const require: (id: string) => unknown

export interface SecureStoreModule {
  getItemAsync(key: string, options?: Record<string, unknown>): Promise<string | null>
  setItemAsync(key: string, value: string, options?: Record<string, unknown>): Promise<void>
  deleteItemAsync(key: string, options?: Record<string, unknown>): Promise<void>
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: number
}

export function requireExpoSqlite(): SqlModule {
  try {
    return require('expo-sqlite') as SqlModule
  } catch {
    throw new StoreError(
      "SQLCipherProtocolStore requires 'expo-sqlite'. Install it and add " +
        '{ "useSQLCipher": true } to the expo-sqlite plugin in your app.json, then rebuild.',
    )
  }
}

export function requireSecureStore(): SecureStoreModule {
  try {
    return require('expo-secure-store') as SecureStoreModule
  } catch {
    throw new StoreError(
      "SQLCipherProtocolStore requires 'expo-secure-store' for database key storage. " +
        'Install it, or pass a keyProvider in the options.',
    )
  }
}
