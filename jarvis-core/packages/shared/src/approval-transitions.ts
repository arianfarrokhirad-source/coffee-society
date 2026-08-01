// Type-only import by design. This module must stay free of runtime
// imports so supabase/tests/transition_parity.sh can load it directly
// under bare Node, with no bundler and no workspace linking, and compare
// it against the live SQL function.
import type { ApprovalStatus } from './constants'

// ---------------------------------------------------------------------
// Approval transition rules and the request-origin enumeration.
//
// THE DATABASE IS AUTHORITATIVE. public.approval_transition_allowed and
// public.write_critical_audit (migration 0010) decide what is permitted;
// nothing may execute on this module's say-so alone. This exists so the
// in-memory store and the UI can reason about the same rules without a
// database, and it is pinned to the SQL by
// supabase/tests/transition_parity.sh, which compares every combination
// of (from, to, actor kind) against the live function. Change one and
// that test fails until you change the other.
// ---------------------------------------------------------------------

/**
 * Who is attempting a transition. Not a role: PRIME is a person, system
 * is the expiry sweep, executor is the future component that carries out
 * an approved action.
 */
export const TRANSITION_ACTOR_KINDS = ['prime', 'system', 'executor'] as const
export type TransitionActorKind = (typeof TRANSITION_ACTOR_KINDS)[number]

/**
 * Where a critical request entered the system. The database validates
 * this same enumeration and rejects anything outside it.
 *
 * - `web`       browser session acting through a server action
 * - `agent`     AI agent acting through the tool pipeline
 * - `cron`      scheduled endpoint (bearer authenticated)
 * - `api`       programmatic caller other than the above
 * - `executor`  future approved-action executor (not implemented)
 * - `migration` schema migration or maintenance script
 */
export const REQUEST_ORIGINS = ['web', 'agent', 'cron', 'api', 'executor', 'migration'] as const
export type RequestOrigin = (typeof REQUEST_ORIGINS)[number]

export function isRequestOrigin(value: unknown): value is RequestOrigin {
  return typeof value === 'string' && (REQUEST_ORIGINS as readonly string[]).includes(value)
}

/** Statuses from which no further transition is possible. */
export const TERMINAL_APPROVAL_STATUSES = [
  'rejected',
  'executed',
  'failed',
  'expired',
  'cancelled',
] as const

export function isTerminalApprovalStatus(status: ApprovalStatus): boolean {
  return (TERMINAL_APPROVAL_STATUSES as readonly string[]).includes(status)
}

/**
 * Mirror of public.approval_transition_allowed. Fails closed: anything
 * not explicitly permitted is denied, including unknown actor kinds.
 */
export function approvalTransitionAllowed(
  from: ApprovalStatus,
  to: ApprovalStatus,
  actorKind: string
): boolean {
  switch (actorKind) {
    case 'prime':
      // PRIME resolves pending requests, and may cancel a resolved one
      // that has not been executed.
      if (from === 'pending') {
        return to === 'approved' || to === 'rejected' || to === 'modified' || to === 'cancelled'
      }
      if (from === 'approved' || from === 'modified') return to === 'cancelled'
      return false
    case 'system':
      // The system expires anything still actionable.
      return (from === 'pending' || from === 'approved' || from === 'modified') && to === 'expired'
    case 'executor':
      // Only an executor records the outcome of an approved action.
      return (from === 'approved' || from === 'modified') && (to === 'executed' || to === 'failed')
    default:
      return false
  }
}

/** Every transition an actor kind may apply from a given status. */
export function allowedTransitionsFrom(
  from: ApprovalStatus,
  actorKind: TransitionActorKind,
  statuses: readonly ApprovalStatus[]
): ApprovalStatus[] {
  return statuses.filter((to) => approvalTransitionAllowed(from, to, actorKind))
}
