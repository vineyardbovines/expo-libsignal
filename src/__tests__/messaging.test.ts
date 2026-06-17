import { dispatchReceived, type Received } from '../core/messaging'

describe('dispatchReceived', () => {
  test('routes message to the message handler', async () => {
    const calls: string[] = []
    const r: Received = {
      kind: 'message',
      from: { name: 'alice', deviceId: 1 },
      plaintext: 'hi',
      sealed: false,
    }
    await dispatchReceived(r, {
      message: async (m) => {
        calls.push(`message:${m.plaintext}`)
      },
    })
    expect(calls).toEqual(['message:hi'])
  })

  test('routes group-message to the group-message handler', async () => {
    const calls: string[] = []
    const r: Received = {
      kind: 'group-message',
      from: { name: 'alice', deviceId: 1 },
      distributionId: 'd1',
      plaintext: 'gm',
    }
    await dispatchReceived(r, {
      'group-message': (m) => {
        calls.push(`group:${m.plaintext}@${m.distributionId}`)
      },
    })
    expect(calls).toEqual(['group:gm@d1'])
  })

  test('routes group-welcome to the group-welcome handler', async () => {
    const calls: string[] = []
    const r: Received = {
      kind: 'group-welcome',
      from: { name: 'alice', deviceId: 1 },
      distributionId: 'd1',
    }
    await dispatchReceived(r, {
      'group-welcome': (m) => {
        calls.push(`welcome:${m.distributionId}`)
      },
    })
    expect(calls).toEqual(['welcome:d1'])
  })

  test('missing handler silently ignores the event', async () => {
    const r: Received = {
      kind: 'group-message',
      from: { name: 'alice', deviceId: 1 },
      distributionId: 'd1',
      plaintext: 'gm',
    }
    await expect(dispatchReceived(r, { message: () => {} })).resolves.toBeUndefined()
  })

  test('sync handlers also work', async () => {
    let seen: string | null = null
    await dispatchReceived(
      {
        kind: 'message',
        from: { name: 'alice', deviceId: 1 },
        plaintext: 'sync',
        sealed: false,
      },
      {
        message: (m) => {
          seen = m.plaintext
        },
      },
    )
    expect(seen).toBe('sync')
  })

  test('awaits async handler errors so the caller can catch them', async () => {
    await expect(
      dispatchReceived(
        {
          kind: 'message',
          from: { name: 'alice', deviceId: 1 },
          plaintext: 'boom',
          sealed: false,
        },
        {
          message: async () => {
            throw new Error('handler exploded')
          },
        },
      ),
    ).rejects.toThrow(/handler exploded/)
  })
})
