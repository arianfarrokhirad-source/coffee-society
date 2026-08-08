import { beforeEach, describe, expect, it, vi } from 'vitest'

// Sign-in is the one path where a credential verdict IS the right answer,
// and it must stay that way while never revealing whether an account
// exists. It also must not be broken by a telemetry misconfiguration —
// an earlier defect authenticated the user and then threw before
// redirecting, so sign-in "silently did nothing".

const signInWithPassword = vi.fn()
const writeAudit = vi.fn()
const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`)
})

vi.mock('@/lib/supabase/server', () => ({
  createUserClient: async () => ({ auth: { signInWithPassword } }),
}))
vi.mock('@/lib/jarvis', () => ({ getStore: () => ({ writeAudit }) }))
vi.mock('next/navigation', () => ({ redirect: (p: string) => redirect(p) }))

const { signIn } = await import('@/app/actions/auth')

function form(email = 'ada@example.com', password = 'correct-horse-battery'): FormData {
  const data = new FormData()
  data.set('email', email)
  data.set('password', password)
  return data
}

beforeEach(() => {
  signInWithPassword.mockReset()
  writeAudit.mockReset()
  redirect.mockClear()
})

describe('successful sign-in', () => {
  it('redirects to the command centre', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    await expect(signIn({ error: null }, form())).rejects.toThrow('NEXT_REDIRECT:/executive')
  })

  it('still redirects when audit telemetry throws', async () => {
    // The regression this pins: getStore() constructs a service-role
    // client eagerly and throws when the key is absent. That throw used
    // to happen AFTER the session cookie was set but BEFORE the
    // redirect, so the user was authenticated and went nowhere.
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    writeAudit.mockRejectedValue(new Error('SUPABASE_SERVICE_ROLE_KEY is not configured'))

    await expect(signIn({ error: null }, form())).rejects.toThrow('NEXT_REDIRECT:/executive')
  })
})

describe('failed sign-in', () => {
  it('reports invalid credentials for a 400 — the correct answer here', async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { status: 400, code: 'invalid_credentials', message: 'bad' },
    })

    const state = await signIn({ error: null }, form())
    expect(state.error).toMatch(/credentials are not valid/i)
  })

  it('never reveals whether the account exists', async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { status: 400, code: 'invalid_credentials', message: 'bad' },
    })

    const state = await signIn({ error: null }, form())
    expect(state.error).not.toMatch(/no account|not found|does not exist|unknown user/i)
  })

  it('separates an unconfirmed email from a wrong password', async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { status: 400, code: 'email_not_confirmed', message: 'unconfirmed' },
    })

    const state = await signIn({ error: null }, form())
    expect(state.error).toMatch(/confirmation|inbox/i)
  })

  it('echoes the email back but never the password', async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { status: 400, code: 'invalid_credentials', message: 'bad' },
    })

    const state = await signIn({ error: null }, form())
    expect(state.email).toBe('ada@example.com')
    expect(JSON.stringify(state)).not.toContain('correct-horse-battery')
  })

  it('validates before reaching the network', async () => {
    const state = await signIn({ error: null }, form('not-an-email', 'short'))
    expect(state.error).toBeTruthy()
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('fails closed when Supabase returns neither user nor error', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null }, error: null })
    const state = await signIn({ error: null }, form())
    expect(state.error).toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })
})
