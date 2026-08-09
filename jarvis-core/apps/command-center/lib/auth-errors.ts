// ---------------------------------------------------------------------
// Authentication failure classification.
//
// Supabase Auth returns a rich error (message, HTTP status, and a stable
// `code` enum). The previous handlers discarded all of it and returned
// one fixed sentence, which made a real outage undiagnosable from the
// UI: "the email may already be registered" was shown for signups
// disabled, weak passwords, and database trigger failures alike.
//
// This module maps the error to a bounded set of kinds and produces a
// message that is useful to the person in front of the screen without
// leaking anything. The RULE, and the reason this is pure and tested:
//
//   * the Supabase `code` may be surfaced — it is a documented,
//     enumerated token (`email_exists`, `weak_password`, …), not
//     internal state, and it is what makes a support request tractable;
//   * the Supabase `message` is NEVER surfaced — it is free text that
//     can carry hostnames, SQL, constraint names or driver detail.
//
// Codes are additionally shape-checked before display, so a value from
// an SDK we have not seen cannot smuggle arbitrary text to the browser.
// ---------------------------------------------------------------------

export const AUTH_FAILURE_KINDS = [
  'invalid_email',
  'weak_password',
  'signup_disabled',
  'email_exists',
  'email_confirmation_required',
  'invalid_credentials',
  'database_error',
  'rate_limited',
  'configuration',
  'network',
  'unknown',
] as const

export type AuthFailureKind = (typeof AUTH_FAILURE_KINDS)[number]

/** The shape we consume — matches Supabase's AuthError without importing it. */
export interface AuthErrorLike {
  message?: string | null
  status?: number | null
  code?: string | null
  name?: string | null
}

/**
 * A code is displayable only if it looks like the documented enum
 * tokens. Anything else is dropped rather than rendered.
 */
const SAFE_CODE = /^[a-z][a-z0-9_]{1,62}$/

export function isDisplayableCode(code: string | null | undefined): boolean {
  return typeof code === 'string' && SAFE_CODE.test(code)
}

const CODE_KINDS: Record<string, AuthFailureKind> = {
  // Signup
  email_exists: 'email_exists',
  user_already_exists: 'email_exists',
  signup_disabled: 'signup_disabled',
  email_provider_disabled: 'signup_disabled',
  provider_disabled: 'signup_disabled',
  weak_password: 'weak_password',
  email_address_invalid: 'invalid_email',
  validation_failed: 'invalid_email',
  // Sign-in
  invalid_credentials: 'invalid_credentials',
  email_not_confirmed: 'email_confirmation_required',
  user_not_found: 'invalid_credentials',
  // Infrastructure
  unexpected_failure: 'database_error',
  over_request_rate_limit: 'rate_limited',
  over_email_send_rate_limit: 'rate_limited',
  request_timeout: 'network',
}

/**
 * Which operation produced the failure.
 *
 * This is not decoration. The status-based fallbacks below are only
 * meaningful in context: HTTP 400 during sign-in almost always means bad
 * credentials, but during REGISTRATION it means something else entirely
 * and "those credentials are not valid" is both wrong and confusing —
 * there are no credentials to be invalid yet.
 */
export type AuthOperation = 'sign_in' | 'sign_up'

/**
 * Classifies a Supabase auth failure. Falls back through code → error
 * class name → HTTP status, and finally to `unknown`, which is the
 * fail-closed answer: an unrecognised failure is never described as
 * something reassuring.
 *
 * `operation` defaults to sign-in because that is the only path whose
 * fallbacks are credential-shaped; every other caller must say so.
 */
