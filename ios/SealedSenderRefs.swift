import Foundation
import ExpoModulesCore
import LibSignalClient

final class ServerCertificateRef: SharedObject {
  let cert: ServerCertificate

  init(cert: ServerCertificate) {
    self.cert = cert
    super.init()
  }
}

final class SenderCertificateRef: SharedObject {
  let cert: SenderCertificate

  init(cert: SenderCertificate) {
    self.cert = cert
    super.init()
  }
}
