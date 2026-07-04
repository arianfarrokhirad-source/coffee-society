'use server'
import { adminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

/**
 * Public form — anyone can submit a question.
 * Stored with status='pending'. Admin reviews and answers.
 */
export async function submitQuestion(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const question = String(formData.get('question') ?? '').trim()

  if (!name || !email || !question) {
    redirect('/ask?error=' + encodeURIComponent('All fields are required.'))
  }
  if (question.length < 10) {
    redirect('/ask?error=' + encodeURIComponent('Please write a longer question — at least 10 characters.'))
  }
  if (question.length > 2000) {
    redirect('/ask?error=' + encodeURIComponent('Question is too long — maximum 2000 characters.'))
  }

  const { error } = await adminClient.from('questions').insert({
    name,
    email,
    question,
    status: 'pending',
  })

  if (error) {
    redirect('/ask?error=' + encodeURIComponent('Something went wrong: ' + error.message))
  }

  redirect('/ask?ok=1')
}

/**
 * Admin action — publish an answer to a question.
 * Requires admin cookie.
 */
export async function answerQuestion(formData: FormData) {
  const c = await cookies()
  if (c.get('admin')?.value !== process.env.ADMIN_PASSWORD) {
    redirect('/admin')
  }

  const id = String(formData.get('id') ?? '')
  const answer = String(formData.get('answer') ?? '').trim()

  if (!id || !answer) {
    redirect('/admin?error=' + encodeURIComponent('Missing question ID or empty answer.'))
  }

  const { error } = await adminClient
    .from('questions')
    .update({
      answer,
      status: 'answered',
      answered_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    redirect('/admin?error=' + encodeURIComponent(error.message))
  }

  revalidatePath('/archive')
  revalidatePath('/admin')
  redirect('/admin?ok=answered')
}

/**
 * Admin action — reject/hide a question (spam, low quality, etc.)
 */
export async function rejectQuestion(formData: FormData) {
  const c = await cookies()
  if (c.get('admin')?.value !== process.env.ADMIN_PASSWORD) {
    redirect('/admin')
  }

  const id = String(formData.get('id') ?? '')
  const { error } = await adminClient
    .from('questions')
    .update({ status: 'rejected' })
    .eq('id', id)

  if (error) {
    redirect('/admin?error=' + encodeURIComponent(error.message))
  }

  revalidatePath('/admin')
  redirect('/admin?ok=rejected')
}
