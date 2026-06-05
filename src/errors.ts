export class LibsignalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LibsignalError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class UntrustedIdentityError extends LibsignalError {
  constructor(message: string) {
    super(message)
    this.name = 'UntrustedIdentityError'
  }
}

export class InvalidMessageError extends LibsignalError {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidMessageError'
  }
}

export class SessionNotFoundError extends LibsignalError {
  constructor(message: string) {
    super(message)
    this.name = 'SessionNotFoundError'
  }
}

export class InvalidKeyError extends LibsignalError {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidKeyError'
  }
}

export class DuplicateMessageError extends LibsignalError {
  constructor(message: string) {
    super(message)
    this.name = 'DuplicateMessageError'
  }
}

export interface NativeErrorPayload {
  kind: string
  message: string
}

const ERROR_REGISTRY: Record<string, new (msg: string) => LibsignalError> = {
  UntrustedIdentity: UntrustedIdentityError,
  InvalidMessage: InvalidMessageError,
  SessionNotFound: SessionNotFoundError,
  InvalidKey: InvalidKeyError,
  DuplicateMessage: DuplicateMessageError,
}

export function fromNative(payload: NativeErrorPayload): LibsignalError {
  const Ctor = ERROR_REGISTRY[payload.kind] ?? LibsignalError
  return new Ctor(payload.message)
}
