package expo.modules.libsignal

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import org.signal.libsignal.protocol.DuplicateMessageException
import org.signal.libsignal.protocol.InvalidKeyException
import org.signal.libsignal.protocol.InvalidKeyIdException
import org.signal.libsignal.protocol.InvalidMessageException
import org.signal.libsignal.protocol.NoSessionException
import org.signal.libsignal.protocol.UntrustedIdentityException

class LibsignalErrorPayload : Record {
  @Field var kind: String = "Generic"
  @Field var message: String = ""
}

fun mapSignalError(error: Throwable): LibsignalErrorPayload {
  val payload = LibsignalErrorPayload()
  payload.message = error.message ?: error.javaClass.simpleName
  payload.kind = when (error) {
    is UntrustedIdentityException -> "UntrustedIdentity"
    is InvalidMessageException -> "InvalidMessage"
    is NoSessionException -> "SessionNotFound"
    is InvalidKeyException, is InvalidKeyIdException -> "InvalidKey"
    is DuplicateMessageException -> "DuplicateMessage"
    else -> "Generic"
  }
  return payload
}
