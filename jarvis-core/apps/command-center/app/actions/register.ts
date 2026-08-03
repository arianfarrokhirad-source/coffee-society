'use server'

import { redirect } from 'next/navigation'
import { buildAuditEvent } from '@jarvis/security'
import { getStore } from '@/lib/jarvis'
import { createUserClient } from '@/lib/supabase/server'
import { explainAuthError, isObfuscatedExistingUser } from '@/lib/auth-errors'
import { buildSignupMetadata, firstFieldError, registrationSchema } from '@/lib/registration'

// ---------------------------------------------------------------------
// Registration.
//
// Creates a Supabase Auth user and, through handle_new_user (migration
// 0011), the matching public.profiles row. It creates NOTHING else: no
// membership, no role, no permission, no PRIME. PRIME remains reachable
// only through claimPrime → claim_prime_with_nonce, which is
// service-role-only and setup-token gated.
//
// PII discipline, enforced here rather than by redaction:
//   * password and confirmPassword never leave this function — not to
//     metadata, not to logs, not to audit, not to any column;
//   * the audit event carries the actor id and nothing else. Name,
//     phone and date of birth are never written to telemetry. The
//     redaction key list is defence in depth, not the control.
// ---------------------------------------------------------------------

export interface RegistrationFormState {
  error: string | null
  notice?: string | null
  /**
   * Increments on every return. The form keys both password inputs on
   * it, so React remounts them and BOTH password fields are cleared
   * after a failure — retyping a password is safer than leaving it
   * sitting in the DOM.
   */
  attempt?: number
  /** Echoed back so a failure does not wipe the form. Never the password. */
  values?: {
    displayName?: string
    email?: string
    phone?: string
    dateOfBirth?: string
  }
}

const field = (data: FormData, name: string): string => {
  const value = data.get(name)
  return typeof value === 'string' ? value : ''
}

export async function register(
  prev: RegistrationFormState,
  formData: FormData
): Promise<RegistrationFormState> {
  const attempt = (prev.attempt ?? 0) + 1
  // Everything except the two password fields is safe to echo back.
  const values = {
    displayName: field(formData, 'displayName'),
    email: field(formData, 'email'),
    phone: field(formData, 'phone'),
    dateOfBirth: field(formData, 'dateOfBirth'),
  }

  const parsed = registrationSchema.safeParse({
    ...values,
    password: field(formData, 'password'),
    confirmPassword: field(formData, 'confirmPassword'),
  })
  if (!parsed.success) {
    return { error: firstFieldError(parsed.error.issues), values, attempt }
  }

  const supabase = await createUserClient()
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: buildSignupMetadata(parsed.data) },
  })
  if (error) return { error: explainAuthError(error, 'sign_up').message, values, attempt }

  // Telemetry only, and best-effort: a failure here must never undo an
  // account that already exists. Actor id only — no profile fields.
  try {
    await getStore().writeAudit(
      buildAuditEvent({
        actorType: 'user',
        actorId: data.user?.id ?? null,
        action: 'auth.sign_up',
      })
    )
  } catch (cause) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'auth.telemetry_failed',
        action: 'auth.sign_up',
        reason: cause instanceof Error ? cause.message : 'unknown',
      })
    )
  }

  // Email confirmation disabled: a session is issued immediately.
  if (data.session) redirect('/executive')

  // Confirmation enabled for an address that already exists: Supabase
  // returns a user with no identities rather than admitting the account
  // exists. Give the same answer either way so registration cannot be
  // used to enumerate accounts.
  if (isObfuscatedExistingUser(data.user)) {
    return {
      error: null,
      notice: 'Check your email to confirm this address, then sign in.',
      values,
      attempt,
    }
  }

  return {
    error: null,
    notice: 'Account created. Check your email to confirm it, then sign in.',
    values,
    attempt,
  }
}
