import Foundation
import ExpoModulesCore
import LibSignalClient

final class SignalMessageRef: SharedObject {
  let message: SignalMessage

  init(message: SignalMessage) {
    self.message = message
    super.init()
  }
}

final class PreKeySignalMessageRef: SharedObject {
  let message: PreKeySignalMessage

  init(message: PreKeySignalMessage) {
    self.message = message
    super.init()
  }
}
