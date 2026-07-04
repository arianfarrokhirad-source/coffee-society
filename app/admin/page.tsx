import { cookies } from 'next/headers'
import { adminClient } from '@/lib/supabase/admin'
import { answerQuestion, rejectQuestion } from '@/app/actions/questions'
import SubmitButton from '@/components/SubmitButton'
import ConfirmForm from '@/components/ConfirmForm'

type Q = {
  id: string
  name: string
  email: string
  question: string
  answer: string | null
  status: string
  created_at: string
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; tab?: string }>
}) {
  const params = await searchParams
  const c = await cookies()
  const authed = c.get('admin')?.value === process.env.ADMIN_PASSWORD

  if (!authed) {
    return (
      <div className="max-w-md mx-auto px-6 py-24">
        <h1 className="serif text-4xl font-black mb-8">Admin.</h1>
        {params.error && (
          <div className="mb-6 p-4 border border-blood bg-blood/10 text-bone text-sm">
            {decodeURIComponent(params.error)}
          </div>
        )}
        <form action="/api/admin-login" method="post" className="space-y-4">
          <input
            type="password"
            name="password"
            required
            autoFocus
            className="w-full bg-char border border-line px-4 py-3 text-bone focus:border-blood focus:outline-none"
            placeholder="Password"
          />
          <button
            type="submit"
            className="w-full px-6 py-3 bg-blood text-bone hover:bg-rust transition"
          >
            Enter
          </button>
        </form>
      </div>
    )
  }

  const tab = params.tab === 'answered' ? 'answered' : params.tab === 'rejected' ? 'rejected' : 'pending'

  const { data } = await adminClient
    .from('questions')
    .select('id, name, email, question, answer, status, created_at')
    .eq('status', tab)
    .order('created_at', { ascending: false })

  const items = (data ?? []) as Q[]

  // Counts for tab badges
  const { data: allData } = await adminClient
    .from('questions')
    .select('status')

  const counts = {
    pending: allData?.filter((r) => r.status === 'pending').length ?? 0,
    answered: allData?.filter((r) => r.status === 'answered').length ?? 0,
    rejected: allData?.filter((r) => r.status === 'rejected').length ?? 0,
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="flex items-baseline justify-between mb-8">
        <h1 className="serif text-4xl font-black">Admin.</h1>
        <form action="/api/admin-login" method="delete">
          <button className="text-ash text-sm hover:text-blood transition">
            Log out
          </button>
        </form>
      </div>

      {params.ok && (
        <div className="mb-6 p-4 border border-green-800 bg-green-950/30 text-green-200 text-sm">
          Action completed: {params.ok}
        </div>
      )}
      {params.error && (
        <div className="mb-6 p-4 border border-blood bg-blood/10 text-bone text-sm">
          {decodeURIComponent(params.error)}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-8 flex-wrap">
        <TabLink label="Pending" href="/admin?tab=pending" active={tab === 'pending'} count={counts.pending} color="bg-rust" />
        <TabLink label="Answered" href="/admin?tab=answered" active={tab === 'answered'} count={counts.answered} color="bg-green-700" />
        <TabLink label="Rejected" href="/admin?tab=rejected" active={tab === 'rejected'} count={counts.rejected} color="bg-ash" />
      </div>

      {items.length === 0 ? (
        <div className="border border-line p-12 text-center text-ash">
          Nothing in this tab.
        </div>
      ) : (
        <div className="space-y-6">
          {items.map((q) => (
            <div key={q.id} className="border border-line bg-char p-6">
              <div className="flex items-baseline justify-between gap-4 mb-3 flex-wrap">
                <div className="text-blood text-xs uppercase tracking-wider">
                  {q.name} — <span className="text-ash normal-case tracking-normal">{q.email}</span>
                </div>
                <div className="text-ash/60 text-xs">
                  {new Date(q.created_at).toLocaleString('en-GB')}
                </div>
              </div>

              <h3 className="serif text-xl text-bone mb-4 leading-snug">
                {q.question}
              </h3>

              {q.status === 'answered' && q.answer && (
                <div className="mt-4 p-4 border border-green-800/40 bg-green-950/20">
                  <div className="text-green-500 text-xs uppercase tracking-wider mb-2">Answer</div>
                  <div className="text-bone whitespace-pre-line">{q.answer}</div>
                </div>
              )}

              {q.status === 'pending' && (
                <div className="mt-4 space-y-3">
                  <form action={answerQuestion} className="space-y-3">
                    <input type="hidden" name="id" value={q.id} />
                    <textarea
                      name="answer"
                      required
                      rows={5}
                      placeholder="Write the answer here…"
                      className="w-full bg-ink border border-line px-4 py-3 text-bone focus:border-blood focus:outline-none resize-none"
                    />
                    <SubmitButton className="px-5 py-2 bg-blood text-bone hover:bg-rust transition text-sm">
                      Publish answer
                    </SubmitButton>
                  </form>

                  <ConfirmForm action={rejectQuestion} message="Reject this question?">
                    <input type="hidden" name="id" value={q.id} />
                    <button
                      type="submit"
                      className="text-ash text-xs hover:text-blood transition"
                    >
                      Reject question
                    </button>
                  </ConfirmForm>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TabLink({
  label,
  href,
  active,
  count,
  color,
}: {
  label: string
  href: string
  active: boolean
  count: number
  color: string
}) {
  return (
    <a
      href={href}
      className={`inline-flex items-center gap-2 px-4 py-2 text-sm border transition ${
        active
          ? 'border-blood text-bone bg-blood/10'
          : 'border-line text-ash hover:border-blood hover:text-bone'
      }`}
    >
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {label}
      <span className="ml-1 px-2 py-0.5 rounded-full bg-ink text-xs">{count}</span>
    </a>
  )
}


