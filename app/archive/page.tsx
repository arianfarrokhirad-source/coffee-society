import Link from 'next/link'
import { adminClient } from '@/lib/supabase/admin'

// Rendered on demand: keeps the archive fresh and avoids executing a
// Supabase query at build time (which fails when env vars are absent,
// e.g. on a Vercel project without configuration).
export const dynamic = 'force-dynamic'

type Q = {
  id: string
  name: string
  question: string
  answer: string | null
  answered_at: string | null
  created_at: string
}

export default async function ArchivePage() {
  const { data } = await adminClient
    .from('questions')
    .select('id, name, question, answer, answered_at, created_at')
    .eq('status', 'answered')
    .order('answered_at', { ascending: false })
    .limit(100)

  const items = (data ?? []) as Q[]

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <div className="text-blood text-xs uppercase tracking-[0.3em] mb-6">
        The archive
      </div>
      <h1 className="serif text-5xl font-black mb-6">
        Answered questions.
      </h1>
      <p className="text-ash text-lg mb-12 max-w-2xl leading-relaxed">
        Every question that has passed through the reading room and received an
        answer. Read them in order, or dive in wherever pulls you.
      </p>

      {items.length === 0 ? (
        <div className="border border-line p-12 text-center bg-char">
          <p className="text-ash text-lg mb-6 serif italic">
            The archive is still being written.
          </p>
          <Link
            href="/ask"
            className="inline-block px-6 py-3 bg-blood text-bone hover:bg-rust transition"
          >
            Be the first to ask →
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {items.map((q) => (
            <article
              key={q.id}
              className="border border-line bg-char p-6 sm:p-8 hover:border-blood/40 transition"
            >
              <div className="flex items-baseline justify-between gap-4 mb-4 flex-wrap">
                <div className="text-blood text-xs uppercase tracking-wider">
                  Asked by {q.name}
                </div>
                <div className="text-ash/60 text-xs">
                  {formatDate(q.answered_at ?? q.created_at)}
                </div>
              </div>
              <h2 className="serif text-2xl sm:text-3xl mb-6 leading-tight text-bone">
                {q.question}
              </h2>
              <div className="h-px bg-line mb-6" />
              <div className="text-ash leading-relaxed whitespace-pre-line">
                {q.answer}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
