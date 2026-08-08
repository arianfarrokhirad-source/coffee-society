import { constantTimeCompareSecrets } from '@jarvis/security'

// ---------------------------------------------------------------------
// Pure decision logic for the PRIME bootstrap. No I/O, no secrets in
// return values — the server action composes these with the database.
//
// The browser receives ONE generic message for every failure; the
// specific reason code is internal (audit + structured logs only).
// ---------------------------------------------------------------------

export const GENERIC_CLAIM_ERROR =
  'PRIME claim failed. Verify the setup token and try again; repeated attempts are rate limited.'

/** Internal-only reason codes. Never returned to the browser. */
export type ClaimDenialReason =
  | 'unauthenticated'
  | 'claim_already_completed'
  | 'rate_limited'
  | 'configuration_disabled'
  | 'invalid_token'
  | 'invalid_nonce'
  | 'expired_nonce'
  | 'consumed_nonce'
  | 'nonce_user_mismatch'
  | 'rpc_failure'
  | 'audit_failure'

/**
 * Minimum setup-token length. Documentation recommends generating at
 * least 32 random bytes (e.g. `openssl rand -base64 32`) rather than a
 * human-authored phrase of this length.
 */
export const MIN_SETUP_TOKEN_LENGTH = 32

/** Bootstrap-only limiter parameters (not the final distributed design). */
export const CLAIM_ATTEMPT_WINDOW_MS = 15 * 60_000
export const CLAIM_ATTEMPT_LIMIT = 5

export interface ClaimConfig {
  /** The configured setup token, or undefined when unset. */
  token: string | undefined
}

/**
 * Claiming is disabled unless a sufficiently long token is configured.
 * Fail closed: an unset or weak token means nobody can claim PRIME.
 */
export function isClaimEnabled(config: ClaimConfig): boolean {
  return typeof config.token === 'string' && config.token.length >= MIN_SETUP_TOKEN_LENGTH
}

/**
 * Validate a user-supplied token against the configured secret in
 * constant time. Returns a reason code, never the token itself.
 */
export function validateSetupToken(
  provided: string,
  config: ClaimConfig
): { ok: true } | { ok: false; reason: ClaimDenialReason } {
  if (!isClaimEnabled(config)) return { ok: false, reason: 'configuration_disabled' }
  if (!provided) return { ok: false, reason: 'invalid_token' }
  // config.token is non-empty per isClaimEnabled.
  return constantTimeCompareSecrets(provided, config.token as string)
    ? { ok: true }
    : { ok: false, reason: 'invalid_token' }
}

/**
 * Persistent (cross-instance) limiter decision based on the number of
 * recent denial audit rows for this actor. Malformed or missing counts
 * are treated as "limit reached" — fail closed.
 */
export function isRateLimited(recentDenialCount: number | null | undefined): boolean {
  if (typeof recentDenialCount !== 'number' || !Number.isFinite(recentDenialCount)) return true
  return recentDenialCount >= CLAIM_ATTEMPT_LIMIT
}

/** ISO timestamp marking the start of the limiter window. */
export function claimWindowStart(now: Date = new Date()): string {
  return new Date(now.getTime() - CLAIM_ATTEMPT_WINDOW_MS).toISOString()
}

/** Map a database error message to an internal reason code. */
export function mapRpcErrorToReason(message: string): ClaimDenialReason {
  const known: ClaimDenialReason[] = [
    'claim_already_completed',
    'invalid_nonce',
    'expired_nonce',
    'consumed_nonce',
    'nonce_user_mismatch',
  ]
  const match = known.find((reason) => message.includes(reason))
  return match ?? 'rpc_failure'
}
