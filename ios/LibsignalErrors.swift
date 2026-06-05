import Foundation
import ExpoModulesCore
import LibSignalClient

enum LibsignalErrorKind: String {
  case untrustedIdentity = "UntrustedIdentity"
  case invalidMessage = "InvalidMessage"
  case sessionNotFound = "SessionNotFound"
  case invalidKey = "InvalidKey"
  case duplicateMessage = "DuplicateMessage"
  case generic = "Generic"
}

struct LibsignalErrorPayload: Record {
  @Field var kind: String = "Generic"
  @Field var message: String = ""
}

func mapSignalError(_ error: Error) -> LibsignalErrorPayload {
  let payload = LibsignalErrorPayload()
  payload.message = "\(error)"

  if let signalError = error as? SignalError {
    switch signalError {
    case .untrustedIdentity:
      payload.kind = LibsignalErrorKind.untrustedIdentity.rawValue
    case .invalidMessage:
      payload.kind = LibsignalErrorKind.invalidMessage.rawValue
    case .sessionNotFound:
      payload.kind = LibsignalErrorKind.sessionNotFound.rawValue
    case .invalidKey, .invalidKeyIdentifier:
      payload.kind = LibsignalErrorKind.invalidKey.rawValue
    case .duplicatedMessage:
      payload.kind = LibsignalErrorKind.duplicateMessage.rawValue
    default:
      payload.kind = LibsignalErrorKind.generic.rawValue
    }
  } else {
    payload.kind = LibsignalErrorKind.generic.rawValue
  }
  return payload
}
