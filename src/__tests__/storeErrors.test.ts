import { LibsignalError, SchemaTooNewError, StoreError } from '../errors'

describe('store errors', () => {
  test('StoreError extends LibsignalError', () => {
    const e = new StoreError('x')
    expect(e).toBeInstanceOf(StoreError)
    expect(e).toBeInstanceOf(LibsignalError)
    expect(e.name).toBe('StoreError')
  })

  test('SchemaTooNewError extends StoreError', () => {
    const e = new SchemaTooNewError('x')
    expect(e).toBeInstanceOf(SchemaTooNewError)
    expect(e).toBeInstanceOf(StoreError)
    expect(e.name).toBe('SchemaTooNewError')
  })
})
