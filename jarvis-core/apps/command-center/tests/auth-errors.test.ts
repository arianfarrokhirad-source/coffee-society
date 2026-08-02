import { describe, expect, it } from 'vitest'
import {
  AUTH_FAILURE_KINDS,
  classifyAuthError,
  describeAuthFailure,
  explainAuthError,
  isDisplayableCode,
  isObfuscatedExistingUser,
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
    expect(message).toMatch(/unrecognised/i)
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
