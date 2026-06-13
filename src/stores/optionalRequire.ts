import { StoreError } from '../errors'
import type { OpSqliteModule } from './opSqliteTypes'

// op-sqlite and expo-secure-store are optional peer dependencies, resolved
// lazily so the main package entry never references them. This module is only
// reachable from the 'expo-libsignal/stores' subpath.
declare const require: (id: string) => unknown

export interface SecureStoreModule {
  getItemAsync(key: string, options?: Record<string, unknown>): Promise<string | null>
  setItemAsync(key: string, value: string, options?: Record<string, unknown>): Promise<void>
  deleteItemAsync(key: string, options?: Record<string, unknown>): Promise<void>
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: number
}

export function requireOpSqlite(): OpSqliteModule {
  try {
    return require('@op-engineering/op-sqlite') as OpSqliteModule
  } catch {
    throw new StoreError(
      "SQLCipherProtocolStore requires '@op-engineering/op-sqlite'. Install it and add " +
        '{ "op-sqlite": { "sqlcipher": true } } to your app package.json, then rebuild.',
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
