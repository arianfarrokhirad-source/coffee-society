'use client'

import { useActionState } from 'react'
import { claimPrime } from '@/app/actions/auth'

// The setup token is submitted directly via the form action: it is
// never placed in React state, never appended to a URL or query
// parameter, never stored in browser storage, and never echoed back in
// the action's returned state (which carries only a generic message).
export default function ClaimPrimeBanner() {
  const [state, action, pending] = useActionState(claimPrime, { error: null })
  return (
    <div className="mb-6 rounded-lg border border-gold/40 bg-gold/10 p-4">
      <p className="font-semibold text-gold">PRIME has not been claimed yet</p>
      <p className="mt-1 text-sm text-gray-300">
        Claiming requires the one-time setup token configured on the server (
        <code>JARVIS_PRIME_SETUP_TOKEN</code>). This can succeed exactly once and is recorded in the
        audit log. Remove or rotate the token afterwards.
      </p>
      <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="setupToken">Setup token</label>
          <input
            id="setupToken"
            name="setupToken"
            type="password"
            required
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            className="mt-1 w-80"
          />
        </div>
        <button className="btn" disabled={pending}>
          {pending ? 'Claiming…' : 'Claim PRIME'}
        </button>
      </form>
      {state.error && <p className="mt-2 text-sm text-danger">{state.error}</p>}
    </div>
  )
}
