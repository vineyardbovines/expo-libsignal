import type {
  Direction,
  IdentityChange,
  IdentityKey,
  IdentityKeyPair,
  IdentityKeyStore,
  KyberPreKeyRecord,
  KyberPreKeyStore,
  PreKeyRecord,
  PreKeyStore,
  ProtocolAddress,
  SessionRecord,
  SessionStore,
  SignedPreKeyRecord,
  SignedPreKeyStore,
} from 'expo-libsignal'
import { InvalidKeyError } from 'expo-libsignal'

const addrKey = (a: ProtocolAddress) => `${a.name()}.${a.deviceId()}`

export class InMemoryProtocolStore
  implements IdentityKeyStore, SessionStore, PreKeyStore, SignedPreKeyStore, KyberPreKeyStore
{
  private readonly identityKeyPair: IdentityKeyPair
  private readonly registrationId: number
  private readonly identities = new Map<string, IdentityKey>()
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly preKeys = new Map<number, PreKeyRecord>()
  private readonly signedPreKeys = new Map<number, SignedPreKeyRecord>()
  private readonly kyberPreKeys = new Map<number, KyberPreKeyRecord>()
  private readonly usedKyberPreKeys = new Set<number>()

  constructor(identityKeyPair: IdentityKeyPair, registrationId: number) {
    this.identityKeyPair = identityKeyPair
    this.registrationId = registrationId
  }

  // IdentityKeyStore

  async getIdentityKeyPair(): Promise<IdentityKeyPair> {
    return this.identityKeyPair
  }

  async getLocalRegistrationId(): Promise<number> {
    return this.registrationId
  }

  async saveIdentity(address: ProtocolAddress, key: IdentityKey): Promise<IdentityChange> {
    const k = addrKey(address)
    const existing = this.identities.get(k)
    this.identities.set(k, key)
    if (existing === undefined) return 'newOrUnchanged'
    return bytesEqual(existing.serialize(), key.serialize())
      ? 'newOrUnchanged'
      : 'replacedExisting'
  }

  async isTrustedIdentity(
    address: ProtocolAddress,
    key: IdentityKey,
    _direction: Direction,
  ): Promise<boolean> {
    const existing = this.identities.get(addrKey(address))
    return existing === undefined || bytesEqual(existing.serialize(), key.serialize())
  }

  async getIdentity(address: ProtocolAddress): Promise<IdentityKey | null> {
    return this.identities.get(addrKey(address)) ?? null
  }

  // SessionStore

  async loadSession(address: ProtocolAddress): Promise<SessionRecord | null> {
    return this.sessions.get(addrKey(address)) ?? null
  }

  async storeSession(address: ProtocolAddress, record: SessionRecord): Promise<void> {
    this.sessions.set(addrKey(address), record)
  }

  // PreKeyStore

  async loadPreKey(id: number): Promise<PreKeyRecord> {
    const r = this.preKeys.get(id)
    if (r === undefined) throw new InvalidKeyError(`no prekey with id ${id}`)
    return r
  }

  async storePreKey(id: number, record: PreKeyRecord): Promise<void> {
    this.preKeys.set(id, record)
  }

  async removePreKey(id: number): Promise<void> {
    this.preKeys.delete(id)
  }

  // SignedPreKeyStore

  async loadSignedPreKey(id: number): Promise<SignedPreKeyRecord> {
    const r = this.signedPreKeys.get(id)
    if (r === undefined) throw new InvalidKeyError(`no signed prekey with id ${id}`)
    return r
  }

  async storeSignedPreKey(id: number, record: SignedPreKeyRecord): Promise<void> {
    this.signedPreKeys.set(id, record)
  }

  // KyberPreKeyStore

  async loadKyberPreKey(id: number): Promise<KyberPreKeyRecord> {
    const r = this.kyberPreKeys.get(id)
    if (r === undefined) throw new InvalidKeyError(`no kyber prekey with id ${id}`)
    return r
  }

  async loadKyberPreKeys(): Promise<KyberPreKeyRecord[]> {
    return [...this.kyberPreKeys.values()]
  }

  async storeKyberPreKey(id: number, record: KyberPreKeyRecord): Promise<void> {
    this.kyberPreKeys.set(id, record)
  }

  async markKyberPreKeyUsed(id: number): Promise<void> {
    this.usedKyberPreKeys.add(id)
  }

  // Test helpers (not part of any interface)

  hasPreKey(id: number): boolean {
    return this.preKeys.has(id)
  }

  isKyberPreKeyUsed(id: number): boolean {
    return this.usedKyberPreKeys.has(id)
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
