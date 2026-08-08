import { Badge, Card, EmptyState, StatTile } from '@jarvis/ui'
import { LeadActions, LeadForm } from '@/components/crm'
import { createUserClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface LeadRow {
  id: string
  company_name: string
  contact_name: string | null
  contact_email: string | null
  website_url: string | null
  source: string | null
  status: string
  created_at: string
  businesses: { code: string } | null
}

interface ClientRow {
  id: string
  company_name: string
  contact_name: string | null
  contact_email: string | null
  status: string
  lead_id: string | null
  created_at: string
  businesses: { code: string } | null
}

/** Open stages, in funnel order. Closed stages are listed separately. */
const OPEN_STAGES = ['new', 'contacted', 'qualified', 'audit_scheduled', 'proposal_sent'] as const

const STAGE_LABEL: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  audit_scheduled: 'Audit booked',
  proposal_sent: 'Proposal sent',
  won: 'Won',
  lost: 'Lost',
  archived: 'Archived',
}

const STAGE_TONE: Record<string, 'ok' | 'warn' | 'muted'> = {
  proposal_sent: 'warn',
  qualified: 'warn',
  won: 'ok',
}

function tone(status: string): 'ok' | 'warn' | 'muted' {
  return STAGE_TONE[status] ?? 'muted'
}

export default async function ClientsPage() {
  const supabase = await createUserClient()
  const [{ data: leads }, { data: clients }, { data: businesses }] = await Promise.all([
    supabase
      .from('leads')
      .select(
        'id, company_name, contact_name, contact_email, website_url, source, status, created_at, businesses(code)'
      )
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('clients')
      .select(
        'id, company_name, contact_name, contact_email, status, lead_id, created_at, businesses(code)'
      )
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('businesses').select('id, code, name').eq('status', 'active').order('code'),
  ])

  const allLeads = (leads ?? []) as unknown as LeadRow[]
  const allClients = (clients ?? []) as unknown as ClientRow[]
  const convertedLeadIds = new Set(allClients.map((c) => c.lead_id).filter(Boolean))

  const open = allLeads.filter((l) => (OPEN_STAGES as readonly string[]).includes(l.status))
  const closed = allLeads.filter((l) => l.status === 'lost' || l.status === 'archived')
  const activeClients = allClients.filter((c) => c.status === 'active')

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-white">Clients</h1>
        <p className="text-sm text-muted">
          Lead to client, one pipeline. Contact details stay internal — the client role has no
          access to these records.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Open leads" value={String(open.length)} />
        <StatTile
          label="Proposals out"
          value={String(allLeads.filter((l) => l.status === 'proposal_sent').length)}
        />
        <StatTile label="Active clients" value={String(activeClients.length)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Pipeline">
            {open.length === 0 ? (
              <EmptyState
                title="No open leads"
                hint="Add the first one on the right — company name and business are all you need to start."
              />
            ) : (
              <div className="space-y-5">
                {OPEN_STAGES.map((stage) => {
                  const rows = open.filter((l) => l.status === stage)
                  if (rows.length === 0) return null
                  return (
                    <section key={stage}>
                      <h3 className="mb-2 text-xs uppercase tracking-wider text-muted">
                        {STAGE_LABEL[stage]} · {rows.length}
                      </h3>
                      <table className="data">
                        <tbody>
                          {rows.map((lead) => (
                            <tr key={lead.id}>
                              <td>
                                <span className="text-white">{lead.company_name}</span>
                                {lead.contact_name && (
                                  <span className="text-muted"> · {lead.contact_name}</span>
                                )}
                                {lead.website_url && (
                                  <div className="text-xs text-muted">{lead.website_url}</div>
                                )}
                              </td>
                              <td className="whitespace-nowrap text-xs text-muted">
                                {lead.businesses?.code ?? '—'}
                              </td>
                              <td className="whitespace-nowrap text-xs text-muted">
                                {lead.source ?? '—'}
                              </td>
                              <td>
                                <LeadActions
                                  leadId={lead.id}
                                  status={lead.status}
                                  converted={convertedLeadIds.has(lead.id)}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </section>
                  )
                })}
              </div>
            )}
          </Card>

          <Card title="Clients">
            {allClients.length === 0 ? (
              <EmptyState
                title="No clients yet"
                hint="Convert a lead with “Won → client” once a proposal is accepted."
              />
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Contact</th>
                    <th>Business</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {allClients.map((client) => (
                    <tr key={client.id}>
                      <td className="text-white">{client.company_name}</td>
                      <td className="text-muted">
                        {client.contact_name ?? client.contact_email ?? '—'}
                      </td>
                      <td className="text-muted">{client.businesses?.code ?? '—'}</td>
                      <td>
                        <Badge tone={client.status === 'active' ? 'ok' : 'muted'}>
                          {client.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {closed.length > 0 && (
            <Card title={`Lost and archived · ${closed.length}`}>
              <table className="data">
                <tbody>
                  {closed.map((lead) => (
                    <tr key={lead.id}>
                      <td className="text-muted">{lead.company_name}</td>
                      <td>
                        <Badge tone={tone(lead.status)}>{STAGE_LABEL[lead.status]}</Badge>
                      </td>
                      <td>
                        <LeadActions
                          leadId={lead.id}
                          status={lead.status}
                          converted={convertedLeadIds.has(lead.id)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>

        <Card title="New lead">
          {(businesses ?? []).length === 0 ? (
            <EmptyState title="No businesses" hint="A lead has to belong to a business." />
          ) : (
            <LeadForm businesses={businesses ?? []} />
          )}
        </Card>
      </div>
    </div>
  )
}
