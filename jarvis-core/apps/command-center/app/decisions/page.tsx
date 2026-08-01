import { Card, EmptyState } from '@jarvis/ui'
import { DecisionForm } from '@/components/forms'
import { createUserClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function DecisionsPage() {
  const supabase = await createUserClient()
  const [{ data: decisions }, { data: businesses }] = await Promise.all([
    supabase
      .from('decisions')
      .select('*, businesses(code)')
      .order('decided_at', { ascending: false })
      .limit(100),
    supabase.from('businesses').select('id, code, name').eq('status', 'active').order('code'),
  ])

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-white">Decisions</h1>
        <p className="text-sm text-muted">The permanent record of what was decided and why.</p>
      </header>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {(decisions ?? []).length === 0 ? (
            <EmptyState title="No decisions recorded" hint="Record the first one on the right." />
          ) : (
            (decisions ?? []).map((d) => (
              <Card key={d.id}>
                <p className="font-medium text-white">{d.title}</p>
                <p className="mt-1 text-sm text-gray-300">{d.decision}</p>
                {d.rationale && <p className="mt-2 text-sm text-muted">Rationale: {d.rationale}</p>}
                <p className="mt-2 text-xs text-muted">
                  {(d.businesses as { code?: string } | null)?.code ?? 'Org'} ·{' '}
                  {new Date(d.decided_at).toLocaleString()} · {d.status}
                </p>
              </Card>
            ))
          )}
        </div>
        <Card title="Record a decision">
          <DecisionForm businesses={businesses ?? []} />
        </Card>
      </div>
    </div>
  )
}
