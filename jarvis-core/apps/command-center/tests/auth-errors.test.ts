import { describe, expect, it } from 'vitest'
import {
  AUTH_FAILURE_KINDS,
  classifyAuthError,
  describeAuthFailure,
  explainAuthError,
  isDisplayableCode,
  isObfuscatedExistingUser,
  type AuthErrorLike,
  type AuthFailureKind,
} from '../lib/auth-errors'

// The blocker these pin: every signup failure previously collapsed to
// "the email may already be registered", which made a real outage
// indistinguishable from a duplicate account.

describe('signup failures are distinguished', () => {
  const cases: [string, number, AuthFailureKind][] = [
    ['email_exists', 422, 'email_exists'],
    ['user_already_exists', 422, 'email_exists'],
    ['signup_disabled', 422, 'signup_disabled'],
    ['email_provider_disabled', 422, 'signup_disabled'],
    ['weak_password', 422, 'weak_password'],
    ['email_address_invalid', 400, 'invalid_email'],
    ['over_email_send_rate_limit', 429, 'rate_limited'],
    ['unexpected_failure', 500, 'database_error'],
  ]

  it.each(cases)('maps %s to its own kind', (code, status, expected) => {
    expect(classifyAuthError({ code, status })).toBe(expected)
  })

  it('gives each kind a distinct message', () => {
    const seen = new Set(AUTH_FAILURE_KINDS.map((k) => describeAuthFailure(k)))
    expect(seen.size).toBe(AUTH_FAILURE_KINDS.length)
  })

  it('never claims "already registered" for a database failure', () => {
    const { kind, message } = explainAuthError({
      code: 'unexpected_failure',
      status: 500,
      message: 'Database error saving new user',
    })
    expect(kind).toBe('database_error')
    expect(message).not.toMatch(/already registered/i)
    expect(message).toMatch(/database error/i)
  })

  it('classifies a 500 with no code as a database failure', () => {
    // "Database error saving new user" is the signature of the
    // handle_new_user trigger failing, and the only failure that leaves
    // no row in Supabase Authentication.
    expect(classifyAuthError({ status: 500, message: 'Database error saving new user' })).toBe(
      'database_error'
    )
  })
})

describe('sign-in failures are distinguished', () => {
  it('separates bad credentials from unconfirmed email', () => {
    expect(classifyAuthError({ code: 'invalid_credentials', status: 400 })).toBe(
      'invalid_credentials'
    )
    expect(classifyAuthError({ code: 'email_not_confirmed', status: 400 })).toBe(
      'email_confirmation_required'
    )
  })

  it('treats an unreachable service as network, not bad credentials', () => {
    expect(classifyAuthError({ name: 'AuthRetryableFetchError', status: 0 })).toBe('network')
    expect(classifyAuthError({ status: 0 })).toBe('network')
  })

  it('does not reveal whether the account exists', () => {
    const message = describeAuthFailure('invalid_credentials')
    expect(message).not.toMatch(/no account|not found|does not exist|unknown user/i)
  })
})

describe('fail-closed classification', () => {
  it('returns unknown for null, undefined and empty errors', () => {
    expect(classifyAuthError(null)).toBe('unknown')
    expect(classifyAuthError(undefined)).toBe('unknown')
    expect(classifyAuthError({})).toBe('unknown')
  })

  it('never describes an unrecognised failure reassuringly', () => {
    const message = describeAuthFailure(classifyAuthError({ code: 'brand_new_code_we_dont_know' }))
    expect(message).toMatch(/not one we recognise|unrecognised/i)
    // It must not imply success or that nothing is wrong.
    expect(message).not.toMatch(/success|completed|no problem|try again later/i)
  })
})

describe('nothing sensitive reaches the browser', () => {
  it('surfaces the code but never the raw message', () => {
    const message = explainAuthError({
      code: 'unexpected_failure',
      status: 500,
      message:
        'insert into "public"."profiles" failed at db.abcdefg.supabase.co:5432 — permission denied for relation profiles',
    }).message
    expect(message).toContain('code: unexpected_failure')
    expect(message).not.toMatch(/supabase\.co|5432|public\.|permission denied|insert into/i)
  })

  it('refuses to display a code that is not an enum-shaped token', () => {
    for (const bad of [
      'Bearer eyJhbGciOiJIUzI1NiJ9',
      'sk-abc123',
      'error at https://db.internal',
      'UPPER_CASE',
      '1_leading_digit',
      'has spaces',
      'x'.repeat(200),
      '',
      null,
      undefined,
    ]) {
      expect(isDisplayableCode(bad as string)).toBe(false)
      expect(describeAuthFailure('unknown', bad as string)).not.toContain('code:')
    }
  })

  it('accepts the documented enum tokens', () => {
    for (const good of ['email_exists', 'weak_password', 'unexpected_failure', 'signup_disabled']) {
      expect(isDisplayableCode(good)).toBe(true)
      expect(describeAuthFailure('unknown', good)).toContain(`code: ${good}`)
    }
  })
})

