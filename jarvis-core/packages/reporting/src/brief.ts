import type { BriefData, JarvisStore } from '@jarvis/database'
import { dailyBriefContentSchema, type DailyBriefContent } from '@jarvis/shared'

// ---------------------------------------------------------------------
// Daily PRIME brief (section 20). Pure composition (unit-testable) +
// a generator that gathers data through the store, persists the brief
// and emits a system event + P2 notification. Sections that would be
// meaningless noise are left empty rather than padded.
// ---------------------------------------------------------------------

export function composeBrief(briefDate: string, data: BriefData): DailyBriefContent {
  const money: string[] = []
  for (const approval of data.pendingApprovals) {
    if (approval.estimated_cost != null && approval.estimated_cost > 0) {
      money.push(
        `Pending spend: ${approval.action_type} — ${approval.estimated_cost} ${approval.currency ?? ''} (approval ${approval.id.slice(0, 8)})`.trim()
      )
    }
  }

  const threats: string[] = [
    ...data.overdueTasks.map(
      (t) => `Overdue task: "${t.title}" (due ${t.due_date}, priority ${t.priority})`
    ),
    ...data.objectivesAtRisk.map((o) => `Objective at risk: "${o.title}"`),
    ...data.highPriorityNotifications.map((n) => `${n.priority} notification: ${n.title}`),
  ]

  const opportunities: string[] = data.recentlyCompletedTasks.map(
    (t) => `Completed: "${t.title}" — consider follow-up or client value capture`
  )

  const approvals: string[] = data.pendingApprovals.map(
    (a) =>
      `${a.action_type} (risk ${a.risk_level}${a.estimated_cost != null ? `, ~${a.estimated_cost} ${a.currency ?? ''}` : ''}) — ${a.reason ?? 'no reason given'}`
  )

  const todaysPriority: string[] = []
  const p0Overdue = data.overdueTasks.filter((t) => t.priority === 'P0' || t.priority === 'P1')
  if (data.pendingApprovals.length > 0) {
    todaysPriority.push(`Resolve ${data.pendingApprovals.length} pending approval(s)`)
  }
  if (p0Overdue.length > 0) {
    todaysPriority.push(`Clear ${p0Overdue.length} high-priority overdue task(s)`)
  }
  if (data.objectivesAtRisk.length > 0) {
    todaysPriority.push(`Review ${data.objectivesAtRisk.length} objective(s) at risk`)
  }

  const systemHealth: string[] = [
    ...data.failedRuns.map(
      (r) => `Agent run failed: ${r.intent ?? r.id.slice(0, 8)} — ${r.error ?? 'unknown error'}`
    ),
    ...data.businessesMissingData.map(
      (b) => `${b.code} ${b.name}: no objectives recorded — data missing`
    ),
  ]

  const decisions = data.recentDecisions.map((d) => `Decision: "${d.title}"`)

  return dailyBriefContentSchema.parse({
    briefDate,
    money,
    threats,
    opportunities: [...opportunities, ...decisions],
    approvals,
    todaysPriority,
    systemHealth,
  })
}

export interface GenerateBriefOptions {
  organizationId: string
  briefDate?: string // YYYY-MM-DD; defaults to today (UTC)
  generatedBy?: string | null
}

export async function generateDailyBrief(store: JarvisStore, options: GenerateBriefOptions) {
  const briefDate = options.briefDate ?? new Date().toISOString().slice(0, 10)
  const data = await store.getBriefData(options.organizationId, `${briefDate}T00:00:00.000Z`)
  const content = composeBrief(briefDate, data)
  const brief = await store.upsertDailyBrief(
    options.organizationId,
    briefDate,
    content,
    options.generatedBy ?? null
  )
  await store.createSystemEvent({
    organizationId: options.organizationId,
    eventType: 'daily_brief.requested',
    payload: { briefDate },
    dedupeKey: briefDate,
  })
  await store.createNotification({
    organizationId: options.organizationId,
    priority: 'P2',
    title: `Daily PRIME brief for ${briefDate} is ready`,
    resourceType: 'daily_brief',
    resourceId: brief.id,
  })
  return { brief, content }
}
