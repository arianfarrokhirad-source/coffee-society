import { Badge, Card, EmptyState, StatTile } from '@jarvis/ui'
import { ProposalActions, ProposalForm } from '@/components/crm'
import { money, sumByCurrency } from '@/lib/money'
import { createUserClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface LineItem {
  description?: unknown
  amount?: unknown
}

interface ProposalRow {
  id: string
  title: string
  summary: string | null
  line_items: LineItem[] | null
  total_amount: string | number | null
  currency: string
  status: string
  created_at: string
  leads: { company_name: string } | null
  businesses: { code: string } | null
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Needs approval',
  approved: 'Approved',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
}

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'muted'> = {
  accepted: 'ok',
  approved: 'ok',
  sent: 'warn',
  pending_approval: 'warn',
  declined: 'danger',
  expired: 'muted',
}

/** Open = still capable of becoming revenue. */
const OPEN = new Set(['draft', 'pending_approval', 'approved', 'sent'])

/** Adapts proposal rows onto the shared per-currency sum. */
function totalsByCurrency(rows: ProposalRow[]): { currency: string; total: number }[] {
  return sumByCurrency(rows.map((row) => ({ amount: row.total_amount, currency: row.currency })))
}

export default async function ProposalsPage() {
  const supabase = await createUserClient()
  const [{ data: proposals }, { data: leads }, { data: audits }] = await Promise.all([
    supabase
      .from('proposals')
      .select(
        'id, title, summary, line_items, total_amount, currency, status, created_at, leads(company_name), businesses(code)'
      )
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('leads')
      .select('id, company_name, status')
      .not('status', 'in', '(won,lost,archived)')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('website_audits')
      .select('id, lead_id, score')
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const rows = (proposals ?? []) as unknown as ProposalRow[]
  const open = rows.filter((p) => OPEN.has(p.status))
  const accepted = rows.filter((p) => p.status === 'accepted')
  const outstanding = totalsByCurrency(rows.filter((p) => p.status === 'sent'))
  const won = totalsByCurrency(accepted)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-white">Proposals</h1>
        <p className="text-sm text-muted">
          What was quoted, to whom, and where it stands. Totals are calculated from line items —
          never submitted by the browser.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Open" value={String(open.length)} />
        <StatTile
          label="Out with clients"
          value={
            outstanding.length === 0
              ? '—'
              : outstanding.map((t) => money(t.total, t.currency)).join(' · ')
          }
          tone="warn"
        />
        <StatTile
          label="Accepted"
          value={won.length === 0 ? '—' : won.map((t) => money(t.total, t.currency)).join(' · ')}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="All proposals">
            {rows.length === 0 ? (
              <EmptyState
                title="No proposals yet"
                hint="Write one against an open lead using the form on the right."
              />
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Proposal</th>
                    <th>Lead</th>
                    <th className="text-right">Total</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((proposal) => (
                    <tr key={proposal.id}>
                      <td>
                        <span className="text-white">{proposal.title}</span>
                        <div className="text-xs text-muted">
                          {(proposal.line_items ?? []).length} item
                          {(proposal.line_items ?? []).length === 1 ? '' : 's'}
                          {proposal.businesses?.code ? ` · ${proposal.businesses.code}` : ''}
                        </div>
                      </td>
                      <td className="text-muted">{proposal.leads?.company_name ?? '—'}</td>
                      <td className="whitespace-nowrap text-right tabular-nums text-white">
                        {money(proposal.total_amount, proposal.currency)}
                      </td>
                      <td>
                        <Badge tone={STATUS_TONE[proposal.status] ?? 'muted'}>
                          {STATUS_LABEL[proposal.status] ?? proposal.status}
                        </Badge>
                      </td>
                      <td>
                        <ProposalActions proposalId={proposal.id} status={proposal.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <Card title="New proposal">
          <ProposalForm leads={leads ?? []} audits={audits ?? []} />
        </Card>
      </div>
    </div>
  )
}
