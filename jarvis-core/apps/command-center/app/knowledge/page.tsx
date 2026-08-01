import { Badge, Card, EmptyState } from '@jarvis/ui'
import { createUserClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const supabase = await createUserClient()

  let query = supabase
    .from('documents')
    .select('*, businesses(code)')
    .eq('status', 'active')
    .limit(50)
  if (q && q.trim().length >= 2) {
    query = query.ilike('title', `%${q.trim().replace(/[%_]/g, '')}%`)
  }
  const { data: documents } = await query

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-white">Knowledge</h1>
        <p className="text-sm text-muted">Document metadata. Files live in Supabase Storage.</p>
      </header>

      <form className="flex gap-2">
        <input name="q" defaultValue={q ?? ''} placeholder="Search titles…" className="w-72" />
        <button className="btn-ghost">Search</button>
      </form>

      <Card title="Documents">
        {(documents ?? []).length === 0 ? (
          <EmptyState
            title={q ? 'No documents match your search' : 'No documents yet'}
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
                  <td>{d.title}</td>
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
    </div>
  )
}
