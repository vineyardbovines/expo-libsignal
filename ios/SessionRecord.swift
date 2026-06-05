import Foundation
import ExpoModulesCore
import LibSignalClient

final class SessionRecordRef: SharedObject {
  let record: SessionRecord

  init(record: SessionRecord) {
    self.record = record
    super.init()
  }
}
