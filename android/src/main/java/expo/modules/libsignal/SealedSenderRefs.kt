package expo.modules.libsignal

import expo.modules.kotlin.sharedobjects.SharedObject
import org.signal.libsignal.metadata.certificate.SenderCertificate
import org.signal.libsignal.metadata.certificate.ServerCertificate

class ServerCertificateRef(val cert: ServerCertificate) : SharedObject()

class SenderCertificateRef(val cert: SenderCertificate) : SharedObject()
