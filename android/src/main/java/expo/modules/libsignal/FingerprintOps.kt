package expo.modules.libsignal

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import org.signal.libsignal.protocol.IdentityKey
import org.signal.libsignal.protocol.fingerprint.NumericFingerprintGenerator
import org.signal.libsignal.protocol.fingerprint.ScannableFingerprint

class FingerprintCreateResult : Record {
  @Field var displayText: String = ""
  @Field var scannableBytes: ByteArray = ByteArray(0)
}

internal fun runFingerprintCreateOp(
  version: Int,
  iterations: Int,
  localIdentifier: ByteArray,
  localKeyBytes: ByteArray,
  remoteIdentifier: ByteArray,
  remoteKeyBytes: ByteArray,
): FingerprintCreateResult {
  // Java's NumericFingerprintGenerator takes IdentityKey, which is a thin
  // wrapper around a curve PublicKey on the wire. The Swift side takes a
  // PublicKey directly; same bytes either way.
  val localKey = IdentityKey(localKeyBytes)
  val remoteKey = IdentityKey(remoteKeyBytes)
  val gen = NumericFingerprintGenerator(iterations)
  val fp = gen.createFor(version, localIdentifier, localKey, remoteIdentifier, remoteKey)
  return FingerprintCreateResult().also {
    it.displayText = fp.displayableFingerprint.displayText
    it.scannableBytes = fp.scannableFingerprint.serialized
  }
}

internal fun runCompareScannableFingerprintsOp(a: ByteArray, b: ByteArray): Boolean {
  // ScannableFingerprint.compareTo is what does the version + parse check;
  // a malformed `b` surfaces as FingerprintParsingException, mapped by the
  // module-level catch.
  val lhs = ScannableFingerprint::class.java
    .getDeclaredConstructor(ByteArray::class.java)
    .apply { isAccessible = true }
    .newInstance(a)
  return lhs.compareTo(b)
}
