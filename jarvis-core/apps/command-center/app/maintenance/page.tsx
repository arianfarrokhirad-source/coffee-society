import { Badge, Card, EmptyState, StatTile } from '@jarvis/ui'
import { MaintenanceActions, MaintenancePlanForm } from '@/components/maintenance'
import { MAINTAINABLE_PROJECT_STAGES } from '@/lib/maintenance'
import { money, sumByCurrency } from '@/lib/money'
import { createUserClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface PlanRow {
  id: string
  name: string
  monthly_amount: string | number | null
  currency: string
  status: string
  created_at: string
  clients: { company_name: string } | null
  website_projects: { name: string; deployed_url: string | null } | null
  businesses: { code: string } | null
}

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'muted'> = {
  active: 'ok',
  paused: 'warn',
  cancelled: 'muted',
}

export default async function MaintenancePage() {
  const supabase = await createUserClient()

  const [{ data: plans }, { data: clients }, { data: projects }] = await Promise.all([
    supabase
      .from('maintenance_plans')
      .select(
        'id, name, monthly_amount, currency, status, created_at, ' +
          'clients(company_name), website_projects(name, deployed_url), businesses(code)'
      )
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('clients')
      .select('id, company_name')
      .neq('status', 'churned')
      .order('company_name')
      .limit(200),
    supabase
      .from('website_projects')
      .select('id, name, client_id')
      .in('status', [...MAINTAINABLE_PROJECT_STAGES])
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  const rows = (plans ?? []) as unknown as PlanRow[]
  const active = rows.filter((plan) => plan.status === 'active')
  const paused = rows.filter((plan) => plan.status === 'paused')

  // Recurring revenue counts only what is actually running. Including
  // paused plans would report money that is not arriving this month.
  const mrr = sumByCurrency(
    active.map((plan) => ({ amount: plan.monthly_amount, currency: plan.currency }))
  )

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-white">Maintenance</h1>
        <p className="text-sm text-muted">
          Where a delivered site becomes an ongoing relationship. A plan records what was agreed —
          monthly, in the client&rsquo;s currency — and what is running right now.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Monthly recurring"
          // Each currency is its own figure; a combined total would be a
          // number that means nothing.
          value={mrr.length === 0 ? '—' : mrr.map((m) => money(m.total, m.currency)).join(' · ')}
          tone={mrr.length > 0 ? 'ok' : 'muted'}
        />
        <StatTile label="Active plans" value={String(active.length)} />
        <StatTile
          label="Paused"
          value={String(paused.length)}
          tone={paused.length > 0 ? 'warn' : 'muted'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Plans">
            {rows.length === 0 ? (
              <EmptyState
                title="No maintenance plans yet"
                hint="Once a site is deployed, start a plan so the relationship — and the revenue — continues."
              />
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Plan</th>
                    <th>Site</th>
                    <th>Monthly</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((plan) => (
                    <tr key={plan.id}>
                      <td>{plan.clients?.company_name ?? 'Unlinked client'}</td>
                      <td>{plan.name}</td>
                      <td className="text-muted">{plan.website_projects?.name ?? '—'}</td>
                      <td>{money(plan.monthly_amount, plan.currency)}</td>
                      <td>
                        <Badge tone={STATUS_TONE[plan.status] ?? 'muted'}>{plan.status}</Badge>
                      </td>
                      <td>
                        <MaintenanceActions planId={plan.id} status={plan.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <Card title="New plan">
          <MaintenancePlanForm clients={clients ?? []} projects={projects ?? []} />
        </Card>
      </div>
    </div>
  )
}
