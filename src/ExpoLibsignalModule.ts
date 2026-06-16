import { requireNativeModule } from 'expo'

// Per-op configuration for the sender-key (group) cipher path. Shared by
// createSenderKeyDistributionOp / processSenderKeyDistributionOp /
// groupEncryptOp / groupDecryptOp. The sender address is the (name, deviceId)
// of whoever produced the SenderKey; nowMs anchors timestamping inside the op.
export type SenderKeyOpConfig = {
  senderName: string
  senderDeviceId: number
  nowMs: number
}

// Internal accessor for the native module. Consumers should import from the
// package root, not from this file.
//
// The native module shape is inferred from the Class() registrations in
// Swift/Kotlin; typing it precisely here would be circular. The public TS API
// in src/core/* re-narrates the surface with typed wrappers.
// biome-ignore lint/suspicious/noExplicitAny: see comment above
export const NativeModule: any = requireNativeModule('ExpoLibsignal')
