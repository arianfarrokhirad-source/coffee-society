import Link from 'next/link'
import { submitQuestion } from '@/app/actions/questions'
import SubmitButton from '@/components/SubmitButton'

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>
}) {
  const params = await searchParams
  const submitted = params.ok === '1'

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-24 text-center">
        <div className="text-blood text-xs uppercase tracking-[0.3em] mb-6">
          Received
        </div>
        <h1 className="serif text-5xl font-black mb-6">Thank you.</h1>
        <p className="text-ash text-lg mb-10 max-w-lg mx-auto">
          Your question has been noted. We answer questions on a slow rhythm —
          usually within a few days. Every answer appears in the public archive.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/archive"
            className="px-6 py-3 border border-line text-bone hover:border-blood hover:text-blood transition"
          >
            Read the archive
          </Link>
          <Link
            href="/ask"
            className="px-6 py-3 bg-blood text-bone hover:bg-rust transition"
          >
            Ask another
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      <div className="text-blood text-xs uppercase tracking-[0.3em] mb-6">
        The reading room
      </div>
      <h1 className="serif text-5xl font-black mb-6">Ask a question.</h1>
      <p className="text-ash text-lg mb-10 leading-relaxed">
        Curious about the origin of a bean? The chemistry of extraction? The
        history of a café? Send us your question. We read every one and answer
        the good ones here, in public, for everyone who might have wondered
        the same.
      </p>

      {params.error && (
        <div className="mb-6 p-4 border border-blood bg-blood/10 text-bone">
          {decodeURIComponent(params.error)}
        </div>
      )}

      <form action={submitQuestion} className="space-y-6">
        <div>
          <label className="block text-sm text-ash mb-2 uppercase tracking-wider">
            Your name <span className="text-ash/60">(or a pen name)</span>
          </label>
          <input
            name="name"
            required
            maxLength={80}
            className="w-full bg-char border border-line px-4 py-3 text-bone focus:border-blood focus:outline-none transition"
            placeholder="e.g. Kaldi from Kaffa"
          />
        </div>

        <div>
          <label className="block text-sm text-ash mb-2 uppercase tracking-wider">
            Email <span className="text-ash/60">(kept private, only for notification)</span>
          </label>
          <input
            name="email"
            type="email"
            required
            maxLength={200}
            className="w-full bg-char border border-line px-4 py-3 text-bone focus:border-blood focus:outline-none transition"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label className="block text-sm text-ash mb-2 uppercase tracking-wider">
            Your question
          </label>
          <textarea
            name="question"
            required
            rows={6}
            maxLength={2000}
            className="w-full bg-char border border-line px-4 py-3 text-bone focus:border-blood focus:outline-none transition resize-none"
            placeholder="What would you like to know?"
          />
          <div className="text-ash/60 text-xs mt-2">
            Max 2000 characters. Be specific — good questions get good answers.
          </div>
        </div>

        <SubmitButton className="w-full px-8 py-4 bg-blood text-bone hover:bg-rust transition font-medium text-lg">
          Send question →
        </SubmitButton>
      </form>
    </div>
  )
}
