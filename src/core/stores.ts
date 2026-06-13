import type { IdentityKey, IdentityKeyPair } from './IdentityKeyPair'
import type { KyberPreKeyRecord } from './KyberPreKeyRecord'
import type { PreKeyRecord } from './PreKeyRecord'
import type { ProtocolAddress } from './ProtocolAddress'
import type { SessionRecord } from './SessionRecord'
import type { SignedPreKeyRecord } from './SignedPreKeyRecord'

export type Direction = 'sending' | 'receiving'
export type IdentityChange = 'newOrUnchanged' | 'replacedExisting'

export interface IdentityKeyStore {
  getIdentityKeyPair(): Promise<IdentityKeyPair>
  getLocalRegistrationId(): Promise<number>
  saveIdentity(address: ProtocolAddress, key: IdentityKey): Promise<IdentityChange>
  isTrustedIdentity(
    address: ProtocolAddress,
    key: IdentityKey,
    direction: Direction,
  ): Promise<boolean>
  getIdentity(address: ProtocolAddress): Promise<IdentityKey | null>
}

export interface SessionStore {
  loadSession(address: ProtocolAddress): Promise<SessionRecord | null>
  storeSession(address: ProtocolAddress, record: SessionRecord): Promise<void>
}

export interface PreKeyStore {
  loadPreKey(id: number): Promise<PreKeyRecord>
  storePreKey(id: number, record: PreKeyRecord): Promise<void>
  removePreKey(id: number): Promise<void>
}

export interface SignedPreKeyStore {
  loadSignedPreKey(id: number): Promise<SignedPreKeyRecord>
  storeSignedPreKey(id: number, record: SignedPreKeyRecord): Promise<void>
}

export interface KyberPreKeyStore {
  loadKyberPreKey(id: number): Promise<KyberPreKeyRecord>
  /**
   * Return every stored kyber prekey. libsignal 0.94.4 does not expose the
   * kyber prekey id on PreKeySignalMessage, so decryptPreKeySignal seeds the
   * native op with all of them and libsignal resolves the id internally.
   * Matches upstream libsignal-java's KyberPreKeyStore.loadKyberPreKeys().
   */
  loadKyberPreKeys(): Promise<KyberPreKeyRecord[]>
  storeKyberPreKey(id: number, record: KyberPreKeyRecord): Promise<void>
  markKyberPreKeyUsed(id: number): Promise<void>
}
