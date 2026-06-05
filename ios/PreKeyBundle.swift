import Foundation
import ExpoModulesCore
import LibSignalClient

final class PreKeyBundleRef: SharedObject {
  let bundle: PreKeyBundle

  init(bundle: PreKeyBundle) {
    self.bundle = bundle
    super.init()
  }
}
