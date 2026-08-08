import Link from 'next/link'
import { Badge, Card, EmptyState, StatTile } from '@jarvis/ui'
import { getAuthContext } from '@/lib/auth'
import { primeExists } from '@/lib/setup'
import { createUserClient } from '@/lib/supabase/server'
import ClaimPrimeBanner from '@/components/ClaimPrimeBanner'

export const dynamic = 'force-dynamic'

export default async function ExecutivePage() {
  const auth = await getAuthContext()
  const supabase = await createUserClient()
  const showClaim = !(await primeExists())
  const today = new Date().toISOString().slice(0, 10)

  const [businesses, objectives, overdueTasks, approvals, decisions, runs, brief, failedEvents] =
    await Promise.all([
      supabase.from('businesses').select('*').order('code'),
      supabase.from('objectives').select('*').in('status', ['active', 'at_risk']).limit(10),
      supabase
        .from('tasks')
        .select('*')
        .not('status', 'in', '("done","cancelled")')
        .lt('due_date', today)
        .limit(10),
      supabase
        .from('approvals')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(10),
      supabase.from('decisions').select('*').order('decided_at', { ascending: false }).limit(5),
      supabase.from('agent_runs').select('*').order('created_at', { ascending: false }).limit(8),
      supabase.from('daily_briefs').select('*').eq('brief_date', today).maybeSingle(),
      supabase.from('system_events').select('*').eq('status', 'failed').limit(5),
    ])

  const atRisk = (objectives.data ?? []).filter((o) => o.status === 'at_risk')

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-white">Executive Dashboard</h1>
        <p className="text-sm text-muted">Organization-wide command view</p>
      </header>

      {showClaim && <ClaimPrimeBanner />}

      {!auth?.hasMembership && !showClaim && (
        <Card>
          <p className="text-sm text-warn">
            Your account has no membership yet. PRIME must add you to a business from Settings.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Active businesses"
          value={(businesses.data ?? []).filter((b) => b.status === 'active').length}
        />
        <StatTile label="Open objectives" value={objectives.data?.length ?? 0} />
        <StatTile
          label="Overdue tasks"
          value={overdueTasks.data?.length ?? 0}
          tone={(overdueTasks.data?.length ?? 0) > 0 ? 'danger' : 'info'}
        />
        <StatTile
          label="Pending approvals"
          value={approvals.data?.length ?? 0}
          tone={(approvals.data?.length ?? 0) > 0 ? 'warn' : 'info'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Revenue">
          <EmptyState
            title="No financial metrics connected"
            hint="ORACLE (A04) financial integrations arrive in a later phase. Nothing is fabricated here."
          />
        </Card>

        <Card title="Critical risks">
          {atRisk.length === 0 && (overdueTasks.data?.length ?? 0) === 0 ? (
            <EmptyState title="No objectives at risk and nothing overdue" />
          ) : (
            <ul className="space-y-2 text-sm">
              {atRisk.map((o) => (
                <li key={o.id}>
                  <Badge tone="danger">at risk</Badge> <span className="ml-2">{o.title}</span>
                </li>
              ))}
              {(overdueTasks.data ?? []).map((t) => (
                <li key={t.id}>
                  <Badge tone="warn">overdue</Badge> <span className="ml-2">{t.title}</span>
                  <span className="ml-2 text-xs text-muted">due {t.due_date}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Pending approvals"
          action={
            <Link className="text-xs text-accent" href="/approvals">
              Approval Centre →
            </Link>
          }
        >
          {(approvals.data ?? []).length === 0 ? (
            <EmptyState title="Nothing awaiting PRIME" />
          ) : (
            <ul className="space-y-2 text-sm">
              {(approvals.data ?? []).map((a) => (
                <li key={a.id} className="flex items-center justify-between">
                  <span>{a.action_type}</span>
                  <Badge
                    tone={
                      a.risk_level === 'critical' || a.risk_level === 'high' ? 'danger' : 'warn'
                    }
                  >
                    {a.risk_level}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent decisions">
          {(decisions.data ?? []).length === 0 ? (
            <EmptyState
              title="No decisions recorded yet"
              hint="Record decisions from the Decisions page."
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {(decisions.data ?? []).map((d) => (
                <li key={d.id}>
                  {d.title}
                  <span className="ml-2 text-xs text-muted">
                    {new Date(d.decided_at).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Recent agent runs"
          action={
            <Link className="text-xs text-accent" href="/jarvis">
              Open JARVIS →
            </Link>
          }
        >
          {(runs.data ?? []).length === 0 ? (
            <EmptyState
              title="No agent activity yet"
              hint="Ask JARVIS something to create the first run."
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {(runs.data ?? []).map((r) => (
                <li key={r.id} className="flex items-center justify-between">
                  <span className="truncate">
                    {r.intent ?? 'run'} — {r.input_summary?.slice(0, 60)}
                  </span>
                  <Badge
                    tone={
                      r.status === 'completed' ? 'ok' : r.status === 'failed' ? 'danger' : 'warn'
                    }
                  >
                    {r.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Today's brief"
          action={
            <Link className="text-xs text-accent" href="/reports">
              Reports →
            </Link>
          }
        >
          {brief.data ? (
            <p className="text-sm text-gray-300">
              Brief for {brief.data.brief_date} generated. View it under Reports.
            </p>
          ) : (
            <EmptyState
              title="No brief generated today"
              hint='Generate it from Reports or ask JARVIS: "Generate today&apos;s PRIME brief".'
            />
          )}
        </Card>
      </div>

      {(failedEvents.data ?? []).length > 0 && (
        <Card title="System errors">
          <ul className="space-y-1 text-sm text-danger">
            {(failedEvents.data ?? []).map((e) => (
              <li key={e.id}>
                {e.event_type}: {e.last_error ?? 'failed'}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
