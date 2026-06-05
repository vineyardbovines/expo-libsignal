import Foundation
import ExpoModulesCore
import LibSignalClient

final class PublicKeyRef: SharedObject {
  let key: PublicKey

  init(key: PublicKey) {
    self.key = key
    super.init()
  }
}
