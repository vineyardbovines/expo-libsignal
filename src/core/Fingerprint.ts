import { NativeModule } from '../ExpoLibsignalModule'
import type { PublicKey } from './PublicKey'

export interface FingerprintNewArgs {
  version: number
  iterations: number
  localIdentifier: Uint8Array
  localKey: PublicKey
  remoteIdentifier: Uint8Array
  remoteKey: PublicKey
}

/**
 * Numeric safety-number fingerprint. `new` runs the heavy iterated hash once and
 * caches both representations; the accessor methods return cheaply afterwards.
 *
 *   const fp = await Fingerprint.new({ version: 1, iterations: 5200, ... })
 *   const { text } = await fp.displayableFingerprint()       // 60-digit string for UI
 *   const { bytes } = await fp.scannableFingerprint()        // encode into a QR
 */
export class Fingerprint {
  private readonly _text: string
  private readonly _scannable: Uint8Array

  private constructor(text: string, scannable: Uint8Array) {
    this._text = text
    this._scannable = scannable
  }

  static async new(args: FingerprintNewArgs): Promise<Fingerprint> {
    const result = (await NativeModule.fingerprintCreateOp(
      args.version,
      args.iterations,
      args.localIdentifier,
      args.localKey.serialize(),
      args.remoteIdentifier,
      args.remoteKey.serialize(),
    )) as { displayText: string; scannableBytes: Uint8Array }
    return new Fingerprint(result.displayText, result.scannableBytes)
  }

  async displayableFingerprint(): Promise<{ text: string }> {
    return { text: this._text }
  }

  async scannableFingerprint(): Promise<{ bytes: Uint8Array }> {
    return { bytes: this._scannable }
  }
}

/**
 * Wrapper around a serialized scannable fingerprint (typically the bytes pulled
 * off a scanned QR). `compareWith` delegates to libsignal, which raises if either
 * encoding is malformed or its version doesn't match ours.
 */
export class ScannableFingerprint {
  private readonly _bytes: Uint8Array

  private constructor(bytes: Uint8Array) {
    this._bytes = bytes
  }

  static async deserialize(bytes: Uint8Array): Promise<ScannableFingerprint> {
    return new ScannableFingerprint(bytes)
  }

  serialize(): Uint8Array {
    return this._bytes
  }

  async compareWith(other: ScannableFingerprint): Promise<boolean> {
    return (await NativeModule.compareScannableFingerprintsOp(this._bytes, other._bytes)) as boolean
  }
}
