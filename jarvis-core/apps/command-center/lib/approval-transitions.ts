// ---------------------------------------------------------------------
// Approval transition presentation layer.
//
// The transition RULES live in one place only: the SQL function
// public.approval_transition_allowed (migration 0010). Nothing here
// decides whether a transition is legal — the database does, and this
// module only translates its answer into something a person can read.
//
// Keeping it pure and separate means the mapping is unit-testable
// without a database, and a new approval status changes SQL plus this
// table, never scattered branches.
// The transition matrix and the request-origin enumeration live in
// @jarvis/shared, which is pinned to the SQL by
// supabase/tests/transition_parity.sh. They are deliberately not
// redefined here.
// ---------------------------------------------------------------------

/** Resolutions PRIME can apply from the Command Centre. */
export const PRIME_RESOLUTIONS = ['approved', 'rejected', 'modified', 'cancelled'] as const

export type PrimeResolution = (typeof PRIME_RESOLUTIONS)[number]

export function isPrimeResolution(value: string): value is PrimeResolution {
  return (PRIME_RESOLUTIONS as readonly string[]).includes(value)
}

/**
 * Error identifiers raised by the auditing RPCs. These are contract, not
 * prose: the SQL raises exactly these strings and this module is the
 * only place that interprets them.
 */
export const RPC_ERROR_REASONS = [
  'not_prime',
  'approval_not_found',
  'membership_not_found',
  'agent_not_found',
  'role_not_found',
  'stale_status',
  'invalid_transition',
  'self_modification_denied',
  'last_prime_protected',
  'single_prime_violation',
  'authority_ceiling_exceeded',
  'requester_required',
  'request_id_required',
  'invalid_request_origin',
  'invalid_amount',
] as const

export type RpcErrorReason = (typeof RPC_ERROR_REASONS)[number]

/**
 * Shown when the failure is not one we recognise. Deliberately says
 * nothing about why: an unmapped error may carry database internals,
 * and a generic message is the fail-closed choice.
 */
export const GENERIC_TRANSITION_ERROR = 'Could not complete that change. Please try again.'

const REASON_MESSAGES: Record<RpcErrorReason, string> = {
  not_prime: 'Only PRIME can perform this action.',
  approval_not_found: 'Approval not found.',
  membership_not_found: 'Membership not found.',
  agent_not_found: 'Agent not found.',
  role_not_found: 'That role does not exist.',
  stale_status: 'This record changed while you were viewing it. Reload and try again.',
  invalid_transition: 'That is not a valid change for this record.',
  self_modification_denied: 'You cannot change your own membership.',
  last_prime_protected: 'The last PRIME cannot be removed.',
  single_prime_violation: 'An organization can have only one PRIME.',
  authority_ceiling_exceeded: 'You cannot grant authority above your own level.',
  requester_required: 'An approval must record who requested it.',
  request_id_required: 'This request is missing its identifier.',
  invalid_request_origin: 'This request came from an unrecognised source.',
  invalid_amount: 'That amount is not valid.',
}

/**
 * Extracts the reason identifier from a PostgREST/pg error message.
 * The RPCs raise a bare identifier, but the transport wraps it, so the
 * identifier is matched as a whole word rather than by equality.
 */
export function parseRpcErrorReason(message: string | null | undefined): RpcErrorReason | null {
  if (!message) return null
  for (const reason of RPC_ERROR_REASONS) {
    // Word-boundary match so 'not_prime' never matches inside another token.
    if (new RegExp(`(^|[^a-z_])${reason}([^a-z_]|$)`).test(message)) {
      return reason
    }
  }
  return null
}

/**
 * Maps an RPC failure to a message safe to show a user. Anything
 * unrecognised collapses to GENERIC_TRANSITION_ERROR so database
 * internals never reach the browser.
 */
export function describeRpcError(message: string | null | undefined): string {
  const reason = parseRpcErrorReason(message)
  return reason ? REASON_MESSAGES[reason] : GENERIC_TRANSITION_ERROR
}

/**
 * True when the failure means the caller's view of the record was out of
 * date, so the correct response is to refresh rather than to retry.
 */
export function isStaleViewError(message: string | null | undefined): boolean {
  const reason = parseRpcErrorReason(message)
  return reason === 'stale_status' || reason === 'invalid_transition'
}
