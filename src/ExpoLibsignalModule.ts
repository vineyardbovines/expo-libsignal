import { requireNativeModule } from 'expo'

// Internal accessor for the native module. Consumers should import from the
// package root, not from this file.
//
// The native module shape is inferred from the Class() registrations in
// Swift/Kotlin; typing it precisely here would be circular. The public TS API
// in src/core/* re-narrates the surface with typed wrappers.
// biome-ignore lint/suspicious/noExplicitAny: see comment above
export const NativeModule: any = requireNativeModule('ExpoLibsignal')