export function classifyAuthError(
  error: AuthErrorLike | null | undefined,
  operation: AuthOperation = 'sign_in'
): AuthFailureKind {
  if (!error) return 'unknown'

  const code = typeof error.code === 'string' ? error.code : ''
  if (code && CODE_KINDS[code]) {
    const kind = CODE_KINDS[code]
    // Defence against the same category error as the status fallback:
    // a credential verdict can never be the answer to "create account".
    if (kind === 'invalid_credentials' && operation === 'sign_up') return 'unknown'
    return kind
  }

  // Error classes the SDK raises without a server code.
  if (error.name === 'AuthRetryableFetchError') return 'network'
  if (error.name === 'AuthWeakPasswordError') return 'weak_password'
  if (error.name === 'AuthInvalidCredentialsError') {
    return operation === 'sign_in' ? 'invalid_credentials' : 'unknown'
  }

  // An ABSENT status means "no information", not "status zero". Reading
  // the two as the same thing made every unrecognised error look like a
  // network outage, which is the opposite of fail-closed: it invites a
  // pointless retry instead of reporting an unknown failure.
  if (typeof error.status !== 'number') return 'unknown'
  const status = error.status
  if (status === 0) return 'network'
  if (status === 429) return 'rate_limited'
  // 500 from GoTrue on a signup is overwhelmingly the trigger on
  // auth.users failing ("Database error saving new user"), which is the
  // one failure that leaves no user row behind.
  if (status >= 500) return 'database_error'
  if (status === 422) return 'invalid_email'

  // 401 with NO code is the signature of the Supabase API gateway
  // rejecting the apikey, before GoTrue is reached at all. Every genuine
  // GoTrue refusal carries a code, and a wrong password is 400
  // `invalid_credentials`, never 401. So this is a deployment
  // misconfiguration — an anon key that does not belong to the project
  // in NEXT_PUBLIC_SUPABASE_URL, or one that is expired or revoked.
  //
  // Reporting it as `unknown` (registration) or `invalid_credentials`
  // (sign-in) was actively harmful: the first is undiagnosable and the
  // second blames the user's password for a broken deployment, which no
  // amount of retyping can fix.
  if (status === 401 && !code) return 'configuration'

  // 400 means "bad credentials" ONLY when credentials were being
  // checked. During registration there is nothing to authenticate yet,
  // so an unmapped 4xx is genuinely unknown and must say so — reporting
  // it as invalid credentials sends the user to fix a password that was
  // never the problem, and hides a real server-side cause such as
  // signups being disabled.
  if (status === 400 || status === 401) {
    return operation === 'sign_in' ? 'invalid_credentials' : 'unknown'
  }

  return 'unknown'
}

const KIND_MESSAGES: Record<AuthFailureKind, string> = {
  invalid_email: 'That email address was rejected. Check it and try again.',
  weak_password:
    'That password was rejected as too weak. Use at least 10 characters and avoid common passwords.',
  signup_disabled:
    'Account creation is disabled for this project. Enable email signups in Supabase → Authentication → Providers, or ask PRIME to create the account.',
  email_exists: 'That email is already registered. Try signing in instead.',
  email_confirmation_required:
    'This account still needs email confirmation. Check your inbox, then sign in.',
  invalid_credentials: 'Those credentials are not valid.',
  database_error:
    'The account could not be saved. This is a server-side database error, not a problem with what you typed — report the code below to PRIME.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  configuration:
    'This deployment is not configured correctly. Report the code below to PRIME — no action on your side will fix it.',
  network: 'Could not reach the authentication service. Check connectivity and try again.',
  unknown:
    'This did not succeed, and the reason was not one we recognise. It is not necessarily anything you typed — report the code or status below to PRIME.',
}

/**
 * Builds the user-facing message. Appends the Supabase code when it is
 * displayable, because the whole point of this hotfix is that a failure
 * can be acted on rather than guessed at.
 */
export function describeAuthFailure(
  kind: AuthFailureKind,
  code?: string | null,
  status?: number | null
): string {
  const base = KIND_MESSAGES[kind]
  if (isDisplayableCode(code)) return `${base} (code: ${code})`
  // No code: the HTTP status is the only diagnostic left, and a status
  // number carries nothing sensitive. Without this an unmapped failure
  // is completely undiagnosable from the UI — which is the whole problem
  // this module exists to solve.
  if (typeof status === 'number' && status >= 100 && status <= 599) {
    return `${base} (status: ${status})`
  }
  return base
}

/** Convenience: classify and describe in one step. */
export function explainAuthError(
  error: AuthErrorLike | null | undefined,
  operation: AuthOperation = 'sign_in'
): { kind: AuthFailureKind; message: string } {
  const kind = classifyAuthError(error, operation)
  return { kind, message: describeAuthFailure(kind, error?.code, error?.status) }
}

/**
 * Supabase hides account enumeration when email confirmation is on: a
 * signup for an existing address succeeds and returns a user whose
 * `identities` array is empty. Treating that as "check your inbox" is
 * correct and deliberately does not confirm whether the address exists.
 */
export function isObfuscatedExistingUser(
  user:
    | {
        identities?: unknown[] | null
      }
    | null
    | undefined
): boolean {
  return !!user && Array.isArray(user.identities) && user.identities.length === 0
}
