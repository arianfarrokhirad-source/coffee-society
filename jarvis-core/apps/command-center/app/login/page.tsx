'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { signIn, type AuthFormState } from '@/app/actions/auth'

const initial: AuthFormState = { error: null, notice: null, email: null }

// Sign-in only. Account creation lives at /register, reached by a LINK —
// never a second submit button on this form. The previous version had
// both actions posting the same two fields, which is why registration
// could not collect anything else and why a stale sign-in error could
// mask a signup failure.
export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, initial)

  return (
    <div className="mx-auto mt-24 max-w-sm">
      <h1 className="text-center text-2xl font-bold tracking-widest text-white">JARVIS</h1>
      <p className="mt-1 text-center text-sm text-muted">Command Centre access</p>

      <form action={action} className="mt-8 space-y-3 rounded-lg border border-edge bg-panel p-5">
        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            defaultValue={state.email ?? ''}
            key={state.email ?? ''}
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

        {state.error && (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        )}
        {!state.error && state.notice && (
          <p role="status" className="text-sm text-muted">
            {state.notice}
          </p>
        )}

        <button className="btn w-full" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="text-xs text-muted">
          No account yet?{' '}
          <Link href="/register" className="underline">
            Create account
          </Link>
        </p>
      </form>
    </div>
  )
}
