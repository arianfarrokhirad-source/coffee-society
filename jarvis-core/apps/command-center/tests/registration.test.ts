import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { redactSecrets } from '@jarvis/security'
import {
  buildSignupMetadata,
  calculateAge,
  E164,
  firstFieldError,
  isUsableBirthDate,
  MIN_PASSWORD_LENGTH,
  parseIsoDate,
  registrationSchema,
} from '../lib/registration'

const app = (...p: string[]) => join(__dirname, '..', ...p)
const read = (...p: string[]) => readFileSync(app(...p), 'utf8')

/**
 * Strips comments so structural assertions test the CODE, not the prose
 * describing it. Without this, a comment saying "creates no membership"
 * fails an assertion that the file never mentions memberships.
 */
const code = (...p: string[]) =>
  read(...p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const valid = {
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  password: 'correct-horse-battery',
  confirmPassword: 'correct-horse-battery',
  phone: '+447700900123',
  dateOfBirth: '1990-05-04',
}

describe('registration validation', () => {
  it('accepts a complete valid payload', () => {
    const result = registrationSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('accepts a payload with both optional fields omitted', () => {
    const { phone, dateOfBirth, ...required } = valid
    void phone
    void dateOfBirth
    expect(registrationSchema.safeParse(required).success).toBe(true)
  })

  it('treats empty optional fields as absent, not as invalid', () => {
    const result = registrationSchema.safeParse({ ...valid, phone: '', dateOfBirth: '' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.phone).toBeUndefined()
      expect(result.data.dateOfBirth).toBeUndefined()
    }
  })

  it.each([
    ['missing full name', { displayName: '' }, 'displayName'],
    ['whitespace-only name', { displayName: '   ' }, 'displayName'],
    ['invalid email', { email: 'not-an-email' }, 'email'],
    ['short password', { password: 'x'.repeat(9), confirmPassword: 'x'.repeat(9) }, 'password'],
    ['password mismatch', { confirmPassword: 'something-else-entirely' }, 'confirmPassword'],
    ['national phone', { phone: '07700900123' }, 'phone'],
    ['phone with spaces', { phone: '+44 7700 900123' }, 'phone'],
    ['malformed date', { dateOfBirth: 'not-a-date' }, 'dateOfBirth'],
    ['impossible date', { dateOfBirth: '2024-02-31' }, 'dateOfBirth'],
    ['future date', { dateOfBirth: '2999-01-01' }, 'dateOfBirth'],
    ['date on the 1900 floor', { dateOfBirth: '1900-01-01' }, 'dateOfBirth'],
    ['date before 1900', { dateOfBirth: '1899-12-31' }, 'dateOfBirth'],
    ['non-ISO date', { dateOfBirth: '04/05/1990' }, 'dateOfBirth'],
  ])('rejects %s', (_label, patch, expectedField) => {
    const result = registrationSchema.safeParse({ ...valid, ...patch })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === expectedField)).toBe(true)
      expect(firstFieldError(result.error.issues)).toBeTruthy()
    }
  })

  it('rejects today as a date of birth, accepts yesterday', () => {
    const today = new Date('2026-08-02T00:00:00Z')
    expect(isUsableBirthDate('2026-08-02', today)).toBe(false)
    expect(isUsableBirthDate('2026-08-01', today)).toBe(true)
  })

  it('parses dates strictly rather than rolling over', () => {
    // new Date('2024-02-31') silently becomes 2 March; parseIsoDate must not.
    expect(parseIsoDate('2024-02-31')).toBeNull()
    expect(parseIsoDate('2024-02-29')).not.toBeNull() // 2024 is a leap year
    expect(parseIsoDate('2023-02-29')).toBeNull()
    expect(parseIsoDate('1990-13-01')).toBeNull()
  })

  it('keeps the 10-character minimum consistent with the UI and the sign-in schema', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10)
    expect(read('app', 'register', 'page.tsx')).toContain('minLength={10}')
    expect(read('app', 'actions', 'auth.ts')).toContain('z.string().min(10)')
  })

  it('never echoes a password back in a field error', () => {
    const result = registrationSchema.safeParse({ ...valid, confirmPassword: 'nope' })
    if (!result.success) {
      const message = firstFieldError(result.error.issues) ?? ''
      expect(message).not.toContain(valid.password)
      expect(message).not.toContain('nope')
    }
  })
})

describe('signup metadata is the PII boundary', () => {
  it('sends only the three permitted keys', () => {
    const parsed = registrationSchema.parse(valid)
    expect(Object.keys(buildSignupMetadata(parsed)).sort()).toEqual([
      'date_of_birth',
      'display_name',
      'phone',
    ])
  })

  it('omits optional fields rather than sending null', () => {
    const parsed = registrationSchema.parse({
      displayName: valid.displayName,
      email: valid.email,
      password: valid.password,
      confirmPassword: valid.confirmPassword,
    })
    expect(buildSignupMetadata(parsed)).toEqual({ display_name: 'Ada Lovelace' })
  })

  it('never puts a password in metadata', () => {
    const metadata = buildSignupMetadata(registrationSchema.parse(valid))
    const serialised = JSON.stringify(metadata)
    expect(serialised).not.toContain(valid.password)
    expect(Object.keys(metadata)).not.toContain('password')
    expect(Object.keys(metadata)).not.toContain('confirmPassword')
  })

  it('never offers a privilege-bearing key to the trigger', () => {
    const metadata = buildSignupMetadata(registrationSchema.parse(valid))
    for (const forbidden of [
      'role',
      'role_key',
      'authority_level',
      'organization_id',
      'business_id',
      'membership',
      'is_prime',
    ]) {
      expect(Object.keys(metadata)).not.toContain(forbidden)
    }
  })
})

