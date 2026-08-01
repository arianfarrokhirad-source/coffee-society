'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { buildAuditEvent } from '@jarvis/security'
import { getStore } from '@/lib/jarvis'
import { createUserClient } from '@/lib/supabase/server'

const credentialsSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(10).max(200),
})

export interface AuthFormState {
  error: string | null
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success)
    return { error: 'Enter a valid email and a password of at least 10 characters.' }

  const supabase = await createUserClient()
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error || !data.user) {
    return { error: 'Sign in failed. Check your credentials.' }
  }
  await getStore().writeAudit(
    buildAuditEvent({
      actorType: 'user',
      actorId: data.user.id,
      action: 'auth.sign_in',
    })
  )
  redirect('/executive')
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success)
    return { error: 'Enter a valid email and a password of at least 10 characters.' }

  const supabase = await createUserClient()
  const { data, error } = await supabase.auth.signUp(parsed.data)
  if (error) return { error: 'Sign up failed. The email may already be registered.' }
  await getStore().writeAudit(
    buildAuditEvent({
      actorType: 'user',
      actorId: data.user?.id ?? null,
      action: 'auth.sign_up',
    })
  )
  if (data.session) redirect('/executive')
  return { error: 'Account created. If email confirmation is enabled, confirm before signing in.' }
}

export async function signOut(): Promise<void> {
  const supabase = await createUserClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  await supabase.auth.signOut()
  if (user) {
    await getStore().writeAudit(
      buildAuditEvent({ actorType: 'user', actorId: user.id, action: 'auth.sign_out' })
    )
  }
  redirect('/login')
}

/**
 * Secure PRIME setup: calls the claim_prime() database function, which
 * atomically assigns the FIRST authenticated caller as PRIME and refuses
 * forever after. No email is hard-coded anywhere.
 */
export async function claimPrime(): Promise<AuthFormState> {
  const supabase = await createUserClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const { error } = await supabase.rpc('claim_prime')
  if (error) {
    return {
      error: error.message.includes('already been claimed')
        ? 'PRIME has already been claimed for this organization.'
        : 'Could not claim PRIME. Check that migrations and seed have run.',
    }
  }
  revalidatePath('/', 'layout')
  redirect('/executive')
}
