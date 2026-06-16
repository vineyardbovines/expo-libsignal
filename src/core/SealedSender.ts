import { NativeModule } from '../ExpoLibsignalModule'
import { rethrowAsLibsignal, SessionNotFoundError } from '../errors'
import { ProtocolAddress } from './ProtocolAddress'
import type { PublicKey } from './PublicKey'
import { encodeRecordList } from './recordList'
import type { SenderCertificate } from './SenderCertificate'
import type { SessionCipherStores } from './SessionCipher'
import { SessionRecord } from './SessionRecord'
import type { IdentityKeyStore, SessionStore } from './stores'

export interface SealedSenderEncryptArgs {
  destination: ProtocolAddress
  senderCert: SenderCertificate
  message: Uint8Array
  sessionStore: SessionStore
  identityStore: IdentityKeyStore
}

export interface SealedSenderDecryptArgs {
  ciphertext: Uint8Array
  trustRoot: PublicKey
  timestamp: number
  localUuid: string
  localE164?: string
  localDeviceId: number
  stores: SessionCipherStores
}

export interface SealedSenderDecryptResult {
  message: Uint8Array
  senderUuid: string
  senderE164: string | null
  senderDeviceId: number
}

export const SealedSender = {
  async encrypt(args: SealedSenderEncryptArgs): Promise<Uint8Array> {
    const { destination, senderCert, message, sessionStore, identityStore } = args
    const ourIdentityKeyPair = await identityStore.getIdentityKeyPair()
    const ourRegistrationId = await identityStore.getLocalRegistrationId()
    const existingSession = await sessionStore.loadSession(destination)
    if (existingSession === null) {
      throw new SessionNotFoundError(
        `no session for ${destination.name()}.${destination.deviceId()}`,
      )
    }
    const remoteIdentity = await identityStore.getIdentity(destination)
    let result: {
      ciphertext: Uint8Array
      newSession: Uint8Array
      identityChange: 'newOrUnchanged' | 'replacedExisting' | null
    }
    try {
      result = await NativeModule.sealedSenderEncryptOp(
        {
          destinationName: destination.name(),
          destinationDeviceId: destination.deviceId(),
          ourRegistrationId,
          nowMs: Date.now(),
        },
        senderCert.serialize(),
        message,
        existingSession.serialize(),
        remoteIdentity ? remoteIdentity.serialize() : null,
        ourIdentityKeyPair.serialize(),
      )
    } catch (e) {
      throw rethrowAsLibsignal(e)
    }
    const newSession = await SessionRecord.deserialize(result.newSession)
    await sessionStore.storeSession(destination, newSession)
    if (remoteIdentity !== null) {
      await identityStore.saveIdentity(destination, remoteIdentity)
    }
    return result.ciphertext
  },

  async decryptMessage(args: SealedSenderDecryptArgs): Promise<SealedSenderDecryptResult> {
    const { ciphertext, trustRoot, timestamp, localUuid, localDeviceId, stores } = args
    const { sessionStore, identityStore, preKeyStore, signedPreKeyStore, kyberPreKeyStore } = stores
    const ourIdentityKeyPair = await identityStore.getIdentityKeyPair()
    const ourRegistrationId = await identityStore.getLocalRegistrationId()
    const preKeys = await preKeyStore.loadPreKeys()
    const signedPreKeys = await signedPreKeyStore.loadSignedPreKeys()
    const kyberPreKeys = await kyberPreKeyStore.loadKyberPreKeys()
    const preKeysBlob = encodeRecordList(preKeys.map((k) => k.serialize()))
    const signedPreKeysBlob = encodeRecordList(signedPreKeys.map((k) => k.serialize()))
    const kyberPreKeysBlob = encodeRecordList(kyberPreKeys.map((k) => k.serialize()))

    let result: {
      plaintext: Uint8Array
      senderUuid: string
      senderE164: string | null
      senderDeviceId: number
      newSession: Uint8Array
      identityChange: 'newOrUnchanged' | 'replacedExisting' | null
      consumedPreKeyId: number | null
      kyberPreKeyId: number | null
    }
    try {
      result = await NativeModule.sealedSenderDecryptOp(
        {
          localUuid,
          localE164: args.localE164 ?? null,
          localDeviceId,
          ourRegistrationId,
          timestamp,
          nowMs: Date.now(),
        },
        ciphertext,
        trustRoot.serialize(),
        ourIdentityKeyPair.serialize(),
        kyberPreKeysBlob,
        preKeysBlob,
        signedPreKeysBlob,
      )
    } catch (e) {
      throw rethrowAsLibsignal(e)
    }

    // Persist rotated session under the *real* sender address recovered from
    // the cert. The caller used `localUuid` to label themselves; the remote
    // identity surfaces from the sealed envelope.
    const remoteAddress = await ProtocolAddress.create(result.senderUuid, result.senderDeviceId)
    const newSession = await SessionRecord.deserialize(result.newSession)
    await sessionStore.storeSession(remoteAddress, newSession)

    if (result.consumedPreKeyId !== null) {
      await preKeyStore.removePreKey(result.consumedPreKeyId)
    }
    if (result.kyberPreKeyId !== null) {
      await kyberPreKeyStore.markKyberPreKeyUsed(result.kyberPreKeyId)
    }

    return {
      message: result.plaintext,
      senderUuid: result.senderUuid,
      senderE164: result.senderE164,
      senderDeviceId: result.senderDeviceId,
    }
  },
}
