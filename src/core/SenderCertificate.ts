import { NativeModule } from '../ExpoLibsignalModule'
import type { PrivateKey } from './IdentityKeyPair'
import { PublicKey } from './PublicKey'
import { ServerCertificate } from './ServerCertificate'

interface SenderCertificateRef {
  serialize(): Uint8Array
  senderUuid(): string
  senderE164(): string | null
  senderDeviceId(): number
  expiration(): number
  signatureKey(): unknown
  serverCertificate(): unknown
}

/**
 * Per-sender certificate issued by a server-cert holder. Carries the sender's
 * UUID, optional E.164, device id, signing key, and the issuing ServerCertificate.
 * SealedSender.decryptMessage validates the chain against a known trust-root
 * public key and the message timestamp internally; callers usually never need
 * to call validate themselves.
 */
export class SenderCertificate {
  private readonly ref: SenderCertificateRef

  private constructor(ref: SenderCertificateRef) {
    this.ref = ref
  }

  static async generate(opts: {
    senderUuid: string
    senderE164?: string
    senderDeviceId: number
    senderKey: PublicKey
    expiration: number
    serverCert: ServerCertificate
    serverKey: PrivateKey
  }): Promise<SenderCertificate> {
    const result = (await NativeModule.generateSenderCertificateOp(
      opts.senderUuid,
      opts.senderE164 ?? null,
      opts.senderDeviceId,
      opts.senderKey.serialize(),
      opts.expiration,
      opts.serverCert.serialize(),
      opts.serverKey.serialize(),
    )) as { certificate: Uint8Array }
    return SenderCertificate.deserialize(result.certificate)
  }

  static async deserialize(bytes: Uint8Array): Promise<SenderCertificate> {
    const ref = (await NativeModule.deserializeSenderCertificate(bytes)) as SenderCertificateRef
    return new SenderCertificate(ref)
  }

  serialize(): Uint8Array {
    return this.ref.serialize()
  }

  senderUuid(): string {
    return this.ref.senderUuid()
  }

  senderE164(): string | null {
    return this.ref.senderE164()
  }

  senderDeviceId(): number {
    return this.ref.senderDeviceId()
  }

  expiration(): number {
    return this.ref.expiration()
  }

  async signatureKey(): Promise<PublicKey> {
    return new PublicKey(this.ref.signatureKey() as ConstructorParameters<typeof PublicKey>[0])
  }

  async serverCertificate(): Promise<ServerCertificate> {
    const inner = this.ref.serverCertificate() as { serialize(): Uint8Array }
    return ServerCertificate.deserialize(inner.serialize())
  }

  async validate(trustRoot: PublicKey, validationTime: number): Promise<boolean> {
    return (await NativeModule.validateSenderCertificateOp(
      this.serialize(),
      trustRoot.serialize(),
      validationTime,
    )) as boolean
  }

  /** @internal */
  _ref(): SenderCertificateRef {
    return this.ref
  }
}
