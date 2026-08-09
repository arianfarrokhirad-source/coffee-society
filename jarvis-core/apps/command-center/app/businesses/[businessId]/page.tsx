import { notFound } from 'next/navigation'
import { Badge, Card, EmptyState, StatTile } from '@jarvis/ui'
import { createUserClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function BusinessDashboard({
  params,
}: {
  params: Promise<{ businessId: string }>
}) {
  const { businessId } = await params
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) notFound()

  const supabase = await createUserClient()
  const { data: business } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', businessId)
    .maybeSingle()
  if (!business) notFound()

  const [tasks, projects, objectives, approvals, agents] = await Promise.all([
    supabase
      .from('tasks')
      .select('*')
      .eq('business_id', businessId)
      .not('status', 'in', '("done","cancelled")')
      .order('priority')
      .limit(20),
    supabase.from('projects').select('*').eq('business_id', businessId).limit(20),
    supabase.from('objectives').select('*').eq('business_id', businessId).limit(20),
    supabase
      .from('approvals')
      .select('*')
      .eq('business_id', businessId)
      .eq('status', 'pending')
      .limit(20),
    supabase.from('agents').select('*').eq('business_id', businessId),
  ])

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-white">
          {business.code} · {business.name}
        </h1>
        <Badge tone={business.status === 'active' ? 'ok' : 'muted'}>{business.status}</Badge>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Open tasks" value={tasks.data?.length ?? 0} />
        <StatTile label="Projects" value={projects.data?.length ?? 0} />
        <StatTile label="Objectives" value={objectives.data?.length ?? 0} />
        <StatTile
          label="Pending approvals"
          value={approvals.data?.length ?? 0}
          tone={(approvals.data?.length ?? 0) > 0 ? 'warn' : 'info'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Open tasks">
          {(tasks.data ?? []).length === 0 ? (
            <EmptyState
              title="No open tasks"
              hint="Create tasks from the Tasks page or via JARVIS."
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {(tasks.data ?? []).map((t) => (
                <li key={t.id} className="flex items-center justify-between">
                  <span>{t.title}</span>
                  <span className="flex items-center gap-2">
                    <Badge tone="info">{t.priority}</Badge>
                    <Badge tone="muted">{t.status}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Objectives">
          {(objectives.data ?? []).length === 0 ? (
            <EmptyState
              title="No objectives"
              hint="Define what this business is trying to achieve."
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {(objectives.data ?? []).map((o) => (
                <li key={o.id} className="flex items-center justify-between">
                  <span>{o.title}</span>
                  <Badge tone={o.status === 'at_risk' ? 'danger' : 'ok'}>{o.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Projects">
          {(projects.data ?? []).length === 0 ? (
            <EmptyState title="No projects" />
          ) : (
            <ul className="space-y-2 text-sm">
              {(projects.data ?? []).map((p) => (
                <li key={p.id} className="flex items-center justify-between">
                  <span>{p.name}</span>
                  <Badge tone="muted">{p.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Agents">
          {(agents.data ?? []).length === 0 ? (
            <EmptyState title="No agents assigned" />
          ) : (
            <ul className="space-y-2 text-sm">
              {(agents.data ?? []).map((a) => (
                <li key={a.id} className="flex items-center justify-between">
                  <span>
                    {a.code} · {a.name}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone="info">{a.authority_level}</Badge>
                    <Badge tone={a.active ? 'ok' : 'muted'}>
                      {a.active ? 'active' : 'inactive'}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
