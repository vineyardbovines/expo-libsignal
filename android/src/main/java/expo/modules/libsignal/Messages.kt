package expo.modules.libsignal

import expo.modules.kotlin.sharedobjects.SharedObject
import org.signal.libsignal.protocol.message.PreKeySignalMessage
import org.signal.libsignal.protocol.message.SignalMessage

class SignalMessageRef(val message: SignalMessage) : SharedObject()

class PreKeySignalMessageRef(val message: PreKeySignalMessage) : SharedObject()
