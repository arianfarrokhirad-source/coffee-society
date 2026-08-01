import { Badge, Card, EmptyState } from '@jarvis/ui'
import { TaskForm } from '@/components/forms'
import TaskStatusButtons from '@/components/TaskStatusButtons'
import { createUserClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function TasksPage() {
  const supabase = await createUserClient()
  const [{ data: tasks }, { data: businesses }] = await Promise.all([
    supabase
      .from('tasks')
      .select('*, businesses(code)')
      .order('created_at', { ascending: false })
      .limit(150),
    supabase.from('businesses').select('id, code, name').eq('status', 'active').order('code'),
  ])

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-white">Tasks</h1>
      </header>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="All tasks">
            {(tasks ?? []).length === 0 ? (
              <EmptyState
                title="No tasks yet"
                hint='Create one here or tell JARVIS: "Create a task for FORGE to …"'
              />
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Business</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Due</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(tasks ?? []).map((t) => {
                    const overdue =
                      t.due_date && t.due_date < today && !['done', 'cancelled'].includes(t.status)
                    return (
                      <tr key={t.id}>
                        <td>{t.title}</td>
                        <td className="text-muted">
                          {(t.businesses as { code?: string } | null)?.code}
                        </td>
                        <td>
                          <Badge
                            tone={
                              t.status === 'done'
                                ? 'ok'
                                : t.status === 'blocked'
                                  ? 'danger'
                                  : 'muted'
                            }
                          >
                            {t.status}
                          </Badge>
                        </td>
                        <td>{t.priority}</td>
                        <td className={overdue ? 'text-danger' : 'text-muted'}>
                          {t.due_date ?? '—'}
                        </td>
                        <td>
                          <TaskStatusButtons taskId={t.id} status={t.status} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </div>
        <Card title="New task">
          <TaskForm businesses={businesses ?? []} />
        </Card>
      </div>
    </div>
  )
}
