import type { CreateNotificationInput, JarvisStore } from '@jarvis/database'

// ---------------------------------------------------------------------
// Notification delivery abstraction (section 21). Phase 1 stores
// notifications in the application only. The adapter interface is the
// seam where email / push / Telegram / WhatsApp delivery plugs in later
// WITHOUT touching call sites — each channel becomes one adapter, and
// external sends will route through the approval/audit machinery.
// ---------------------------------------------------------------------

export interface NotificationDeliveryAdapter {
  readonly channel: string // 'in_app' | 'email' | 'push' | 'telegram' | 'whatsapp' | ...
  /** True when the channel is configured and allowed to send. */
  isEnabled(): boolean
  deliver(notification: CreateNotificationInput): Promise<{ ok: boolean; error?: string }>
}

/** The only Phase 1 adapter: persist to the notifications table. */
export function createInAppAdapter(store: JarvisStore): NotificationDeliveryAdapter {
  return {
    channel: 'in_app',
    isEnabled: () => true,
    async deliver(notification) {
      try {
        await store.createNotification(notification)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'unknown error' }
      }
    },
  }
}

/**
 * Fan out a notification to every enabled adapter. P0 escalation to
 * external channels becomes possible the moment such an adapter exists;
 * with only the in-app adapter this is equivalent to storing it.
 */
export async function dispatchNotification(
  adapters: NotificationDeliveryAdapter[],
  notification: CreateNotificationInput
): Promise<{ delivered: string[]; failed: string[] }> {
  const delivered: string[] = []
  const failed: string[] = []
  for (const adapter of adapters.filter((a) => a.isEnabled())) {
    const result = await adapter.deliver(notification)
    ;(result.ok ? delivered : failed).push(adapter.channel)
  }
  return { delivered, failed }
}
