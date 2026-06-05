export const NativeModule = {
  generateIdentityKeyPair: () =>
    Promise.reject(new Error('expo-libsignal is not supported on web')),
  deserializeIdentityKeyPair: () =>
    Promise.reject(new Error('expo-libsignal is not supported on web')),
}
