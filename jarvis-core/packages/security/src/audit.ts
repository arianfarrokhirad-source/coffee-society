import { redactSecrets, type JsonValue } from './redact'

// ---------------------------------------------------------------------
// Audit event construction. The event shape mirrors the audit_logs
// table; @jarvis/database persists it with the service role. Building
// is separated from persistence so it is unit-testable and secrets are
// provably redacted before anything reaches the database.
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

export function buildAuditEvent(input: AuditEventInput): AuditEvent {
  if (!input.action || input.action.length < 2 || input.action.length > 120) {
    throw new Error('audit action must be 2-120 characters')
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
