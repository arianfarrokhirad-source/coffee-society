'use client'

import { useActionState } from 'react'
import { signIn, signUp, type AuthFormState } from '@/app/actions/auth'

const initial: AuthFormState = { error: null, notice: null, email: null }

export default function LoginPage() {
  const [signInState, signInAction, signInPending] = useActionState(signIn, initial)
  const [signUpState, signUpAction, signUpPending] = useActionState(signUp, initial)

  // One form, two actions: either submission must disable BOTH buttons,
  // otherwise a second action can be fired while the first is in flight.
  const pending = signInPending || signUpPending

  // Whichever action last produced output owns the message. Previously
  // the sign-in error was preferred unconditionally, so a stale sign-in
  // failure masked the real signup failure that followed it.
  const active = signUpState.error || signUpState.notice ? signUpState : signInState
  const email = signUpState.email ?? signInState.email ?? ''

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
            defaultValue={email}
            key={email}
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

        {active.error && (
          <p role="alert" className="text-sm text-danger">
            {active.error}
          </p>
        )}
        {!active.error && active.notice && (
          <p role="status" className="text-sm text-muted">
            {active.notice}
          </p>
        )}

        <button className="btn w-full" disabled={pending}>
          {signInPending ? 'Signing in…' : 'Sign in'}
        </button>
        <button formAction={signUpAction} className="btn-ghost w-full" disabled={pending}>
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
