import type { SupabaseClient } from '@supabase/supabase-js'

// Persistence for audit events built by @jarvis/security. Failure to
// audit is surfaced (never swallowed): callers decide whether the
// operation itself must fail, but the failure is at minimum logged.

export interface PersistableAuditEvent {
  organization_id: string | null
  business_id: string | null
  actor_type: 'user' | 'agent' | 'system'
  actor_id: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  request_id: string | null
  before_data: unknown
  after_data: unknown
  metadata: unknown
}

export async function writeAuditLog(
  service: SupabaseClient,
  event: PersistableAuditEvent
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await service.from('audit_logs').insert(event)
  if (error) {
    console.error('[audit] failed to write audit log:', error.message, 'action:', event.action)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}
