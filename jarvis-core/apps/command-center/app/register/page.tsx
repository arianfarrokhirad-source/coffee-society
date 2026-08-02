'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { register, type RegistrationFormState } from '@/app/actions/register'

const initial: RegistrationFormState = { error: null, notice: null, values: {} }

export default function RegisterPage() {
  const [state, action, pending] = useActionState(register, initial)
  const v = state.values ?? {}

  return (
    <div className="mx-auto mt-16 mb-16 max-w-sm">
      <h1 className="text-center text-2xl font-bold tracking-widest text-white">JARVIS</h1>
      <p className="mt-1 text-center text-sm text-muted">Create your account</p>

      <form action={action} className="mt-8 space-y-3 rounded-lg border border-edge bg-panel p-5">
        <div>
          <label htmlFor="displayName">Full name</label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            required
            maxLength={200}
            autoComplete="name"
            defaultValue={v.displayName ?? ''}
            className="mt-1 w-full"
          />
        </div>

        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            maxLength={200}
            autoComplete="email"
            defaultValue={v.email ?? ''}
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
            maxLength={200}
            autoComplete="new-password"
            className="mt-1 w-full"
          />
        </div>

        <div>
          <label htmlFor="confirmPassword">Confirm password</label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            minLength={10}
            maxLength={200}
            autoComplete="new-password"
            className="mt-1 w-full"
          />
        </div>

        <div>
          <label htmlFor="phone">
            Phone <span className="text-muted">(optional)</span>
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            placeholder="+447700900123"
            autoComplete="tel"
            defaultValue={v.phone ?? ''}
            className="mt-1 w-full"
          />
        </div>

        <div>
          <label htmlFor="dateOfBirth">
            Date of birth <span className="text-muted">(optional)</span>
          </label>
          <input
            id="dateOfBirth"
            name="dateOfBirth"
            type="date"
            autoComplete="bday"
            defaultValue={v.dateOfBirth ?? ''}
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
          {pending ? 'Creating account…' : 'Create account'}
        </button>

        <p className="text-xs text-muted">
          Already have an account?{' '}
          <Link href="/login" className="underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  )
}
