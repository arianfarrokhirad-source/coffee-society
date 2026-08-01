import { Badge, Card, EmptyState } from '@jarvis/ui'
import ApprovalActions from '@/components/ApprovalActions'
import { getAuthContext } from '@/lib/auth'
import { createUserClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function ApprovalsPage() {
  const auth = await getAuthContext()
  const supabase = await createUserClient()
  const [{ data: pending }, { data: resolved }] = await Promise.all([
    supabase
      .from('approvals')
      .select('*, businesses(code)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    supabase
      .from('approvals')
      .select('*, businesses(code)')
      .neq('status', 'pending')
      .order('updated_at', { ascending: false })
      .limit(25),
  ])

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-white">Approval Centre</h1>
        <p className="text-sm text-muted">
          Restricted actions wait here.{' '}
          {auth?.isPrime ? 'You hold PRIME authority.' : 'Only PRIME can resolve them.'}
        </p>
      </header>

      <Card title={`Pending (${pending?.length ?? 0})`}>
        {(pending ?? []).length === 0 ? (
          <EmptyState
            title="Nothing awaiting approval"
            hint="Agent requests for restricted actions will appear here."
          />
        ) : (
          <div className="space-y-4">
            {(pending ?? []).map((a) => (
              <div key={a.id} className="rounded border border-edge p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-white">{a.action_type}</span>
                  <Badge
                    tone={
                      a.risk_level === 'critical' || a.risk_level === 'high' ? 'danger' : 'warn'
                    }
                  >
                    {a.risk_level} risk
                  </Badge>
                  {(a.businesses as { code?: string } | null)?.code && (
                    <Badge tone="muted">{(a.businesses as { code: string }).code}</Badge>
                  )}
                  {a.estimated_cost != null && (
                    <Badge tone="gold">
                      ~{a.estimated_cost} {a.currency ?? ''}
                    </Badge>
                  )}
                </div>
                <p className="mt-2 text-sm text-gray-300">{a.reason ?? 'No reason provided.'}</p>
                <p className="mt-1 text-xs text-muted">
                  Requested {new Date(a.created_at).toLocaleString()} ·{' '}
                  {a.requested_by_agent_id ? 'by agent' : 'by user'}
                </p>
                {auth?.isPrime && (
                  <div className="mt-3">
                    <ApprovalActions approvalId={a.id} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Recently resolved">
        {(resolved ?? []).length === 0 ? (
          <EmptyState title="No history yet" />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Action</th>
                <th>Business</th>
                <th>Status</th>
                <th>Resolved</th>
              </tr>
            </thead>
            <tbody>
              {(resolved ?? []).map((a) => (
                <tr key={a.id}>
                  <td>{a.action_type}</td>
                  <td className="text-muted">
                    {(a.businesses as { code?: string } | null)?.code ?? '—'}
                  </td>
                  <td>
                    <Badge
                      tone={a.status === 'approved' || a.status === 'executed' ? 'ok' : 'danger'}
                    >
                      {a.status}
                    </Badge>
                  </td>
                  <td className="text-muted">
                    {a.approved_at ? new Date(a.approved_at).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
