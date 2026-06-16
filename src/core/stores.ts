import type { IdentityKey, IdentityKeyPair } from './IdentityKeyPair'
import type { KyberPreKeyRecord } from './KyberPreKeyRecord'
import type { PreKeyRecord } from './PreKeyRecord'
import type { ProtocolAddress } from './ProtocolAddress'
import type { SenderKeyRecord } from './SenderKeyRecord'
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
  /**
   * Return every stored prekey. Sealed Sender decrypt seeds every candidate
   * prekey because the in-envelope ids only surface after decryption begins.
   * Matches upstream libsignal-java's PreKeyStore enumeration surface.
   */
  loadPreKeys(): Promise<PreKeyRecord[]>
  storePreKey(id: number, record: PreKeyRecord): Promise<void>
  removePreKey(id: number): Promise<void>
}

export interface SignedPreKeyStore {
  loadSignedPreKey(id: number): Promise<SignedPreKeyRecord>
  /**
   * Return every stored signed prekey. Sealed Sender decrypt seeds every
   * candidate signed prekey because the in-envelope ids only surface after
   * decryption begins.
   */
  loadSignedPreKeys(): Promise<SignedPreKeyRecord[]>
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

export interface SenderKeyStore {
  /**
   * Load the SenderKeyRecord for (sender, distributionId), or null if none.
   * Called before encrypt/decrypt to feed the ratchet state into the native op.
   */
  loadSenderKey(sender: ProtocolAddress, distributionId: string): Promise<SenderKeyRecord | null>
  /**
   * Persist the SenderKeyRecord returned by the native op after every
   * createSenderKeyDistributionMessage / processSenderKeyDistributionMessage /
   * groupEncrypt / groupDecrypt call.
   */
  storeSenderKey(
    sender: ProtocolAddress,
    distributionId: string,
    record: SenderKeyRecord,
  ): Promise<void>
}
