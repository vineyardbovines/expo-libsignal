package expo.modules.libsignal

import expo.modules.kotlin.sharedobjects.SharedObject
import org.signal.libsignal.protocol.state.KyberPreKeyRecord
import org.signal.libsignal.protocol.state.PreKeyRecord
import org.signal.libsignal.protocol.state.SignedPreKeyRecord

class PreKeyRecordRef(val record: PreKeyRecord) : SharedObject()

class SignedPreKeyRecordRef(val record: SignedPreKeyRecord) : SharedObject()

class KyberPreKeyRecordRef(val record: KyberPreKeyRecord) : SharedObject()
