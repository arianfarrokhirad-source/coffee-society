import { Badge, Card, EmptyState } from '@jarvis/ui'
import { ProjectForm } from '@/components/forms'
import { createUserClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function ProjectsPage() {
  const supabase = await createUserClient()
  const [{ data: projects }, { data: businesses }] = await Promise.all([
    supabase
      .from('projects')
      .select('*, businesses(code, name)')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.from('businesses').select('id, code, name').eq('status', 'active').order('code'),
  ])

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-white">Projects</h1>
      </header>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="All projects">
            {(projects ?? []).length === 0 ? (
              <EmptyState title="No projects yet" />
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Business</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {(projects ?? []).map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td className="text-muted">
                        {(p.businesses as { code?: string } | null)?.code}
                      </td>
                      <td>
                        <Badge tone={p.status === 'active' ? 'ok' : 'muted'}>{p.status}</Badge>
                      </td>
                      <td>{p.priority}</td>
                      <td className="text-muted">{p.due_date ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
        <Card title="New project">
          <ProjectForm businesses={businesses ?? []} />
        </Card>
      </div>
    </div>
  )
}
