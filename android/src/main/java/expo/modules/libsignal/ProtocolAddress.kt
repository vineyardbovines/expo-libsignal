package expo.modules.libsignal

import expo.modules.kotlin.sharedobjects.SharedObject
import org.signal.libsignal.protocol.SignalProtocolAddress

class ProtocolAddressRef(val address: SignalProtocolAddress) : SharedObject()
