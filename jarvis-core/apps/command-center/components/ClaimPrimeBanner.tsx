'use client'

import { useActionState } from 'react'
import { claimPrime } from '@/app/actions/auth'

export default function ClaimPrimeBanner() {
  const [state, action, pending] = useActionState(async () => claimPrime(), { error: null })
  return (
    <div className="mb-6 rounded-lg border border-gold/40 bg-gold/10 p-4">
      <p className="font-semibold text-gold">PRIME has not been claimed yet</p>
      <p className="mt-1 text-sm text-gray-300">
        The first authenticated user becomes PRIME (founder authority, L5). This can happen exactly
        once and is recorded in the audit log.
      </p>
      {state.error && <p className="mt-2 text-sm text-danger">{state.error}</p>}
      <form action={action} className="mt-3">
        <button className="btn" disabled={pending}>
          {pending ? 'Claiming…' : 'Claim PRIME now'}
        </button>
      </form>
    </div>
  )
}
