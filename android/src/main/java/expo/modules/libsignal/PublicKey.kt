package expo.modules.libsignal

import expo.modules.kotlin.sharedobjects.SharedObject
import org.signal.libsignal.protocol.ecc.ECPublicKey

class PublicKeyRef(val key: ECPublicKey) : SharedObject()
