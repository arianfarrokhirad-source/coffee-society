import { Badge, Card, EmptyState } from '@jarvis/ui'
import { ObjectiveForm } from '@/components/forms'
import { createUserClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function ObjectivesPage() {
  const supabase = await createUserClient()
  const [{ data: objectives }, { data: businesses }] = await Promise.all([
    supabase
      .from('objectives')
      .select('*, businesses(code, name)')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.from('businesses').select('id, code, name').eq('status', 'active').order('code'),
  ])

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-white">Objectives</h1>
      </header>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="All objectives">
            {(objectives ?? []).length === 0 ? (
              <EmptyState
                title="No objectives yet"
                hint="Define the first objective on the right."
              />
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Business</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Target</th>
                  </tr>
                </thead>
                <tbody>
                  {(objectives ?? []).map((o) => (
                    <tr key={o.id}>
                      <td>{o.title}</td>
                      <td className="text-muted">
                        {(o.businesses as { code?: string } | null)?.code ?? 'Org'}
                      </td>
                      <td>
                        <Badge
                          tone={
                            o.status === 'at_risk'
                              ? 'danger'
                              : o.status === 'active'
                                ? 'ok'
                                : 'muted'
                          }
                        >
                          {o.status}
                        </Badge>
                      </td>
                      <td>{o.priority}</td>
                      <td className="text-muted">{o.target_date ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
        <Card title="New objective">
          <ObjectiveForm businesses={businesses ?? []} />
        </Card>
      </div>
    </div>
  )
}
