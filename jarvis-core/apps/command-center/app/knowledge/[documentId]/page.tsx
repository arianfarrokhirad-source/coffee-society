import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge, Card, EmptyState, StatTile } from '@jarvis/ui'
import { DocumentActions, VersionForm } from '@/components/documents'
import { hasStoredFile } from '@/lib/documents'
import { createUserClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface VersionRow {
  id: string
  version: number
  storage_path: string | null
  size_bytes: number | null
  change_note: string | null
  created_at: string
}

/** PostgREST types an embed as an array, so the row needs a cast. */
interface DocumentDetail {
  id: string
  title: string
  classification: string
  approval_status: string
  status: string
  current_version: number
  storage_bucket: string
  storage_path: string | null
  mime_type: string | null
  size_bytes: number | null
  uploaded_at: string | null
  created_at: string
  businesses: { code: string } | null
}

const CLASSIFICATION_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'muted'> = {
  public: 'ok',
  internal: 'muted',
  confidential: 'warn',
  restricted: 'danger',
}

/** Bytes at human scale. Null means "not recorded", not "zero bytes". */
function fileSize(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>
}) {
  const { documentId } = await params
  const supabase = await createUserClient()

  const { data: documentRow } = await supabase
    .from('documents')
    .select(
      'id, title, classification, approval_status, status, current_version, storage_bucket, ' +
        'storage_path, mime_type, size_bytes, uploaded_at, created_at, businesses(code)'
    )
    .eq('id', documentId)
    .maybeSingle()

  // Invisible under RLS and genuinely absent are indistinguishable from
  // here, and must stay that way — a "you may not see this" message
  // would confirm the document exists.
  if (!documentRow) notFound()
  const document = documentRow as unknown as DocumentDetail

  const { data: versions } = await supabase
    .from('document_versions')
    .select('id, version, storage_path, size_bytes, change_note, created_at')
    .eq('document_id', documentId)
    .order('version', { ascending: false })
    .limit(200)

  const history = (versions ?? []) as unknown as VersionRow[]
  const business = document.businesses?.code ?? 'Organisation-wide'

  // The stored pointer and the real history can disagree if an append
  // half-completed. Showing both beats showing a number that is wrong.
  const highestRecorded = history[0]?.version ?? null
  const pointerIsStale =
    highestRecorded != null && highestRecorded !== Number(document.current_version)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/knowledge" className="text-xs text-muted">
          ← Knowledge
        </Link>
        <h1 className="text-xl font-bold text-white">{document.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={CLASSIFICATION_TONE[document.classification] ?? 'muted'}>
            {document.classification}
          </Badge>
          <Badge tone={document.approval_status === 'approved' ? 'ok' : 'muted'}>
            {document.approval_status}
          </Badge>
          <Badge tone={document.status === 'active' ? 'ok' : 'muted'}>{document.status}</Badge>
          <span className="text-sm text-muted">{business}</span>
          <DocumentActions documentId={document.id} status={document.status} />
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Current version"
          value={`v${document.current_version}`}
          tone={pointerIsStale ? 'warn' : 'ok'}
        />
        <StatTile label="Versions recorded" value={String(history.length)} />
        <StatTile
          label="File"
          value={hasStoredFile(document.storage_path) ? fileSize(document.size_bytes) : 'None'}
          tone={hasStoredFile(document.storage_path) ? 'ok' : 'muted'}
        />
      </div>

      {pointerIsStale && (
        <Card title="History and pointer disagree">
          <p className="text-sm text-muted">
            The document records v{document.current_version} as current, but the highest recorded
            version is v{highestRecorded}. The next version added will correct it.
          </p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Version history">
            {history.length === 0 ? (
              <EmptyState
                title="No versions recorded"
                hint="Every change should leave a note, so anyone can see what this deliverable used to say."
              />
            ) : (
              <div className="space-y-3">
                {history.map((entry) => (
                  <article key={entry.id} className="rounded border border-edge p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          tone={entry.version === Number(document.current_version) ? 'ok' : 'muted'}
                        >
                          v{entry.version}
                        </Badge>
                        {entry.version === Number(document.current_version) && (
                          <span className="text-xs text-muted">current</span>
                        )}
                      </div>
                      <span className="text-xs text-muted">
                        {new Date(entry.created_at).toISOString().slice(0, 10)}
                      </span>
                    </div>

                    <p className="mt-2 text-sm">
                      {entry.change_note ?? <span className="text-muted">No note recorded</span>}
                    </p>

                    <div className="mt-1 text-xs text-muted">
                      {/* Never offer a download for a path that is not
                          there — upload is unwired and storage_path is
                          nullable, so "no file" is the common case. */}
                      {hasStoredFile(entry.storage_path)
                        ? `${entry.storage_path} · ${fileSize(entry.size_bytes)}`
                        : 'Metadata only — no file attached'}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card title="Add a version">
          {document.status === 'active' ? (
            <VersionForm documentId={document.id} />
          ) : (
            <p className="text-sm text-muted">
              This document is {document.status}. Restore it before adding versions.
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}
