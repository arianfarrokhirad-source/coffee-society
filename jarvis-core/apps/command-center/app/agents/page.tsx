import { Badge, Card, EmptyState } from '@jarvis/ui'
import { createUserClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function AgentsPage() {
  const supabase = await createUserClient()
  const { data: agents } = await supabase
    .from('agents')
    .select('*, businesses(code, name)')
    .order('code')

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-white">Agents</h1>
        <p className="text-sm text-muted">
          AI agents hold no permissions of their own — everything runs through server-side checks.
        </p>
      </header>
      {(agents ?? []).length === 0 ? (
        <EmptyState title="No agents visible" hint="Run migrations + seed and claim PRIME first." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(agents ?? []).map((a) => (
            <Card key={a.id}>
              <div className="flex items-center justify-between">
                <p className="font-semibold text-white">
                  {a.code} · {a.name}
                </p>
                <span className="flex gap-2">
                  <Badge tone="info">{a.authority_level}</Badge>
                  <Badge tone={a.active ? 'ok' : 'muted'}>{a.active ? 'active' : 'inactive'}</Badge>
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">
                {(a.businesses as { code?: string; name?: string } | null)
                  ? `${(a.businesses as { code: string }).code} ${(a.businesses as { name: string }).name}`
                  : 'Organization-wide'}
              </p>
              {a.description && <p className="mt-2 text-sm text-gray-300">{a.description}</p>}
              <div className="mt-3 text-xs">
                <p className="text-muted">
                  Allowed: {(a.allowed_action_types as string[]).join(', ') || 'none'}
                </p>
                <p className="mt-1 text-danger/80">
                  Prohibited: {(a.prohibited_action_types as string[]).join(', ') || 'none'}
                </p>
                <p className="mt-1 text-muted">
                  Financial authority: {a.max_financial_authority} {a.currency} · Prompt{' '}
                  {a.prompt_version}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
