import {
  GroupCipher,
  GroupSessionBuilder,
  ProtocolAddress,
  SessionCipher,
} from 'expo-libsignal'
import type { Address, Envelope, SignalClient } from './SignalClient'

export class SignalGroupClient {
  private readonly client: SignalClient
  private readonly distributionId: string

  constructor(client: SignalClient, distributionId: string) {
    this.client = client
    this.distributionId = distributionId
  }

  /**
   * Mint an SKDM for this group + sender, wrap it in each member's 1:1
   * session, and return one envelope per member. Caller ships each.
   */
  async welcome(
    members: Address[],
  ): Promise<Array<{ to: Address; envelope: Envelope }>> {
    const builder = new GroupSessionBuilder(this.client.store)
    const skdm = await this.client.store.runExclusive(() =>
      builder.createSenderKeyDistributionMessage(
        this.client.self,
        this.distributionId,
      ),
    )
    const skdmBytes = skdm.serialize()

    const out: Array<{ to: Address; envelope: Envelope }> = []
    for (const member of members) {
      const remote = await ProtocolAddress.create(member.name, member.deviceId)
      const cipher = new SessionCipher(
        {
          sessionStore: this.client.store,
          identityStore: this.client.store,
          preKeyStore: this.client.store,
          signedPreKeyStore: this.client.store,
          kyberPreKeyStore: this.client.store,
        },
        remote,
        this.client.self,
      )
      const wrapped = await this.client.store.runExclusive(() =>
        cipher.encrypt(skdmBytes),
      )
      out.push({
        to: member,
        envelope: {
          type: 'sender-key-distribution',
          from: this.client.selfAddress,
          bytes: wrapped.serialize(),
          distributionId: this.distributionId,
        },
      })
    }
    return out
  }

  async send(plaintext: string): Promise<Envelope> {
    const cipher = new GroupCipher(this.client.store, this.client.self)
    const bytes = await this.client.store.runExclusive(() =>
      cipher.encrypt(this.distributionId, new TextEncoder().encode(plaintext)),
    )
    return {
      type: 'group',
      from: this.client.selfAddress,
      distributionId: this.distributionId,
      bytes,
    }
  }
}
