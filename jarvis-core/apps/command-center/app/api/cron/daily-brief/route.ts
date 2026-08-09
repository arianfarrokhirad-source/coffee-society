import { NextResponse, type NextRequest } from 'next/server'
import { generateDailyBrief } from '@jarvis/reporting'
import { buildAuditEvent } from '@jarvis/security'
import { isCronAuthorized } from '@/lib/cron-auth'
import { getStore } from '@/lib/jarvis'

// Scheduled brief generation. Call with:
//   POST /api/cron/daily-brief
//   Authorization: Bearer <JARVIS_CRON_SECRET>
// Wire it to Vercel Cron (see docs/setup/vercel.md). The endpoint is
// idempotent per day (daily_briefs upserts on organization+date).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'), process.env.JARVIS_CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const store = getStore()
  const organizationId = await store.getOrganizationId()
  if (!organizationId) {
    return NextResponse.json({ error: 'Organization not seeded' }, { status: 500 })
  }

  try {
    const { brief } = await generateDailyBrief(store, { organizationId, generatedBy: null })
    await store.writeAudit(
      buildAuditEvent({
        organizationId,
        actorType: 'system',
        action: 'brief.generated.cron',
        resourceType: 'daily_brief',
        resourceId: brief.id,
      })
    )
    return NextResponse.json({ ok: true, briefDate: brief.brief_date })
  } catch (error) {
    console.error('[cron] daily brief failed:', error)
    return NextResponse.json({ error: 'Brief generation failed' }, { status: 500 })
  }
}
