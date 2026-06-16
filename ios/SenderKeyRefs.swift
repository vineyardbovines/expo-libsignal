import Foundation
import ExpoModulesCore
import LibSignalClient

final class SenderKeyRecordRef: SharedObject {
  let record: SenderKeyRecord

  init(record: SenderKeyRecord) {
    self.record = record
    super.init()
  }
}

final class SenderKeyDistributionMessageRef: SharedObject {
  let message: SenderKeyDistributionMessage

  init(message: SenderKeyDistributionMessage) {
    self.message = message
    super.init()
  }
}