describe('age is derived, never stored', () => {
  it('computes completed years', () => {
    const today = new Date('2026-08-02T12:00:00Z')
    expect(calculateAge('1990-05-04', today)).toBe(36)
    expect(calculateAge('2000-08-02', today)).toBe(26) // birthday today
    expect(calculateAge('2000-08-03', today)).toBe(25) // birthday tomorrow
    expect(calculateAge('2000-08-01', today)).toBe(26) // birthday yesterday
  })

  it('handles a 29 February birth date in a non-leap year', () => {
    expect(calculateAge('2000-02-29', new Date('2025-02-28T00:00:00Z'))).toBe(24)
    expect(calculateAge('2000-02-29', new Date('2025-03-01T00:00:00Z'))).toBe(25)
  })

  it('returns null for absent or unusable input rather than guessing', () => {
    const today = new Date('2026-08-02T00:00:00Z')
    for (const bad of [null, undefined, '', 'not-a-date', '2024-02-31']) {
      expect(calculateAge(bad, today)).toBeNull()
    }
  })

  it('has no age column anywhere in the schema', () => {
    const dir = join(__dirname, '..', '..', '..', 'supabase', 'migrations')
    const sql = readFileSync(join(dir, '0011_profile_identity.sql'), 'utf8')
    expect(sql).not.toMatch(/\badd column[^;]*\bage\b/i)
    expect(sql).not.toMatch(/\bsex\b\s+text/i)
    expect(sql).not.toMatch(/\bfull_name\b\s+text/i)
  })
})

describe('route structure', () => {
  it('makes /register public in middleware', () => {
    expect(read('middleware.ts')).toContain("'/register'")
  })

  it('links to /register from /login instead of submitting the form', () => {
    const login = code('app', 'login', 'page.tsx')
    expect(login).toContain('href="/register"')
    // The old second submit button is gone: no formAction, no signUp import.
    expect(login).not.toContain('formAction')
    expect(login).not.toContain('signUp')
  })

  it('links back to /login from /register', () => {
    expect(read('app', 'register', 'page.tsx')).toContain('href="/login"')
  })

  it('no longer exposes signUp from the auth action module', () => {
    expect(code('app', 'actions', 'auth.ts')).not.toContain('export async function signUp')
  })
})

describe('registration grants nothing', () => {
  it('never touches memberships, roles, permissions or PRIME', () => {
    const action = code('app', 'actions', 'register.ts')
    for (const forbidden of [
      'memberships',
      'roles',
      'permissions',
      'claim_prime',
      'authority_level',
      'createServiceClient',
    ]) {
      expect(action).not.toContain(forbidden)
    }
  })
})

describe('PII stays out of telemetry', () => {
  it('records only the actor id on the signup audit event', () => {
    const action = code('app', 'actions', 'register.ts')
    const call = /buildAuditEvent\(\{([\s\S]*?)\}\)/.exec(action)
    expect(call).not.toBeNull()
    const body = call![1]
    // The whole payload: actorType, actorId, action. Nothing else.
    expect(body).toContain('actorId')
    for (const field of ['displayName', 'phone', 'dateOfBirth', 'password', 'email', 'metadata']) {
      expect(body).not.toContain(field)
    }
  })

  it('redacts identity keys as defence in depth', () => {
    const redacted = redactSecrets({
      display_name: 'Ada Lovelace',
      full_name: 'Ada Lovelace',
      phone: '+447700900123',
      date_of_birth: '1990-05-04',
      dob: '1990-05-04',
      birth_date: '1990-05-04',
      password: 'secret',
      action: 'auth.sign_up',
    })
    const serialised = JSON.stringify(redacted)
    expect(serialised).not.toContain('Ada Lovelace')
    expect(serialised).not.toContain('447700900123')
    expect(serialised).not.toContain('1990-05-04')
    // Non-identity fields survive.
    expect(redacted).toMatchObject({ action: 'auth.sign_up' })
  })

  it('redacts camelCase identity keys too', () => {
    const redacted = redactSecrets({ displayName: 'Ada', phoneNumber: '+447700900123' })
    expect(JSON.stringify(redacted)).not.toContain('Ada')
    expect(JSON.stringify(redacted)).not.toContain('447700900123')
  })
})

describe('phone remains unverified', () => {
  it('matches the database constraint exactly', () => {
    const dir = join(__dirname, '..', '..', '..', 'supabase', 'migrations')
    const sql = readFileSync(join(dir, '0011_profile_identity.sql'), 'utf8')
    expect(sql).toContain(String.raw`^\+[1-9][0-9]{7,14}$`)
    expect(E164.source).toBe(String.raw`^\+[1-9][0-9]{7,14}$`)
  })

  it('is documented as unverified so it is not mistaken for a 2FA factor', () => {
    const dir = join(__dirname, '..', '..', '..', 'supabase', 'migrations')
    const sql = readFileSync(join(dir, '0011_profile_identity.sql'), 'utf8')
    expect(sql).toMatch(/UNVERIFIED/)
  })
})
