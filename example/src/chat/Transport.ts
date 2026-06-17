// Thin re-export of the Transport surface lifted into the library. Kept here
// so existing chat code can keep importing from './Transport' without churn;
// new code should import from 'expo-libsignal' directly.
export type { Address, Envelope, Transport } from 'expo-libsignal'
