// We only validate the both-or-neither rule on preKeyId/preKeyPublic.
// Other fields are validated by the native bridge. We don't load native
// in unit tests, so the success path is covered by the example app.

// To exercise the validation without loading the native module, we
// stub it. The wrapper validates BEFORE calling native, so the stub
// is never invoked by these tests.
jest.mock('../ExpoLibsignalModule', () => ({
  NativeModule: {
    createPreKeyBundle: jest.fn(() => {
      throw new Error('native should not be called in validation tests')
    }),
  },
}))

import { PreKeyBundle } from '../core/PreKeyBundle'

describe('PreKeyBundle.create validation', () => {
  // Minimal fixtures — only the fields the validator examines need to be real
  // shapes; everything else can be `undefined as never` because we never reach
  // the native call.
  const validBase = {
    registrationId: 1,
    deviceId: 1,
    identityKey: undefined as never,
    signedPreKeyId: 1,
    signedPreKeyPublic: undefined as never,
    signedPreKeySignature: new Uint8Array(),
    kyberPreKeyId: 1,
    kyberPreKeyPublic: new Uint8Array(),
    kyberPreKeySignature: new Uint8Array(),
  }

  it('rejects preKeyId without preKeyPublic', async () => {
    await expect(PreKeyBundle.create({ ...validBase, preKeyId: 1 })).rejects.toThrow(
      /preKeyId.*preKeyPublic/,
    )
  })

  it('rejects preKeyPublic without preKeyId', async () => {
    await expect(
      PreKeyBundle.create({ ...validBase, preKeyPublic: undefined as never }),
    ).rejects.toThrow(/preKeyId.*preKeyPublic/)
  })
})
