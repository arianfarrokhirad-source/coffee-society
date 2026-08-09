import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------
// Integration coverage for claimPrime.
//
// This is the highest-consequence path in the product: it is single-use
// and irreversible, and a mistake permanently consumes the only PRIME
// slot on that database. The properties worth guarding before a merge:
//
//   * every failure returns ONE generic message — the specific reason is
//     recorded internally, never shown, so the setup token cannot be
//     probed;
//   * the token is compared only AFTER cheaper gates (already-claimed,
//     rate limit), so a completed claim cannot be used as a token oracle;
//   * a denial that cannot be audited still denies — refusing is the safe
//     state;
//   * the raw token never reaches the database, the audit trail, or logs.
// ---------------------------------------------------------------------

const getUser = vi.fn()
const rpc = vi.fn()
const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`)
})
const revalidatePath = vi.fn()

/** Records every table touched so ordering can be asserted. */
let touched: string[] = []
let primeRoleRow: { id: string } | null = null
let activePrimeCount = 0
let denialCount = 0
let insertError: { message: string } | null = null
let auditInsertError: { message: string } | null = null

function serviceClient() {
  return {
    from(table: string) {
      touched.push(table)
      if (table === 'roles') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: primeRoleRow, error: null }) }),
          }),
        }
      }
      if (table === 'memberships') {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ count: activePrimeCount, error: null }),
            }),
          }),
        }
      }
      if (table === 'audit_logs') {
        return {
          insert: async () => ({ error: auditInsertError }),
          select: () => ({
            eq: () => ({
              eq: () => ({
                gte: async () => ({ count: denialCount, error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'prime_claim_nonces') {
        return { insert: async () => ({ error: insertError }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
    rpc,
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createUserClient: async () => ({ auth: { getUser } }),
}))
vi.mock('@jarvis/database', () => ({ createServiceClient: () => serviceClient() }))
// lib/jarvis imports 'server-only', which throws outside a server
// component. The claim path never uses it, so a stub keeps the module
// graph loadable in a test process.
vi.mock('@/lib/jarvis', () => ({ getStore: () => ({ writeAudit: vi.fn() }) }))
vi.mock('next/navigation', () => ({ redirect: (p: string) => redirect(p) }))
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))

const { claimPrime } = await import('@/app/actions/auth')
const { GENERIC_CLAIM_ERROR } = await import('@/lib/prime-claim')

/** Must clear MIN_SETUP_TOKEN_LENGTH: a short token disables claiming. */
const REAL_TOKEN = 'setup-token-long-enough-to-be-accepted-0123456789'

function form(token = REAL_TOKEN): FormData {
  const data = new FormData()
  data.set('setupToken', token)
  return data
}

beforeEach(() => {
  touched = []
  primeRoleRow = { id: 'role-prime' }
  activePrimeCount = 0
  denialCount = 0
  insertError = null
  auditInsertError = null
  // mockResolvedValue does not clear call history; without the resets the
  // call counts accumulate across tests and every assertion on "was the
  // RPC reached" becomes meaningless.
  getUser.mockReset()
  rpc.mockReset()
  getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  rpc.mockResolvedValue({ error: null })
  redirect.mockClear()
  revalidatePath.mockClear()
  process.env.JARVIS_PRIME_SETUP_TOKEN = REAL_TOKEN
})

describe('every denial is indistinguishable to the caller', () => {
  it('returns the same message when unauthenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const state = await claimPrime({ error: null }, form())
    expect(state.error).toBe(GENERIC_CLAIM_ERROR)
  })

  it('returns the same message when the token is wrong', async () => {
    const state = await claimPrime(
      { error: null },
      form('wrong-token-but-also-long-enough-0123456789')
    )
    expect(state.error).toBe(GENERIC_CLAIM_ERROR)
  })

  it('returns the same message when PRIME already exists', async () => {
    activePrimeCount = 1
    const state = await claimPrime({ error: null }, form())
    expect(state.error).toBe(GENERIC_CLAIM_ERROR)
  })

  it('returns the same message when rate limited', async () => {
    denialCount = 999
    const state = await claimPrime({ error: null }, form())
    expect(state.error).toBe(GENERIC_CLAIM_ERROR)
  })

  it('returns the same message when the RPC rejects', async () => {
    rpc.mockResolvedValue({ error: { message: 'prime_already_claimed' } })
    const state = await claimPrime({ error: null }, form())
    expect(state.error).toBe(GENERIC_CLAIM_ERROR)
  })
})

describe('the token is never a probe target', () => {
  it('refuses before any token comparison once PRIME exists', async () => {
    activePrimeCount = 1
    await claimPrime({ error: null }, form('wrong-token-but-also-long-enough-0123456789'))
    // No nonce is minted, so no token check influenced the outcome.
    expect(touched).not.toContain('prime_claim_nonces')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('never sends the raw token to the database or the audit trail', async () => {
    await claimPrime({ error: null }, form()).catch(() => undefined)
    const everything = JSON.stringify({ rpc: rpc.mock.calls, touched })
    expect(everything).not.toContain(REAL_TOKEN)
  })

  it('passes only a nonce and the expected user id to the RPC', async () => {
    await claimPrime({ error: null }, form()).catch(() => undefined)
    expect(rpc).toHaveBeenCalledTimes(1)
    const [fn, args] = rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(fn).toBe('claim_prime_with_nonce')
    expect(args.p_expected_user).toBe('user-1')
    expect(typeof args.p_nonce).toBe('string')
    expect(args.p_nonce).not.toBe(REAL_TOKEN)
  })
})

describe('denial is the safe state', () => {
  it('still denies when the denial audit write fails', async () => {
    auditInsertError = { message: 'audit_logs unavailable' }
    const state = await claimPrime(
      { error: null },
      form('wrong-token-but-also-long-enough-0123456789')
    )
    expect(state.error).toBe(GENERIC_CLAIM_ERROR)
  })

  it('denies when the nonce cannot be stored', async () => {
    insertError = { message: 'insert failed' }
    const state = await claimPrime({ error: null }, form())
    expect(state.error).toBe(GENERIC_CLAIM_ERROR)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('denies when no setup token is configured on the server', async () => {
    delete process.env.JARVIS_PRIME_SETUP_TOKEN
    const state = await claimPrime({ error: null }, form())
    expect(state.error).toBe(GENERIC_CLAIM_ERROR)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('a successful claim', () => {
  it('revalidates cached routes and redirects to the command centre', async () => {
    await expect(claimPrime({ error: null }, form())).rejects.toThrow('NEXT_REDIRECT:/executive')
    // Authorization is read from the database per request, so revalidating
    // cached route data is what makes PRIME access take effect at once.
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })

  it('checks already-claimed and rate limit before minting a nonce', async () => {
    await claimPrime({ error: null }, form()).catch(() => undefined)
    const nonceIndex = touched.indexOf('prime_claim_nonces')
    expect(touched.indexOf('roles')).toBeLessThan(nonceIndex)
    expect(touched.indexOf('audit_logs')).toBeLessThan(nonceIndex)
  })
})
