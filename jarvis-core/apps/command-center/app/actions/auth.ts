'use server'

import { randomBytes } from 'node:crypto'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServiceClient } from '@jarvis/database'
import { buildAuditEvent, sha256Hex } from '@jarvis/security'
import { getStore } from '@/lib/jarvis'
import { createUserClient } from '@/lib/supabase/server'
import { describeAuthFailure, explainAuthError, isObfuscatedExistingUser } from '@/lib/auth-errors'
import {
  claimWindowStart,
  GENERIC_CLAIM_ERROR,
  isRateLimited,
  mapRpcErrorToReason,
  validateSetupToken,
  type ClaimDenialReason,
} from '@/lib/prime-claim'

const credentialsSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(10).max(200),
})

export interface AuthFormState {
  error: string | null
  /** Success/instructional text. Never rendered as a failure. */
  notice?: string | null
  /** Echoed back so an error does not wipe what the user typed. */
  email?: string | null
}

/**
 * Auth telemetry is best-effort and must never be able to fail an
 * authentication that already succeeded.
 *
 * `getStore()` constructs the service-role client eagerly and THROWS
 * when SUPABASE_SERVICE_ROLE_KEY is absent or malformed. Previously that
 * throw happened after signInWithPassword had already set the session
 * cookie, so a telemetry misconfiguration surfaced as "sign-in silently
 * does nothing" — the user was authenticated but the action threw
 * before redirecting. `auth.sign_in` is a TELEMETRY action, not a
 * critical one (see CRITICAL_AUDIT_ACTIONS in @jarvis/security): losing
 * it is an observability gap, not a governance failure.
 */
async function recordAuthTelemetry(action: string, actorId: string | null): Promise<void> {
  try {
    await getStore().writeAudit(buildAuditEvent({ actorType: 'user', actorId, action }))
  } catch (cause) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'auth.telemetry_failed',
        action,
        reason: cause instanceof Error ? cause.message : 'unknown',
      })
    )
  }
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = typeof formData.get('email') === 'string' ? String(formData.get('email')) : ''
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return { error: 'Enter a valid email and a password of at least 10 characters.', email }
  }

  const supabase = await createUserClient()
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) return { error: explainAuthError(error).message, email }
  if (!data.user) {
    return { error: describeAuthFailure('unknown'), email }
  }

  await recordAuthTelemetry('auth.sign_in', data.user.id)
  redirect('/executive')
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = typeof formData.get('email') === 'string' ? String(formData.get('email')) : ''
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return { error: 'Enter a valid email and a password of at least 10 characters.', email }
  }

  const supabase = await createUserClient()
  const { data, error } = await supabase.auth.signUp(parsed.data)
  if (error) return { error: explainAuthError(error).message, email }

  await recordAuthTelemetry('auth.sign_up', data.user?.id ?? null)

  // Confirmation disabled: a session is issued immediately.
  if (data.session) redirect('/executive')

  // Confirmation enabled for an address that already exists: Supabase
  // returns a user with no identities rather than admitting the account
  // exists. Do not contradict that — the instruction is the same either
  // way, and enumeration stays closed.
  if (isObfuscatedExistingUser(data.user)) {
    return {
      error: null,
      notice: 'Check your inbox to confirm this address, then sign in.',
      email,
    }
  }

  return {
    error: null,
    notice: 'Account created. Confirm your email if prompted, then sign in.',
    email,
  }
}

export async function signOut(): Promise<void> {
  const supabase = await createUserClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  await supabase.auth.signOut()
  if (user) {
    await getStore().writeAudit(
      buildAuditEvent({ actorType: 'user', actorId: user.id, action: 'auth.sign_out' })
    )
  }
  redirect('/login')
}

/**
 * Secure PRIME setup (Phase 1.1).
 *
 * Trust boundary: the raw setup token is validated HERE, in the server
 * action, against a server-only env var using constant-time comparison.
 * It never reaches PostgreSQL, logs, or the audit trail. Only a
 * short-lived, single-use, user-bound nonce crosses into the database,
 * where claim_prime_with_nonce() performs the membership insert and the
 * critical audit write in one transaction (service-role only RPC).
 *
 * Every failure returns ONE generic message; the specific reason code
 * is recorded internally as a `prime.claim_denied` audit row. Denial
 * auditing failure keeps the claim denied — denial is the safe state.
 */
export async function claimPrime(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const supabase = await createUserClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Bootstrap-only limiter + audit writes need service-role access.
  // Constructed before any token handling so a misconfigured server
  // fails closed rather than half-processing a claim.
  let service: ReturnType<typeof createServiceClient>
  try {
    service = createServiceClient()
  } catch {
    console.error(
      JSON.stringify({ level: 'error', event: 'prime.claim_denied', reason: 'rpc_failure' })
    )
    return { error: GENERIC_CLAIM_ERROR }
  }

  const deny = async (reason: ClaimDenialReason): Promise<AuthFormState> => {
    const { error } = await service.from('audit_logs').insert(
      buildAuditEvent({
        actorType: 'user',
        actorId: user?.id ?? null,
        action: 'prime.claim_denied',
        resourceType: 'membership',
        metadata: { reason },
      })
    )
    if (error) {
      // Denial stands regardless: refusing is the safe state.
      console.error(
        JSON.stringify({ level: 'error', event: 'prime.claim_denied.audit_failure', reason })
      )
    }
    return { error: GENERIC_CLAIM_ERROR }
  }

  if (!user) return deny('unauthenticated')

  // Refuse before ANY token comparison once PRIME exists.
  const { data: primeRole } = await service
    .from('roles')
    .select('id')
    .eq('key', 'prime')
    .maybeSingle()
  if (primeRole) {
    const { count } = await service
      .from('memberships')
      .select('id', { count: 'exact', head: true })
      .eq('role_id', primeRole.id)
      .eq('status', 'active')
    if ((count ?? 1) > 0) return deny('claim_already_completed')
  }

  // Persistent, cross-instance limiter over recent denial audit rows.
  const { count: denialCount, error: denialCountError } = await service
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('actor_id', user.id)
    .eq('action', 'prime.claim_denied')
    .gte('created_at', claimWindowStart())
  if (denialCountError || isRateLimited(denialCount)) return deny('rate_limited')

  const tokenField = formData.get('setupToken')
  const providedToken = typeof tokenField === 'string' ? tokenField : ''
  const tokenCheck = validateSetupToken(providedToken, {
    token: process.env.JARVIS_PRIME_SETUP_TOKEN,
  })
  if (!tokenCheck.ok) return deny(tokenCheck.reason)

  // Token validated: mint a single-use, user-bound, 2-minute nonce.
  // Only its SHA-256 hash is stored.
  const rawNonce = randomBytes(32).toString('base64url')
  const { error: nonceError } = await service.from('prime_claim_nonces').insert({
    nonce_hash: sha256Hex(rawNonce),
    user_id: user.id,
    expires_at: new Date(Date.now() + 2 * 60_000).toISOString(),
  })
  if (nonceError) return deny('rpc_failure')

  const { error: rpcError } = await service.rpc('claim_prime_with_nonce', {
    p_expected_user: user.id,
    p_nonce: rawNonce,
  })
  if (rpcError) return deny(mapRpcErrorToReason(rpcError.message))

  // Authorization reads memberships from the database on every request
  // (getAuthContext), so no JWT/custom-claim refresh is required —
  // revalidating cached route data is sufficient for PRIME access to
  // take effect immediately.
  revalidatePath('/', 'layout')
  redirect('/executive')
}
