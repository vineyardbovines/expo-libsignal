import Foundation
import ExpoModulesCore
import LibSignalClient

final class IdentityKeyPairRef: SharedObject {
  let keyPair: IdentityKeyPair

  init(keyPair: IdentityKeyPair) {
    self.keyPair = keyPair
    super.init()
  }
}

final class PublicIdentityKeyRef: SharedObject {
  let key: IdentityKey

  init(key: IdentityKey) {
    self.key = key
    super.init()
  }
}

final class PrivateKeyRef: SharedObject {
  let key: PrivateKey

  init(key: PrivateKey) {
    self.key = key
    super.init()
  }
}
