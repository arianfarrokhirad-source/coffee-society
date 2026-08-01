import { describe, expect, it } from 'vitest'
import { createInMemoryStore } from '@jarvis/database'
import {
  createInAppAdapter,
  dispatchNotification,
  type NotificationDeliveryAdapter,
} from '../src/notify'

describe('notification delivery', () => {
  it('in-app adapter persists notifications with their priority', async () => {
    const store = createInMemoryStore()
    const result = await dispatchNotification([createInAppAdapter(store)], {
      organizationId: store.state.organizationId,
      priority: 'P0',
      title: 'Immediate emergency',
    })
    expect(result.delivered).toEqual(['in_app'])
    expect(store.state.notifications[0]?.priority).toBe('P0')
  })

  it('disabled adapters are skipped; failures are reported per channel', async () => {
    const store = createInMemoryStore()
    const disabled: NotificationDeliveryAdapter = {
      channel: 'email',
      isEnabled: () => false,
      deliver: async () => ({ ok: true }),
    }
    const failing: NotificationDeliveryAdapter = {
      channel: 'telegram',
      isEnabled: () => true,
      deliver: async () => ({ ok: false, error: 'no credentials' }),
    }
    const result = await dispatchNotification([createInAppAdapter(store), disabled, failing], {
      organizationId: store.state.organizationId,
      priority: 'P2',
      title: 'update',
    })
    expect(result.delivered).toEqual(['in_app'])
    expect(result.failed).toEqual(['telegram'])
  })
})
