import Link from 'next/link'
import { Badge, Card, EmptyState } from '@jarvis/ui'
import { createUserClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function BusinessesPage() {
  const supabase = await createUserClient()
  const { data: businesses } = await supabase.from('businesses').select('*').order('code')

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-white">Businesses</h1>
        <p className="text-sm text-muted">A00–A08 portfolio</p>
      </header>
      {(businesses ?? []).length === 0 ? (
        <EmptyState
          title="No businesses visible"
          hint="Run migrations + seed, then claim PRIME (Executive page) to gain access."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(businesses ?? []).map((b) => (
            <Link key={b.id} href={`/businesses/${b.id}`}>
              <Card>
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-white">
                    {b.code} · {b.name}
                  </p>
                  <Badge tone={b.status === 'active' ? 'ok' : 'muted'}>{b.status}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted">{b.description ?? 'No description.'}</p>
                {!b.agents_enabled && <p className="mt-2 text-xs text-warn">Agents disabled</p>}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
