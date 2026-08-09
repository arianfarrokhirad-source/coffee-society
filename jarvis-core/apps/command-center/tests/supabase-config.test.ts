import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classifyAuthError, explainAuthError } from '@/lib/auth-errors'
import {
  configurationIsBroken,
  describeConfigForLog,
  projectRefFromUrl,
  readAnonKeyClaims,
  readSupabaseConfigStatus,
} from '@/lib/supabase/config'

// The 401 diagnosis, pinned.
//
// An anon key that does not belong to the project in
// NEXT_PUBLIC_SUPABASE_URL is rejected by the Supabase API gateway
// before GoTrue is reached: HTTP 401 with no `code`. Every genuine
// GoTrue refusal carries a code, and a wrong password is 400
// `invalid_credentials`. So "401 and no code" identifies a broken
// deployment, and must never be reported as a credential problem.

/** Builds a JWT-shaped key with the given public claims. No signature. */
function fakeKey(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url').replace(/=+$/, '')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.not-a-real-signature`
}

const REF_A = 'aaaaaaaaaaaaaaaaaaaa'
const REF_B = 'bbbbbbbbbbbbbbbbbbbb'
const FUTURE = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365
const PAST = Math.floor(Date.now() / 1000) - 60

const original = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${REF_A}.supabase.co`
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = fakeKey({
    iss: 'supabase',
    ref: REF_A,
    role: 'anon',
    exp: FUTURE,
  })
})

afterEach(() => {
  if (original.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
  else process.env.NEXT_PUBLIC_SUPABASE_URL = original.url
  if (original.key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = original.key
})

describe('projectRefFromUrl', () => {
  it('reads the ref from a Supabase host', () => {
    expect(projectRefFromUrl(`https://${REF_A}.supabase.co`)).toBe(REF_A)
  })

  it('returns null for a self-hosted or custom domain', () => {
    // There is no ref to compare, so claiming a mismatch would be a
    // false accusation.
    expect(projectRefFromUrl('https://db.example.test')).toBeNull()
  })

  it('returns null for absent or malformed input', () => {
    expect(projectRefFromUrl(undefined)).toBeNull()
    expect(projectRefFromUrl('not a url')).toBeNull()
  })
})

describe('readAnonKeyClaims', () => {
  it('reads ref, role and exp from a JWT key', () => {
    const claims = readAnonKeyClaims(fakeKey({ ref: REF_A, role: 'anon', exp: FUTURE }))
    expect(claims).toEqual({ ref: REF_A, role: 'anon', exp: FUTURE })
  })

  it('returns nothing for an opaque publishable key', () => {
    // sb_publishable_… keys are not JWTs and carry no claims. Absence is
    // a fact, not a fault.
    expect(readAnonKeyClaims('sb_publishable_abc123')).toEqual({
      ref: null,
      role: null,
      exp: null,
    })
  })

  it('survives a malformed key without throwing', () => {
    expect(readAnonKeyClaims('a.b.c')).toEqual({ ref: null, role: null, exp: null })
    expect(readAnonKeyClaims('')).toEqual({ ref: null, role: null, exp: null })
  })
})

describe('readSupabaseConfigStatus', () => {
  it('reports a matching key and URL as healthy', () => {
    const status = readSupabaseConfigStatus()
    expect(status.refsMatch).toBe(true)
    expect(status.keyRole).toBe('anon')
    expect(configurationIsBroken(status)).toBe(false)
  })

  it('detects a key belonging to a different project', () => {
    // The exact failure behind the reported 401.
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = fakeKey({
      ref: REF_B,
      role: 'anon',
      exp: FUTURE,
    })
    const status = readSupabaseConfigStatus()
    expect(status.refsMatch).toBe(false)
    expect(configurationIsBroken(status)).toBe(true)
  })

  it('detects an expired key', () => {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = fakeKey({ ref: REF_A, role: 'anon', exp: PAST })
    expect(configurationIsBroken(readSupabaseConfigStatus())).toBe(true)
  })

  it('detects a service-role key on the browser-facing variable', () => {
    // Both a misconfiguration and a credential leak: NEXT_PUBLIC_ values
    // are compiled into the client bundle.
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = fakeKey({
      ref: REF_A,
      role: 'service_role',
      exp: FUTURE,
    })
    const status = readSupabaseConfigStatus()
    expect(status.serviceRoleMisplaced).toBe(true)
    expect(configurationIsBroken(status)).toBe(true)
  })

  it('detects missing variables', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const status = readSupabaseConfigStatus()
    expect(status.urlPresent).toBe(false)
    expect(status.anonKeyPresent).toBe(false)
    expect(configurationIsBroken(status)).toBe(true)
  })

  it('does not accuse a publishable key it cannot compare', () => {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_abc123'
    const status = readSupabaseConfigStatus()
    expect(status.refsMatch).toBeNull()
    expect(configurationIsBroken(status)).toBe(false)
  })
})

describe('the log summary never carries key material', () => {
  it('reports only public facts', () => {
    const secretish = fakeKey({ ref: REF_A, role: 'anon', exp: FUTURE })
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = secretish

    const serialised = JSON.stringify(describeConfigForLog(readSupabaseConfigStatus()))
    // The key itself, and its signature segment, must never appear.
    expect(serialised).not.toContain(secretish)
    expect(serialised).not.toContain('not-a-real-signature')
    // Project refs are already public — they are the URL's subdomain.
    expect(serialised).toContain(REF_A)
    expect(serialised).toContain('refs_match')
  })
})

describe('401 without a code is a deployment fault, not a user fault', () => {
  it('classifies as configuration for registration', () => {
    expect(classifyAuthError({ status: 401 }, 'sign_up')).toBe('configuration')
  })

  it('classifies as configuration for sign-in too', () => {
    // The latent bug this closes: with a mismatched key, sign-in told
    // every user their password was wrong, forever, and no amount of
    // retyping could fix it.
    expect(classifyAuthError({ status: 401 }, 'sign_in')).toBe('configuration')
  })

  it('says plainly that the user cannot fix it', () => {
    const { message } = explainAuthError({ status: 401 }, 'sign_up')
    expect(message).toMatch(/not configured correctly/i)
    expect(message).toMatch(/no action on your side/i)
    expect(message).toMatch(/status: 401/)
  })

  it('leaves a coded 401 alone', () => {
    // A 401 carrying a GoTrue code is a GoTrue decision, not a gateway
    // rejection, and must keep its own classification.
    expect(classifyAuthError({ status: 401, code: 'email_exists' }, 'sign_up')).toBe('email_exists')
  })

  it('still treats 400 invalid_credentials as a credential problem on sign-in', () => {
    expect(classifyAuthError({ status: 400, code: 'invalid_credentials' }, 'sign_in')).toBe(
      'invalid_credentials'
    )
  })
})
