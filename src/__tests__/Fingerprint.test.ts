import { Fingerprint, ScannableFingerprint } from '../core/Fingerprint'
import { PublicKey } from '../core/PublicKey'

const localKeyBytes = new Uint8Array([0x05, 0xaa])
const remoteKeyBytes = new Uint8Array([0x05, 0xbb])
const localId = new Uint8Array([0x01])
const remoteId = new Uint8Array([0x02])
const displayText = '12345 67890 12345 67890 12345 67890 12345 67890 12345 67890 12345 67890'
const scannableBytes = new Uint8Array([0x08, 0x01, 0x12, 0x20])
const otherScannableBytes = new Uint8Array([0x08, 0x01, 0x12, 0x21])

const fingerprintCreateOp = jest.fn(async () => ({ displayText, scannableBytes }))
const compareScannableFingerprintsOp = jest.fn(async () => true)

jest.mock('../ExpoLibsignalModule', () => {
  return {
    NativeModule: {
      get fingerprintCreateOp() {
        return fingerprintCreateOp
      },
      get compareScannableFingerprintsOp() {
        return compareScannableFingerprintsOp
      },
      deserializePublicKey: jest.fn(async (bytes: Uint8Array) => ({ serialize: () => bytes })),
    },
  }
})

describe('Fingerprint', () => {
  beforeEach(() => {
    fingerprintCreateOp.mockClear()
    compareScannableFingerprintsOp.mockClear()
  })

  test('new calls the native op with positional bytes and caches both forms', async () => {
    const localKey = await PublicKey.deserialize(localKeyBytes)
    const remoteKey = await PublicKey.deserialize(remoteKeyBytes)
    const fp = await Fingerprint.new({
      version: 1,
      iterations: 5200,
      localIdentifier: localId,
      localKey,
      remoteIdentifier: remoteId,
      remoteKey,
    })

    expect(fingerprintCreateOp).toHaveBeenCalledWith(
      1,
      5200,
      localId,
      localKeyBytes,
      remoteId,
      remoteKeyBytes,
    )

    const display = await fp.displayableFingerprint()
    expect(display).toEqual({ text: displayText })

    const scannable = await fp.scannableFingerprint()
    expect(scannable).toEqual({ bytes: scannableBytes })

    // accessors are pure cache reads after the single native call
    expect(fingerprintCreateOp).toHaveBeenCalledTimes(1)
  })
})

describe('ScannableFingerprint', () => {
  beforeEach(() => {
    compareScannableFingerprintsOp.mockClear()
  })

  test('deserialize wraps the bytes; serialize returns them', async () => {
    const fp = await ScannableFingerprint.deserialize(scannableBytes)
    expect(fp.serialize()).toEqual(scannableBytes)
  })

  test('compareWith passes both encodings to the native op', async () => {
    const ours = await ScannableFingerprint.deserialize(scannableBytes)
    const theirs = await ScannableFingerprint.deserialize(otherScannableBytes)
    const matches = await ours.compareWith(theirs)

    expect(compareScannableFingerprintsOp).toHaveBeenCalledWith(scannableBytes, otherScannableBytes)
    expect(matches).toBe(true)
  })
})
