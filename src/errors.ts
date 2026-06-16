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

export class SenderKeyNotFoundError extends LibsignalError {
  constructor(message: string) {
    super(message)
    this.name = 'SenderKeyNotFoundError'
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

// Store-layer errors (JS-origin; never produced by fromNative).

export class StoreError extends LibsignalError {
  constructor(message: string) {
    super(message)
    this.name = 'StoreError'
  }
}

export class SchemaTooNewError extends StoreError {
  constructor(message: string) {
    super(message)
    this.name = 'SchemaTooNewError'
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

/**
 * Coerce an error thrown from a native op into a typed LibsignalError when it
 * carries a `kind` tag. Falls back to the original Error otherwise. Mirrors
 * the local helper in SessionCipher / SessionBuilder; lifted here so the new
 * Group* classes can share it.
 */
export function rethrowAsLibsignal(e: unknown): Error {
  if (e instanceof Error && 'kind' in e) {
    return fromNative({
      kind: (e as { kind?: string }).kind ?? 'Generic',
      message: e.message,
    })
  }
  return e instanceof Error ? e : new Error(String(e))
}