describe('account enumeration stays closed on signup', () => {
  it('detects the obfuscated existing user Supabase returns', () => {
    expect(isObfuscatedExistingUser({ identities: [] })).toBe(true)
    expect(isObfuscatedExistingUser({ identities: [{ id: 'x' }] })).toBe(false)
    expect(isObfuscatedExistingUser(null)).toBe(false)
    expect(isObfuscatedExistingUser(undefined)).toBe(false)
    expect(isObfuscatedExistingUser({})).toBe(false)
  })
})

describe('a credential verdict can never come from registration', () => {
  // The defect this pins: an unmapped HTTP 400 from signUp was
  // classified as invalid_credentials, so /register told the user
  // "Those credentials are not valid" for a brand-new email — sending
  // them to fix a password that was never the problem and hiding the
  // real server-side cause.
  const SIGNUP_FAILURES: AuthErrorLike[] = [
    { status: 400, message: 'Signups not allowed for this instance' },
    { status: 400, message: 'Email signups are disabled' },
    { status: 401, message: 'unauthorized' },
    { status: 400, code: 'invalid_credentials' },
    { status: 400, code: 'user_not_found' },
    { name: 'AuthInvalidCredentialsError' },
  ]

  it.each(SIGNUP_FAILURES.map((e, i) => [i, e] as const))(
    'never returns invalid_credentials for signup failure %i',
    (_i, error) => {
      expect(classifyAuthError(error, 'sign_up')).not.toBe('invalid_credentials')
      expect(explainAuthError(error, 'sign_up').message).not.toMatch(/credentials are not valid/i)
    }
  )

  it('still returns invalid_credentials for the same errors during sign-in', () => {
    expect(classifyAuthError({ status: 400 }, 'sign_in')).toBe('invalid_credentials')
    // 401 is deliberately absent here: a bare 401 is a gateway apikey
    // rejection, not a password verdict, and now classifies as
    // `configuration` for BOTH operations. See the block below.
    expect(classifyAuthError({ code: 'invalid_credentials' }, 'sign_in')).toBe(
      'invalid_credentials'
    )
  })

  it('defaults to sign-in so an unmarked caller keeps the old behaviour', () => {
    expect(classifyAuthError({ status: 400 })).toBe('invalid_credentials')
  })

  it('still classifies signup-specific codes correctly under sign_up', () => {
    expect(classifyAuthError({ status: 422, code: 'signup_disabled' }, 'sign_up')).toBe(
      'signup_disabled'
    )
    expect(classifyAuthError({ status: 422, code: 'email_exists' }, 'sign_up')).toBe('email_exists')
    expect(classifyAuthError({ status: 500, code: 'unexpected_failure' }, 'sign_up')).toBe(
      'database_error'
    )
  })

  it('says the failure may not be the user’s fault when it is unknown', () => {
    const message = explainAuthError({ status: 400 }, 'sign_up').message
    expect(message).toMatch(/not necessarily anything you typed/i)
  })
})

describe('an unmapped failure still carries a diagnostic', () => {
  it('falls back to the HTTP status when there is no code', () => {
    expect(explainAuthError({ status: 400 }, 'sign_up').message).toContain('(status: 400)')
    expect(describeAuthFailure('unknown', null, 503)).toContain('(status: 503)')
  })

  it('prefers the code over the status when both are present', () => {
    const message = explainAuthError({ status: 422, code: 'signup_disabled' }, 'sign_up').message
    expect(message).toContain('(code: signup_disabled)')
    expect(message).not.toContain('status:')
  })

  it('omits an implausible status rather than printing nonsense', () => {
    for (const bad of [0, 42, 999, -1, Number.NaN]) {
      expect(describeAuthFailure('unknown', null, bad)).not.toContain('status:')
    }
  })

  it('never turns the status into a leak', () => {
    const message = describeAuthFailure('unknown', null, 400)
    expect(message).not.toMatch(/supabase\.co|5432|https?:\/\//)
  })
})
