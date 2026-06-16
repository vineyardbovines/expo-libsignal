package expo.modules.libsignal

import expo.modules.kotlin.sharedobjects.SharedObject
import org.signal.libsignal.protocol.groups.state.SenderKeyRecord
import org.signal.libsignal.protocol.message.SenderKeyDistributionMessage

class SenderKeyRecordRef(val record: SenderKeyRecord) : SharedObject()

class SenderKeyDistributionMessageRef(val message: SenderKeyDistributionMessage) : SharedObject()
