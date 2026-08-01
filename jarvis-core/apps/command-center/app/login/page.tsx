'use client'

import { useActionState } from 'react'
import { signIn, signUp, type AuthFormState } from '@/app/actions/auth'

const initial: AuthFormState = { error: null }

export default function LoginPage() {
  const [signInState, signInAction, signInPending] = useActionState(signIn, initial)
  const [signUpState, signUpAction, signUpPending] = useActionState(signUp, initial)

  return (
    <div className="mx-auto mt-24 max-w-sm">
      <h1 className="text-center text-2xl font-bold tracking-widest text-white">JARVIS</h1>
      <p className="mt-1 text-center text-sm text-muted">Command Centre access</p>

      <form
        action={signInAction}
        className="mt-8 space-y-3 rounded-lg border border-edge bg-panel p-5"
      >
        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="mt-1 w-full"
          />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={10}
            autoComplete="current-password"
            className="mt-1 w-full"
          />
        </div>
        {(signInState.error || signUpState.error) && (
          <p className="text-sm text-danger">{signInState.error ?? signUpState.error}</p>
        )}
        <button className="btn w-full" disabled={signInPending}>
          {signInPending ? 'Signing in…' : 'Sign in'}
        </button>
        <button formAction={signUpAction} className="btn-ghost w-full" disabled={signUpPending}>
          {signUpPending ? 'Creating…' : 'Create account'}
        </button>
        <p className="text-xs text-muted">
          First account: create it, then claim PRIME from the Executive page. Passwords must be at
          least 10 characters.
        </p>
      </form>
    </div>
  )
}
