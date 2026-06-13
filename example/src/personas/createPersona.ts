import {
  IdentityKeyPair,
  KyberPreKeyRecord,
  PreKeyBundle,
  PreKeyRecord,
  ProtocolAddress,
  SignedPreKeyRecord,
} from 'expo-libsignal'
import { InMemoryProtocolStore } from '../stores/InMemoryProtocolStore'

export interface Persona {
  name: string
  identity: IdentityKeyPair
  registrationId: number
  address: ProtocolAddress
  stores: InMemoryProtocolStore
}

export async function createPersona(name: string): Promise<Persona> {
  const identity = await IdentityKeyPair.generate()
  // Registration ids in libsignal are 14-bit non-negative integers.
  const registrationId = 1 + Math.floor(Math.random() * 0x3fff)
  const address = await ProtocolAddress.create(name, 1)
  const stores = new InMemoryProtocolStore(identity, registrationId)
  return { name, identity, registrationId, address, stores }
}

export async function publishPreKeyBundle(
  persona: Persona,
  preKeyId: number,
  signedPreKeyId: number,
  kyberPreKeyId: number,
): Promise<PreKeyBundle> {
  // Generate fresh prekeys, store them in the persona's stores, then build a bundle.
  const ts = Date.now()
  const preKey = await PreKeyRecord.generate(preKeyId)
  const signedPreKey = await SignedPreKeyRecord.generate(signedPreKeyId, persona.identity, ts)
  const kyberPreKey = await KyberPreKeyRecord.generate(kyberPreKeyId, persona.identity, ts)
  await persona.stores.storePreKey(preKeyId, preKey)
  await persona.stores.storeSignedPreKey(signedPreKeyId, signedPreKey)
  await persona.stores.storeKyberPreKey(kyberPreKeyId, kyberPreKey)
  return PreKeyBundle.create({
    registrationId: persona.registrationId,
    deviceId: persona.address.deviceId(),
    identityKey: persona.identity.publicKey(),
    signedPreKeyId,
    signedPreKeyPublic: signedPreKey.publicKey(),
    signedPreKeySignature: signedPreKey.signature(),
    kyberPreKeyId,
    kyberPreKeyPublic: kyberPreKey.kyberPublicKey(),
    kyberPreKeySignature: kyberPreKey.signature(),
    preKeyId,
    preKeyPublic: preKey.publicKey(),
  })
}
