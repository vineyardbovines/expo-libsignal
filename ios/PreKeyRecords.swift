import Foundation
import ExpoModulesCore
import LibSignalClient

final class PreKeyRecordRef: SharedObject {
  let record: PreKeyRecord

  init(record: PreKeyRecord) {
    self.record = record
    super.init()
  }
}

final class SignedPreKeyRecordRef: SharedObject {
  let record: SignedPreKeyRecord

  init(record: SignedPreKeyRecord) {
    self.record = record
    super.init()
  }
}

final class KyberPreKeyRecordRef: SharedObject {
  let record: KyberPreKeyRecord

  init(record: KyberPreKeyRecord) {
    self.record = record
    super.init()
  }
}
