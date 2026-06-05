import Foundation
import ExpoModulesCore
import LibSignalClient

final class ProtocolAddressRef: SharedObject {
  let address: ProtocolAddress

  init(address: ProtocolAddress) {
    self.address = address
    super.init()
  }
}
