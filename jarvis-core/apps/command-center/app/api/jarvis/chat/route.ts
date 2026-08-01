import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { BUSINESS_CODES } from '@jarvis/shared'
import { runJarvis } from '@jarvis/workflows'
import { toSafeError } from '@jarvis/security'
import { getAuthContext } from '@/lib/auth'
import { getRateLimiter, getRouter, getStore } from '@/lib/jarvis'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  message: z.string().min(1).max(4000),
  business: z.union([z.enum(BUSINESS_CODES), z.literal('auto')]).default('auto'),
})

export async function POST(request: NextRequest) {
  // 1. Authenticate the requester (session cookie, server-verified).
  const auth = await getAuthContext()
  if (!auth) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (!auth.hasMembership || !auth.organizationId) {
    return NextResponse.json(
      { error: 'Your account has no active membership. Claim PRIME or ask PRIME for access.' },
      { status: 403 }
    )
  }

  if (!(await getRateLimiter().check(`chat:${auth.userId}`))) {
    return NextResponse.json({ error: 'Rate limit exceeded. Slow down.' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  try {
    const reply = await runJarvis(
      { store: getStore(), router: getRouter(), rateLimiter: getRateLimiter() },
      { profileId: auth.userId, authority: auth.authority, isPrime: auth.isPrime },
      { message: parsed.data.message, business: parsed.data.business }
    )
    return NextResponse.json(reply)
  } catch (error) {
    const safe = toSafeError(error, 'jarvis_error')
    console.error('[jarvis] chat failure:', error)
    return NextResponse.json({ error: safe.message }, { status: 500 })
  }
}
