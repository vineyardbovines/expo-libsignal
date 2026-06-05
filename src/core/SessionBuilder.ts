import { NativeModule } from '../ExpoLibsignalModule'
import { fromNative } from '../errors'
import { IdentityKey } from './IdentityKeyPair'
import type { PreKeyBundle } from './PreKeyBundle'
import type { ProtocolAddress } from './ProtocolAddress'
import { SessionRecord } from './SessionRecord'
import type { IdentityKeyStore, SessionStore } from './stores'

export interface SessionBuilderStores {
  sessionStore: SessionStore
  identityStore: IdentityKeyStore
}

export class SessionBuilder {
  private readonly stores: SessionBuilderStores
  private readonly remote: ProtocolAddress
  private readonly local: ProtocolAddress

  constructor(stores: SessionBuilderStores, remote: ProtocolAddress, local: ProtocolAddress) {
    this.stores = stores
    this.remote = remote
    this.local = local
  }

  async processPreKeyBundle(bundle: PreKeyBundle): Promise<void> {
    const { sessionStore, identityStore } = this.stores
    const ourIdentityKeyPair = await identityStore.getIdentityKeyPair()
    const ourRegistrationId = await identityStore.getLocalRegistrationId()
    const existingSession = await sessionStore.loadSession(this.remote)
    const existingRemoteIdentity = await identityStore.getIdentity(this.remote)

    let result: {
      newSession: unknown
      identityChange: 'newOrUnchanged' | 'replacedExisting'
      trustedRemoteIdentity: unknown
    }
    try {
      result = await NativeModule.processPreKeyBundleOp({
        bundle,
        remoteAddress: this.remote,
        localAddress: this.local,
        ourIdentityKeyPair,
        ourRegistrationId,
        existingSession,
        existingRemoteIdentity,
        nowMs: Date.now(),
      })
    } catch (e) {
      throw rethrowAsLibsignal(e)
    }

    const newSession = new SessionRecord(result.newSession as never)
    const trustedRemoteIdentity = new IdentityKey(result.trustedRemoteIdentity as never)

    await sessionStore.storeSession(this.remote, newSession)
    await identityStore.saveIdentity(this.remote, trustedRemoteIdentity)
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
