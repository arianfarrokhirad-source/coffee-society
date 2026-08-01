import { Card, EmptyState } from '@jarvis/ui'
import GenerateBriefButton from '@/components/GenerateBriefButton'
import { createUserClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const SECTIONS: [string, string][] = [
  ['money', 'MONEY'],
  ['threats', 'THREATS'],
  ['opportunities', 'OPPORTUNITIES'],
  ['approvals', 'APPROVALS'],
  ['todaysPriority', "TODAY'S PRIORITY"],
  ['systemHealth', 'SYSTEM HEALTH'],
]

export default async function ReportsPage() {
  const supabase = await createUserClient()
  const { data: briefs } = await supabase
    .from('daily_briefs')
    .select('*')
    .order('brief_date', { ascending: false })
    .limit(14)

  const latest = briefs?.[0]

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Reports</h1>
          <p className="text-sm text-muted">
            Daily PRIME briefs. Also available on schedule via the documented cron endpoint.
          </p>
        </div>
        <GenerateBriefButton />
      </header>

      {!latest ? (
        <EmptyState
          title="No briefs yet"
          hint="Generate the first one — it consolidates approvals, overdue work, risks and system health across every business."
        />
      ) : (
        <Card title={`PRIME brief — ${latest.brief_date}`}>
          <div className="grid gap-4 md:grid-cols-2">
            {SECTIONS.map(([key, label]) => {
              const items = (latest.content as Record<string, string[]>)[key] ?? []
              return (
                <div key={key} className="rounded border border-edge p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gold">
                    {label}
                  </p>
                  {items.length === 0 ? (
                    <p className="mt-2 text-sm text-muted">Nothing to report.</p>
                  ) : (
                    <ul className="mt-2 space-y-1 text-sm text-gray-300">
                      {items.map((item, i) => (
                        <li key={i}>• {item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {(briefs ?? []).length > 1 && (
        <Card title="Previous briefs">
          <ul className="space-y-1 text-sm text-muted">
            {(briefs ?? []).slice(1).map((b) => (
              <li key={b.id}>
                {b.brief_date} — generated {new Date(b.created_at).toLocaleString()}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
