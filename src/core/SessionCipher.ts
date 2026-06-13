import { NativeModule } from '../ExpoLibsignalModule'
import { fromNative, SessionNotFoundError } from '../errors'
import { type CiphertextMessage, PreKeySignalMessage, SignalMessage } from './messages'
import type { ProtocolAddress } from './ProtocolAddress'
import { encodeRecordList } from './recordList'
import { SessionRecord } from './SessionRecord'
import type {
  IdentityKeyStore,
  KyberPreKeyStore,
  PreKeyStore,
  SessionStore,
  SignedPreKeyStore,
} from './stores'

export interface SessionCipherStores {
  sessionStore: SessionStore
  identityStore: IdentityKeyStore
  preKeyStore: PreKeyStore
  signedPreKeyStore: SignedPreKeyStore
  kyberPreKeyStore: KyberPreKeyStore
}

export class SessionCipher {
  private readonly stores: SessionCipherStores
  private readonly remote: ProtocolAddress
  private readonly local: ProtocolAddress

  constructor(stores: SessionCipherStores, remote: ProtocolAddress, local: ProtocolAddress) {
    this.stores = stores
    this.remote = remote
    this.local = local
  }

  private opConfig(ourRegistrationId: number) {
    return {
      remoteName: this.remote.name(),
      remoteDeviceId: this.remote.deviceId(),
      localName: this.local.name(),
      localDeviceId: this.local.deviceId(),
      ourRegistrationId,
      nowMs: Date.now(),
    }
  }

  async encrypt(plaintext: Uint8Array): Promise<CiphertextMessage> {
    const { sessionStore, identityStore } = this.stores
    const ourIdentityKeyPair = await identityStore.getIdentityKeyPair()
    const ourRegistrationId = await identityStore.getLocalRegistrationId()
    const existingSession = await sessionStore.loadSession(this.remote)
    if (existingSession === null) {
      throw new SessionNotFoundError(
        `no session for ${this.remote.name()}.${this.remote.deviceId()}`,
      )
    }
    const remoteIdentity = await identityStore.getIdentity(this.remote)

    let result: {
      messageType: 'preKeySignal' | 'signal'
      preKeySignalMessage: Uint8Array | null
      signalMessage: Uint8Array | null
      newSession: Uint8Array
      identityChange: 'newOrUnchanged' | 'replacedExisting' | null
    }
    try {
      // Byte payloads travel as positional arguments — Records cannot carry
      // SharedObjects or typed arrays on Android.
      result = await NativeModule.encryptOp(
        this.opConfig(ourRegistrationId),
        plaintext,
        ourIdentityKeyPair.serialize(),
        existingSession.serialize(),
        remoteIdentity ? remoteIdentity.serialize() : null,
      )
    } catch (e) {
      throw rethrowAsLibsignal(e)
    }

    const newSession = await SessionRecord.deserialize(result.newSession)
    await sessionStore.storeSession(this.remote, newSession)
    if (remoteIdentity !== null) {
      await identityStore.saveIdentity(this.remote, remoteIdentity)
    }

    if (result.messageType === 'preKeySignal' && result.preKeySignalMessage !== null) {
      return PreKeySignalMessage.deserialize(result.preKeySignalMessage)
    }
    if (result.messageType === 'signal' && result.signalMessage !== null) {
      return SignalMessage.deserialize(result.signalMessage)
    }
    throw new Error(`encryptOp returned unexpected shape: ${result.messageType}`)
  }

