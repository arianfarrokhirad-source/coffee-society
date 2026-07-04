import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function POST(req: Request) {
  const formData = await req.formData()
  const password = String(formData.get('password') ?? '')

  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.redirect(
      new URL('/admin?error=Wrong+password', req.url)
    )
  }

  const c = await cookies()
  c.set('admin', password, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 1 week
    path: '/',
  })

  return NextResponse.redirect(new URL('/admin', req.url))
}

export async function DELETE() {
  const c = await cookies()
  c.delete('admin')
  return NextResponse.json({ ok: true })
}
