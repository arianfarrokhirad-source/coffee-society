import { redactSecrets, type JsonValue } from './redact'

// ---------------------------------------------------------------------
// Audit event construction. The event shape mirrors the audit_logs
// table; @jarvis/database persists it with the service role. Building
// is separated from persistence so it is unit-testable and secrets are
// provably redacted before anything reaches the database.
//
// TWO CLASSES OF AUDIT EVENT — the distinction is a security boundary,
// not a naming convention:
//
//   CRITICAL   A security-relevant state change: an approval decision, a
//              membership or role change, an agent's authority. These
//              are NOT written through this module. They are written
//              inside the SECURITY DEFINER RPCs added in migration 0010,
//              in the same transaction as the state change itself, so
//              the change and its record cannot come apart. Building one
//              here and persisting it separately would reintroduce
//              exactly the gap that migration closed. See
//              CRITICAL_AUDIT_ACTIONS below.
//
//   TELEMETRY  Everything else: tool calls, run lifecycle, brief
//              generation, integration activity. Best-effort and
//              non-transactional by design — losing one is an
//              observability gap, not a governance failure.
//
// buildAuditEvent is for TELEMETRY. It refuses to build a critical
// action so the wrong path fails loudly at the call site rather than
// producing a plausible-looking but non-atomic audit row.
// ---------------------------------------------------------------------

export type ActorType = 'user' | 'agent' | 'system'

export interface AuditEventInput {
  organizationId?: string | null
  businessId?: string | null
  actorType: ActorType
  actorId?: string | null
  action: string
  resourceType?: string | null
  resourceId?: string | null
  requestId?: string | null
  beforeData?: JsonValue | null
  afterData?: JsonValue | null
  metadata?: JsonValue | null
}

export interface AuditEvent {
  organization_id: string | null
  business_id: string | null
  actor_type: ActorType
  actor_id: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  request_id: string | null
  before_data: JsonValue | null
  after_data: JsonValue | null
  metadata: JsonValue | null
}

/**
 * Actions that may only be written atomically, by the database RPCs in
 * migration 0010. Kept in step with that migration; a new critical RPC
 * adds its action here.
 */
export const CRITICAL_AUDIT_ACTIONS = [
  'approval.created',
  'approval.approved',
  'approval.rejected',
  'approval.modified',
  'approval.cancelled',
  'approval.expired',
  'approval.executed',
  'approval.failed',
  'membership.created',
  'membership.role_changed',
  'membership.revoked',
  'agent.authority_changed',
  'agent.activated',
  'agent.deactivated',
  'agent.financial_authority_changed',
  'agent.actions_changed',
] as const

export type CriticalAuditAction = (typeof CRITICAL_AUDIT_ACTIONS)[number]

export function isCriticalAuditAction(action: string): action is CriticalAuditAction {
  return (CRITICAL_AUDIT_ACTIONS as readonly string[]).includes(action)
}

export function buildAuditEvent(input: AuditEventInput): AuditEvent {
  if (!input.action || input.action.length < 2 || input.action.length > 120) {
    throw new Error('audit action must be 2-120 characters')
  }
  // Fail loudly rather than write a critical audit row outside the
  // transaction that owns the state change.
  if (isCriticalAuditAction(input.action)) {
    throw new Error(
      `${input.action} is a critical audit action and must be written by its database RPC, not buildAuditEvent`
    )
  }
  return {
    organization_id: input.organizationId ?? null,
    business_id: input.businessId ?? null,
    actor_type: input.actorType,
    actor_id: input.actorId ?? null,
    action: input.action,
    resource_type: input.resourceType ?? null,
    resource_id: input.resourceId ?? null,
    request_id: input.requestId ?? null,
    before_data: input.beforeData != null ? redactSecrets(input.beforeData) : null,
    after_data: input.afterData != null ? redactSecrets(input.afterData) : null,
    metadata: input.metadata != null ? redactSecrets(input.metadata) : null,
  }
}
