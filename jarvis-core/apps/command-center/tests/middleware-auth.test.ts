import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------
// The authenticated command-centre flow, at the gate that enforces it.
//
// Every non-static path is covered by the middleware matcher, so this one
// function decides whether the product is reachable at all. Two failures
// it must never allow:
//
//   * an unauthenticated visitor reaching a command-centre route;
//   * /register falling behind the gate — which would make registration
//     unreachable and is exactly what the PUBLIC_PATHS list exists to
//     prevent.
// ---------------------------------------------------------------------

let currentUser: { id: string } | null = null

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: currentUser } }) },
  }),
}))

const { middleware, config } = await import('@/middleware')

function request(path: string): NextRequest {
  return new NextRequest(new URL(`https://jarvis.test${path}`))
}

beforeEach(() => {
  currentUser = null
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon-key'
})

describe('unauthenticated visitors', () => {
  it.each(['/executive', '/tasks', '/approvals', '/agents', '/settings', '/businesses/A01'])(
    'is redirected to /login from %s',
    async (path) => {
      const response = await middleware(request(path))
      expect(response.status).toBe(307)
      const location = new URL(response.headers.get('location') ?? '')
      expect(location.pathname).toBe('/login')
      // The intended destination survives the round trip.
      expect(location.searchParams.get('next')).toBe(path)
    }
  )

  it.each(['/login', '/register'])('may reach %s', async (path) => {
    const response = await middleware(request(path))
    expect(response.headers.get('location')).toBeNull()
  })

  it('may reach the cron endpoint, which authenticates itself', async () => {
    const response = await middleware(request('/api/cron/daily-brief'))
    expect(response.headers.get('location')).toBeNull()
  })

  it('does not treat a lookalike prefix as public', async () => {
    // '/registerXYZ' must not inherit /register's exemption.
    const response = await middleware(request('/registerXYZ'))
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/login')
  })
})

describe('authenticated users', () => {
  beforeEach(() => {
    currentUser = { id: 'user-1' }
  })

  it.each(['/executive', '/tasks', '/approvals'])('may reach %s', async (path) => {
    const response = await middleware(request(path))
    expect(response.headers.get('location')).toBeNull()
  })

  it('is bounced off /login to the command centre', async () => {
    const response = await middleware(request('/login'))
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.pathname).toBe('/executive')
    // No stale ?next survives the bounce.
    expect(location.search).toBe('')
  })

  it('may still reach /register — a signed-in user creating another account is not an error', async () => {
    const response = await middleware(request('/register'))
    expect(response.headers.get('location')).toBeNull()
  })
})

describe('the matcher covers the application surface', () => {
  it('exempts only static assets', () => {
    const [pattern] = config.matcher
    expect(pattern).toContain('_next/static')
    expect(pattern).toContain('favicon.ico')
    // If this list ever grows to include an app route, that route silently
    // loses authentication.
    expect(pattern).not.toContain('executive')
    expect(pattern).not.toContain('api/')
  })
})
