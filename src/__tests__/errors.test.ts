import {
  DuplicateMessageError,
  fromNative,
  InvalidKeyError,
  InvalidMessageError,
  LibsignalError,
  SessionNotFoundError,
  UntrustedIdentityError,
} from '../errors'

describe('LibsignalError hierarchy', () => {
  it('every subclass inherits LibsignalError', () => {
    expect(new UntrustedIdentityError('x')).toBeInstanceOf(LibsignalError)
    expect(new InvalidMessageError('x')).toBeInstanceOf(LibsignalError)
    expect(new SessionNotFoundError('x')).toBeInstanceOf(LibsignalError)
    expect(new InvalidKeyError('x')).toBeInstanceOf(LibsignalError)
    expect(new DuplicateMessageError('x')).toBeInstanceOf(LibsignalError)
  })

  it('fromNative maps known kinds to the right subclass', () => {
    expect(fromNative({ kind: 'UntrustedIdentity', message: 'm' })).toBeInstanceOf(
      UntrustedIdentityError,
    )
    expect(fromNative({ kind: 'InvalidMessage', message: 'm' })).toBeInstanceOf(InvalidMessageError)
    expect(fromNative({ kind: 'SessionNotFound', message: 'm' })).toBeInstanceOf(
      SessionNotFoundError,
    )
  })

  it('fromNative falls back to LibsignalError for unknown kinds', () => {
    const err = fromNative({ kind: 'SomeUnknownKind', message: 'm' })
    expect(err).toBeInstanceOf(LibsignalError)
    expect(err.constructor.name).toBe('LibsignalError')
  })

  it('error name property matches class name', () => {
    expect(new UntrustedIdentityError('x').name).toBe('UntrustedIdentityError')
  })
})
