package expo.modules.libsignal

import expo.modules.kotlin.sharedobjects.SharedObject
import org.signal.libsignal.protocol.state.PreKeyBundle

class PreKeyBundleRef(val bundle: PreKeyBundle) : SharedObject()
