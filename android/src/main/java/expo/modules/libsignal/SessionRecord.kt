package expo.modules.libsignal

import expo.modules.kotlin.sharedobjects.SharedObject
import org.signal.libsignal.protocol.state.SessionRecord

class SessionRecordRef(val record: SessionRecord) : SharedObject()
