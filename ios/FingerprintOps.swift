import Foundation
import ExpoModulesCore
import LibSignalClient

// MARK: - Result Records

struct FingerprintCreateResult: Record {
  @Field var displayText: String = ""
  @Field var scannableBytes: Data = Data()
}

// MARK: - Ops

func runFingerprintCreateOp(
  version: Int,
  iterations: Int,
  localIdentifier: Data,
  localKeyBytes: Data,
  remoteIdentifier: Data,
  remoteKeyBytes: Data
) throws -> FingerprintCreateResult {
  let localKey = try PublicKey(localKeyBytes)
  let remoteKey = try PublicKey(remoteKeyBytes)
  let gen = NumericFingerprintGenerator(iterations: iterations)
  let fp = try gen.create(
    version: version,
    localIdentifier: localIdentifier,
    localKey: localKey,
    remoteIdentifier: remoteIdentifier,
    remoteKey: remoteKey
  )
  var result = FingerprintCreateResult()
  result.displayText = fp.displayable.formatted
  result.scannableBytes = fp.scannable.encoding
  return result
}

func runCompareScannableFingerprintsOp(a: Data, b: Data) throws -> Bool {
  let lhs = ScannableFingerprint(encoding: a)
  return try lhs.compare(againstEncoding: b)
}
