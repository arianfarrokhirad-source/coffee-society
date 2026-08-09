import { Badge, Card, EmptyState, StatTile } from '@jarvis/ui'
import { AuditActions, AuditForm } from '@/components/audits'
import { createUserClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface Finding {
  area?: unknown
  issue?: unknown
  severity?: unknown
}

interface AuditRow {
  id: string
  website_url: string | null
  findings: { items?: Finding[]; summary?: string | null } | null
  score: number | null
  status: string
  created_at: string
  leads: { company_name: string } | null
  businesses: { code: string } | null
}

const SEVERITY_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'muted'> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warn',
  low: 'muted',
}

/**
 * A score is only useful if the reader knows which way is good. 100 is a
 * healthy site; the label says so rather than leaving it ambiguous.
 */
function scoreTone(score: number | null): 'ok' | 'warn' | 'danger' | 'muted' {
  if (score == null) return 'muted'
  if (score >= 70) return 'ok'
  if (score >= 40) return 'warn'
  return 'danger'
}

export default async function AuditsPage() {
  const supabase = await createUserClient()
  const [{ data: audits }, { data: leads }] = await Promise.all([
    supabase
      .from('website_audits')
      .select(
        'id, website_url, findings, score, status, created_at, leads(company_name), businesses(code)'
      )
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('leads')
      .select('id, company_name, website_url')
      .not('status', 'in', '(won,lost,archived)')
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const rows = (audits ?? []) as unknown as AuditRow[]
  const drafts = rows.filter((a) => a.status === 'draft')
  const completed = rows.filter((a) => a.status === 'completed')

  const scored = rows.filter((a) => typeof a.score === 'number')
  const averageScore =
    scored.length === 0
      ? null
      : Math.round(scored.reduce((sum, a) => sum + (a.score ?? 0), 0) / scored.length)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-white">Website audits</h1>
        <p className="text-sm text-muted">
          The evidence behind a quote. A completed audit can be cited by a proposal for the same
          lead — so the price has a reason attached to it.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Drafts" value={String(drafts.length)} tone="warn" />
        <StatTile label="Completed" value={String(completed.length)} />
        <StatTile
          label="Average score"
          value={averageScore == null ? '—' : `${averageScore}/100`}
          tone={scoreTone(averageScore)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Audits">
            {rows.length === 0 ? (
              <EmptyState
                title="No audits yet"
                hint="Record one against an open lead — findings and a score are what a proposal cites."
              />
            ) : (
              <div className="space-y-4">
                {rows.map((auditRow) => {
                  const items = auditRow.findings?.items ?? []
                  return (
                    <article key={auditRow.id} className="rounded border border-edge p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div>
                          <span className="text-white">
                            {auditRow.leads?.company_name ?? 'Unlinked lead'}
                          </span>
                          {auditRow.website_url && (
                            <div className="text-xs text-muted">{auditRow.website_url}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {auditRow.score != null && (
                            <Badge tone={scoreTone(auditRow.score)}>{auditRow.score}/100</Badge>
                          )}
                          <Badge tone={auditRow.status === 'completed' ? 'ok' : 'warn'}>
                            {auditRow.status}
                          </Badge>
                          <AuditActions auditId={auditRow.id} status={auditRow.status} />
                        </div>
                      </div>

                      {auditRow.findings?.summary && (
                        <p className="mt-2 text-sm text-muted">{auditRow.findings.summary}</p>
                      )}

                      {items.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {items.map((finding, index) => (
                            <li key={index} className="flex items-baseline gap-2 text-sm">
                              <Badge tone={SEVERITY_TONE[String(finding.severity)] ?? 'muted'}>
                                {String(finding.severity ?? 'medium')}
                              </Badge>
                              <span className="text-muted">
                                {String(finding.area ?? 'General')}
                              </span>
                              <span>{String(finding.issue ?? '')}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </Card>
        </div>

        <Card title="New audit">
          <AuditForm leads={leads ?? []} />
        </Card>
      </div>
    </div>
  )
}