  async decryptPreKeySignal(message: PreKeySignalMessage): Promise<Uint8Array> {
    const { sessionStore, identityStore, preKeyStore, signedPreKeyStore, kyberPreKeyStore } =
      this.stores
    const ourIdentityKeyPair = await identityStore.getIdentityKeyPair()
    const ourRegistrationId = await identityStore.getLocalRegistrationId()
    const existingSession = await sessionStore.loadSession(this.remote)
    const existingRemoteIdentity = await identityStore.getIdentity(this.remote)

    const messagePreKeyId = message.preKeyId()
    const signedPreKeyId = message.signedPreKeyId()
    const preKey = messagePreKeyId === null ? null : await preKeyStore.loadPreKey(messagePreKeyId)
    const signedPreKey = await signedPreKeyStore.loadSignedPreKey(signedPreKeyId)

    // The kyber prekey id is not exposed on PreKeySignalMessage in libsignal
    // 0.94.4, so we seed the op with every stored kyber prekey (framed into
    // one positional blob) and libsignal resolves the id internally. The op
    // reports back which id it marked used; null means the decrypt completed
    // without consuming one (e.g. replay against an existing session).
    const kyberPreKeys = await kyberPreKeyStore.loadKyberPreKeys()
    const kyberPreKeysBlob = encodeRecordList(kyberPreKeys.map((k) => k.serialize()))

    let result: {
      plaintext: Uint8Array
      newSession: Uint8Array
      identityChange: 'newOrUnchanged' | 'replacedExisting' | null
      consumedPreKeyId: number | null
      kyberPreKeyId: number | null
    }
    try {
      result = await NativeModule.decryptPreKeySignalOp(
        this.opConfig(ourRegistrationId),
        message.serialize(),
        ourIdentityKeyPair.serialize(),
        existingSession ? existingSession.serialize() : null,
        existingRemoteIdentity ? existingRemoteIdentity.serialize() : null,
        preKey ? preKey.serialize() : null,
        signedPreKey.serialize(),
        kyberPreKeysBlob,
      )
    } catch (e) {
      throw rethrowAsLibsignal(e)
    }

    const newSession = await SessionRecord.deserialize(result.newSession)
    await sessionStore.storeSession(this.remote, newSession)

    if (result.consumedPreKeyId !== null) {
      await preKeyStore.removePreKey(result.consumedPreKeyId)
    }
    if (result.kyberPreKeyId !== null) {
      await kyberPreKeyStore.markKyberPreKeyUsed(result.kyberPreKeyId)
    }

    // Identity is already trusted as a side effect of the decrypt op; we
    // re-save through the JS store so the canonical state is updated.
    if (result.identityChange !== null && existingRemoteIdentity !== null) {
      await identityStore.saveIdentity(this.remote, existingRemoteIdentity)
    }

    return result.plaintext
  }

  async decryptSignal(message: SignalMessage): Promise<Uint8Array> {
    const { sessionStore, identityStore } = this.stores
    const ourIdentityKeyPair = await identityStore.getIdentityKeyPair()
    const ourRegistrationId = await identityStore.getLocalRegistrationId()
    const existingSession = await sessionStore.loadSession(this.remote)
    if (existingSession === null) {
      throw new SessionNotFoundError(
        `no session for ${this.remote.name()}.${this.remote.deviceId()}`,
      )
    }
    const remoteIdentity = await identityStore.getIdentity(this.remote)

    let result: {
      plaintext: Uint8Array
      newSession: Uint8Array
      identityChange: 'newOrUnchanged' | 'replacedExisting' | null
    }
    try {
      result = await NativeModule.decryptSignalOp(
        this.opConfig(ourRegistrationId),
        message.serialize(),
        ourIdentityKeyPair.serialize(),
        existingSession.serialize(),
        remoteIdentity ? remoteIdentity.serialize() : null,
      )
    } catch (e) {
      throw rethrowAsLibsignal(e)
    }

    const newSession = await SessionRecord.deserialize(result.newSession)
    await sessionStore.storeSession(this.remote, newSession)
    if (remoteIdentity !== null) {
      await identityStore.saveIdentity(this.remote, remoteIdentity)
    }
    return result.plaintext
  }
}

function rethrowAsLibsignal(e: unknown): Error {
  if (e instanceof Error && 'kind' in e) {
    return fromNative({
      kind: (e as { kind?: string }).kind ?? 'Generic',
      message: e.message,
    })
  }
  return e instanceof Error ? e : new Error(String(e))
}
