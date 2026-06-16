import { NativeModule } from '../ExpoLibsignalModule'
import type { IdentityKeyPair } from './IdentityKeyPair'
import { PublicKey } from './PublicKey'

interface ServerCertificateRef {
  serialize(): Uint8Array
  keyId(): number
  signature(): Uint8Array
  key(): unknown
}

/**
 * Trust-root-signed certificate binding a server-side signing key to a key id.
 * The server presents this to clients alongside a SenderCertificate it issues.
 * Production callers receive it from a server and only ever call deserialize;
 * generate exists to mint test certs.
 */
export class ServerCertificate {
  private readonly ref: ServerCertificateRef

  private constructor(ref: ServerCertificateRef) {
    this.ref = ref
  }

  static async generate(opts: {
    keyId: number
    serverKey: PublicKey
    trustRoot: IdentityKeyPair
  }): Promise<ServerCertificate> {
    const result = (await NativeModule.generateServerCertificateOp(
      opts.keyId,
      opts.serverKey.serialize(),
      opts.trustRoot.serialize(),
    )) as { certificate: Uint8Array }
    return ServerCertificate.deserialize(result.certificate)
  }

  static async deserialize(bytes: Uint8Array): Promise<ServerCertificate> {
    const ref = (await NativeModule.deserializeServerCertificate(bytes)) as ServerCertificateRef
    return new ServerCertificate(ref)
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }

  keyId(): number {
    return this.ref.keyId()
  }

  signature(): Uint8Array {
    return this.ref.signature()
  }

  async key(): Promise<PublicKey> {
    return new PublicKey(this.ref.key() as ConstructorParameters<typeof PublicKey>[0])
  }

  /** @internal */
  _ref(): ServerCertificateRef {
    return this.ref
  }
}
