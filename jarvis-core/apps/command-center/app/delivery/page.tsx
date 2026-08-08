import { Badge, Card, EmptyState, StatTile } from '@jarvis/ui'
import { ProjectActions, ProjectForm } from '@/components/delivery'
import { PUBLISH_ACTION } from '@/lib/delivery'
import { createUserClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/** PostgREST types an embedded relation as an array; these are the
 *  single-row shapes the queries actually return. */
interface AcceptedProposal {
  id: string
  title: string
  leads: { company_name: string } | null
}

interface ProjectRow {
  id: string
  name: string
  status: string
  deployed_url: string | null
  created_at: string
  clients: { company_name: string } | null
  businesses: { code: string } | null
}

const STAGE_ORDER = ['planning', 'design', 'build', 'review', 'deployed', 'closed'] as const

const STAGE_LABEL: Record<string, string> = {
  planning: 'Planning',
  design: 'Design',
  build: 'Build',
  review: 'Review',
  deployed: 'Live',
  closed: 'Closed',
}

export default async function DeliveryPage() {
  const supabase = await createUserClient()

  const [{ data: projects }, { data: proposals }, { data: goLive }] = await Promise.all([
    supabase
      .from('website_projects')
      .select('id, name, status, deployed_url, created_at, clients(company_name), businesses(code)')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('proposals')
      .select('id, title, leads(company_name)')
      .eq('status', 'accepted')
      .order('created_at', { ascending: false })
      .limit(100),
    // Approved go-live requests, so the board can show which projects are
    // cleared to publish without re-deriving the rule in the UI.
    supabase
      .from('approvals')
      .select('id, status, action_payload')
      .eq('action_type', PUBLISH_ACTION)
      .in('status', ['pending', 'approved'])
      .limit(200),
  ])

  const rows = (projects ?? []) as unknown as ProjectRow[]
  const acceptedProposals = (proposals ?? []) as unknown as AcceptedProposal[]

  const approvedFor = new Set<string>()
  const pendingFor = new Set<string>()
  for (const approval of goLive ?? []) {
    const payload = (approval.action_payload ?? {}) as { website_project_id?: unknown }
    const id = typeof payload.website_project_id === 'string' ? payload.website_project_id : null
    if (!id) continue
    if (approval.status === 'approved') approvedFor.add(id)
    if (approval.status === 'pending') pendingFor.add(id)
  }

  const active = rows.filter((p) => p.status !== 'closed')
  const live = rows.filter((p) => p.status === 'deployed')

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-white">Delivery</h1>
        <p className="text-sm text-muted">
          Accepted proposal to live site. Publishing is governed by <code>public.publish</code> —
          every go-live needs approval before a site is marked live.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="In delivery" value={String(active.length)} />
        <StatTile label="Awaiting go-live" value={String(pendingFor.size)} tone="warn" />
        <StatTile label="Live" value={String(live.length)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Projects">
            {rows.length === 0 ? (
              <EmptyState
                title="Nothing in delivery"
                hint="Start a project from an accepted proposal using the form on the right."
              />
            ) : (
              <div className="space-y-5">
                {STAGE_ORDER.map((stage) => {
                  const inStage = rows.filter((p) => p.status === stage)
                  if (inStage.length === 0) return null
                  return (
                    <section key={stage}>
                      <h3 className="mb-2 text-xs uppercase tracking-wider text-muted">
                        {STAGE_LABEL[stage]} · {inStage.length}
                      </h3>
                      <table className="data">
                        <tbody>
                          {inStage.map((project) => (
                            <tr key={project.id}>
                              <td>
                                <span className="text-white">{project.name}</span>
                                <div className="text-xs text-muted">
                                  {project.clients?.company_name ?? 'No client linked'}
                                  {project.businesses?.code ? ` · ${project.businesses.code}` : ''}
                                </div>
                                {project.deployed_url && (
                                  <a
                                    href={project.deployed_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-accent underline"
                                  >
                                    {project.deployed_url}
                                  </a>
                                )}
                              </td>
                              <td className="whitespace-nowrap">
                                {pendingFor.has(project.id) && (
                                  <Badge tone="warn">Go-live pending</Badge>
                                )}
                                {approvedFor.has(project.id) && project.status !== 'deployed' && (
                                  <Badge tone="ok">Approved</Badge>
                                )}
                              </td>
                              <td>
                                <ProjectActions
                                  projectId={project.id}
                                  status={project.status}
                                  hasApprovedGoLive={approvedFor.has(project.id)}
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
        </div>

        <div className="space-y-4">
          <Card title="Start delivery">
            <ProjectForm proposals={acceptedProposals} />
          </Card>
          <Card title="Live sites">
            {live.length === 0 ? (
              <EmptyState title="Nothing live yet" />
            ) : (
              <ul className="space-y-2 text-sm">
                {live.map((project) => (
                  <li key={project.id}>
                    <span className="text-white">{project.name}</span>
                    {project.deployed_url && (
                      <div>
                        <a
                          href={project.deployed_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-accent underline"
                        >
                          {project.deployed_url}
                        </a>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
