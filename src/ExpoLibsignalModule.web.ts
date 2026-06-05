export const NativeModule = {
  IdentityKeyPairRef: {
    generate: () => Promise.reject(new Error('expo-libsignal is not supported on web')),
    deserialize: () => Promise.reject(new Error('expo-libsignal is not supported on web')),
    serialize: () => {
      throw new Error('expo-libsignal is not supported on web')
    },
    publicKey: () => {
      throw new Error('expo-libsignal is not supported on web')
    },
    privateKey: () => {
      throw new Error('expo-libsignal is not supported on web')
    },
  },
  PublicIdentityKeyRef: {
    serialize: () => {
      throw new Error('expo-libsignal is not supported on web')
    },
  },
  PrivateKeyRef: {
    serialize: () => {
      throw new Error('expo-libsignal is not supported on web')
    },
  },
}
