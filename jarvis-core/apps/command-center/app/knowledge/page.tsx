import Link from 'next/link'
import { Badge, Card, EmptyState, StatTile } from '@jarvis/ui'
import { DocumentForm } from '@/components/documents'
import { readGraph, readVault } from '@/lib/knowledge'
import { createUserClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const TYPE_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'muted'> = {
  adr: 'ok',
  sop: 'warn',
  learning: 'muted',
  ceo: 'muted',
}

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const term = q?.trim() ?? ''
  const supabase = await createUserClient()

  let query = supabase
    .from('documents')
    .select('*, businesses(code)')
    .eq('status', 'active')
    .limit(50)
  if (term.length >= 2) {
    query = query.ilike('title', `%${term.replace(/[%_]/g, '')}%`)
  }

  // The three stores are independent and none is allowed to block the
  // others: a missing code index must not hide the documents.
  const [{ data: documents }, { data: businesses }, vault, graph] = await Promise.all([
    query,
    supabase.from('businesses').select('id, code').order('code').limit(100),
    readVault(term),
    readGraph(),
  ])

  const vaultResults = term.length >= 2 ? vault.hits.map((hit) => hit.note) : vault.notes

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-white">Knowledge</h1>
        <p className="text-sm text-muted">
          Three stores, three different questions. Supabase holds the files, the vault holds the
          reasoning, Graphify holds the code. Nothing is duplicated between them.
        </p>
      </header>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search documents and decisions…"
          className="w-72"
        />
        <button className="btn-ghost">Search</button>
      </form>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Documents" value={String((documents ?? []).length)} />
        <StatTile
          label="Vault notes"
          value={vault.available ? String(vault.notes.length) : '—'}
          tone={vault.available ? 'ok' : 'muted'}
        />
        <StatTile
          label="Indexed files"
          value={graph.available ? String(graph.report?.totals.files ?? 0) : '—'}
          tone={graph.health?.status === 'healthy' ? 'ok' : 'muted'}
        />
      </div>

      <Card title="Documents">
        {(documents ?? []).length === 0 ? (
          <EmptyState
            title={term ? 'No documents match your search' : 'No documents yet'}
            hint="Document upload wiring lands with the Storage setup — metadata, classification and versioning are ready."
          />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Title</th>
                <th>Business</th>
                <th>Classification</th>
                <th>Approval</th>
                <th>Version</th>
              </tr>
            </thead>
            <tbody>
              {(documents ?? []).map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link href={`/knowledge/${d.id}`} className="underline">
                      {d.title}
                    </Link>
                  </td>
                  <td className="text-muted">
                    {(d.businesses as { code?: string } | null)?.code ?? 'Org'}
                  </td>
                  <td>
                    <Badge tone={d.classification === 'restricted' ? 'danger' : 'muted'}>
                      {d.classification}
                    </Badge>
                  </td>
                  <td>
                    <Badge tone={d.approval_status === 'approved' ? 'ok' : 'muted'}>
                      {d.approval_status}
                    </Badge>
                  </td>
                  <td className="text-muted">v{d.current_version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="New document">
        <DocumentForm businesses={businesses ?? []} />
      </Card>

      <Card title="Decisions and procedures">
        {!vault.available ? (
          <EmptyState
            title="Vault not available in this deployment"
            hint="The vault is read from disk. Set JARVIS_VAULT_PATH, or run npm run vault:check locally."
          />
        ) : vaultResults.length === 0 ? (
          <EmptyState
            title={term ? 'No notes match your search' : 'No notes yet'}
            hint="ADRs record why a decision was made; SOPs record how something is done."
          />
        ) : (
          <div className="space-y-3">
            {vaultResults.slice(0, 25).map((note) => (
              <article key={note.path} className="rounded border border-edge p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-white">{String(note.frontmatter.title ?? note.slug)}</span>
                  <div className="flex items-center gap-2">
                    <Badge tone={TYPE_TONE[note.frontmatter.type] ?? 'muted'}>
                      {note.frontmatter.type}
                    </Badge>
                    {typeof note.frontmatter.status === 'string' && (
                      <Badge tone={note.frontmatter.status === 'accepted' ? 'ok' : 'muted'}>
                        {note.frontmatter.status}
                      </Badge>
                    )}
                  </div>
                </div>
                {/* Provenance on every result: path and date, so a reader
                    can judge freshness without opening the file. */}
                <div className="mt-1 text-xs text-muted">
                  {note.path}
                  {typeof note.frontmatter.date === 'string' && ` · ${note.frontmatter.date}`}
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>

      <Card title="Code memory">
        {!graph.available || !graph.report || !graph.health ? (
          <EmptyState
            title="No code index in this deployment"
            hint="The index is derived data and is not committed. CI rebuilds it on every push; run npm run graph locally."
          />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={graph.health.status === 'healthy' ? 'ok' : 'warn'}>
                {graph.health.status}
              </Badge>
              <span className="text-sm text-muted">
                {graph.report.totals.files} files · {graph.report.totals.symbols} symbols ·{' '}
                {graph.report.totals.importEdges} imports · {graph.report.totals.callEdges} calls
              </span>
            </div>

            {graph.health.issues.length > 0 && (
              <ul className="space-y-1 text-sm text-muted">
                {graph.health.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}

            {graph.report.hotspots.length > 0 && (
              <div>
                <div className="text-xs text-muted">Most depended-on modules</div>
                <ul className="mt-1 space-y-1">
                  {graph.report.hotspots.slice(0, 5).map((hotspot) => (
                    <li key={hotspot.path} className="flex items-baseline gap-2 text-sm">
                      <Badge tone="muted">{hotspot.fanIn}</Badge>
                      <span>{hotspot.path}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
