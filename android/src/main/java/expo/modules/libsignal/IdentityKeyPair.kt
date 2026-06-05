package expo.modules.libsignal

import expo.modules.kotlin.sharedobjects.SharedObject
import org.signal.libsignal.protocol.IdentityKey
import org.signal.libsignal.protocol.IdentityKeyPair as SignalIdentityKeyPair
import org.signal.libsignal.protocol.ecc.ECPrivateKey

class IdentityKeyPairRef(val keyPair: SignalIdentityKeyPair) : SharedObject()

class PublicIdentityKeyRef(val key: IdentityKey) : SharedObject()

class PrivateKeyRef(val key: ECPrivateKey) : SharedObject()
