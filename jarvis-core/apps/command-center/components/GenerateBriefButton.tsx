'use client'

import { useState, useTransition } from 'react'
import { generateBriefAction } from '@/app/actions/brief'

export default function GenerateBriefButton() {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <div>
      <button
        className="btn"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await generateBriefAction()
            setError(result.error)
          })
        }
      >
        {pending ? 'Generating…' : "Generate today's brief"}
      </button>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  )
}
