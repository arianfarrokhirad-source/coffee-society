import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------
// Integration coverage for the registration server action.
//
// This is the wiring that broke twice and was diagnosed twice: once when
// every signup failure collapsed into "the email may already be
// registered", and once when an unmapped HTTP 400 from signUp was
// reported as "Those credentials are not valid." Both were failures of
// the action's plumbing, not of the pure helpers, and unit tests on the
// helpers could not have caught either.
//
// Everything below the action is mocked, so these run in CI with no
// Supabase project and no credentials.
// ---------------------------------------------------------------------

const signUp = vi.fn()
const writeAudit = vi.fn()
const redirect = vi.fn((path: string) => {
  // Next's redirect() throws to unwind the request. Mirroring that keeps
  // the action's control flow honest: code after a redirect must not run.
  throw new Error(`NEXT_REDIRECT:${path}`)
})

vi.mock('@/lib/supabase/server', () => ({
  createUserClient: async () => ({ auth: { signUp } }),
}))

vi.mock('@/lib/jarvis', () => ({
  getStore: () => ({ writeAudit }),
}))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirect(path),
}))

const { register } = await import('@/app/actions/register')

function form(overrides: Record<string, string> = {}): FormData {
  const data = new FormData()
  const fields = {
    displayName: 'Ada Lovelace',
    email: 'ada@example.com',
    password: 'correct-horse-battery',
    confirmPassword: 'correct-horse-battery',
    phone: '',
    dateOfBirth: '',
    ...overrides,
  }
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const initial = { error: null, notice: null, values: {}, attempt: 0 }

beforeEach(() => {
  signUp.mockReset()
  writeAudit.mockReset()
  redirect.mockClear()
})

describe('a valid registration reaches Supabase exactly once', () => {
  it('calls signUp with the metadata contract and nothing else', async () => {
    signUp.mockResolvedValue({
      data: { user: { id: 'u1', identities: [{ id: 'i1' }] }, session: null },
      error: null,
    })

    await register(initial, form({ phone: '+447700900123', dateOfBirth: '1990-05-04' }))

    expect(signUp).toHaveBeenCalledTimes(1)
    const [payload] = signUp.mock.calls[0] as [
      { email: string; password: string; options: { data: Record<string, unknown> } },
    ]
    expect(payload.email).toBe('ada@example.com')
    expect(payload.options.data).toEqual({
      display_name: 'Ada Lovelace',
      phone: '+447700900123',
      date_of_birth: '1990-05-04',
    })
    // Role, authority, organisation and membership are never client-supplied.
    expect(Object.keys(payload.options.data)).not.toContain('role')
    expect(Object.keys(payload.options.data)).not.toContain('authority_level')
  })

  it('never puts a password into audit telemetry', async () => {
    signUp.mockResolvedValue({
      data: { user: { id: 'u1', identities: [{ id: 'i1' }] }, session: null },
      error: null,
    })
    await register(initial, form())

    expect(writeAudit).toHaveBeenCalledTimes(1)
    const serialized = JSON.stringify(writeAudit.mock.calls[0])
    expect(serialized).not.toContain('correct-horse-battery')
    expect(serialized).not.toContain('Ada Lovelace')
  })
})

describe('registration never reports a credential verdict', () => {
  // The regression that produced "Those credentials are not valid." on a
  // brand-new email, sending the user to fix a password that was never
  // the problem.
  it.each([
    [400, undefined],
    [401, undefined],
    [400, 'invalid_credentials'],
    [400, 'user_not_found'],
  ])(
    'maps status %i / code %s to something other than a credential error',
    async (status, code) => {
      signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: { status, code, message: 'Signups not allowed for this instance' },
      })

      const state = await register(initial, form())
      expect(state.error).not.toMatch(/credentials are not valid/i)
      // Either wording is acceptable; what matters is that neither
      // blames the user's credentials. A bare 401 now reports a
      // deployment misconfiguration, which is more specific.
      expect(state.error).toMatch(/not necessarily anything you typed|not configured correctly/i)
      // A diagnostic must survive so the failure is actionable.
      expect(state.error).toMatch(/\((code|status): /)
    }
  )

  it('surfaces a database trigger failure as such, not as a duplicate email', async () => {
    signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { status: 500, code: 'unexpected_failure', message: 'Database error saving new user' },
    })

    const state = await register(initial, form())
    expect(state.error).toMatch(/database error/i)
    expect(state.error).not.toMatch(/already registered/i)
  })

  it('never leaks a raw provider message to the browser', async () => {
    signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: {
        status: 500,
        code: 'unexpected_failure',
        message: 'insert into "public"."profiles" failed at db.abcdefg.supabase.co:5432',
      },
    })

    const state = await register(initial, form())
    expect(state.error).not.toMatch(/supabase\.co|5432|public\.|insert into/i)
  })
})

describe('form state after a failure', () => {
  it('echoes back everything except the passwords, and bumps attempt', async () => {
    signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { status: 422, code: 'weak_password', message: 'too weak' },
    })

    const state = await register(initial, form({ phone: '+447700900123' }))
    expect(state.values?.email).toBe('ada@example.com')
    expect(state.values?.phone).toBe('+447700900123')
    expect(JSON.stringify(state)).not.toContain('correct-horse-battery')
    // The form keys both password inputs on attempt so they remount empty.
    expect(state.attempt).toBe(1)
  })

  it('rejects mismatched passwords before any network call', async () => {
    const state = await register(initial, form({ confirmPassword: 'different-password' }))
    expect(state.error).toBeTruthy()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('rejects a short password before any network call', async () => {
    const state = await register(initial, form({ password: 'short', confirmPassword: 'short' }))
    expect(state.error).toBeTruthy()
    expect(signUp).not.toHaveBeenCalled()
  })
})

describe('session handling', () => {
  it('redirects to the command centre when a session is issued', async () => {
    signUp.mockResolvedValue({
      data: { user: { id: 'u1', identities: [{ id: 'i1' }] }, session: { access_token: 't' } },
      error: null,
    })

    await expect(register(initial, form())).rejects.toThrow('NEXT_REDIRECT:/executive')
    expect(redirect).toHaveBeenCalledWith('/executive')
  })

  it('does not confirm whether an address already exists', async () => {
    // Supabase hides enumeration by returning a user with no identities.
    signUp.mockResolvedValue({
      data: { user: { id: 'u1', identities: [] }, session: null },
      error: null,
    })

    const state = await register(initial, form())
    expect(state.error).toBeNull()
    expect(state.notice).toMatch(/check your email/i)
    expect(state.notice).not.toMatch(/already|exists|registered/i)
  })

  it('keeps the account when audit telemetry fails', async () => {
    signUp.mockResolvedValue({
      data: { user: { id: 'u1', identities: [{ id: 'i1' }] }, session: null },
      error: null,
    })
    writeAudit.mockRejectedValue(new Error('service role key missing'))

    // Telemetry is best-effort: an observability gap must never undo an
    // account that already exists in Supabase Auth.
    const state = await register(initial, form())
    expect(state.error).toBeNull()
    expect(state.notice).toBeTruthy()
  })
})
