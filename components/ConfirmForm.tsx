'use client'
import { ReactNode } from 'react'

export default function ConfirmForm({
  action,
  message,
  className,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>
  message: string
  className?: string
  children: ReactNode
}) {
  return (
    <form
      action={action}
      className={className}
      onSubmit={(e) => {
        if (!confirm(message)) e.preventDefault()
      }}
    >
      {children}
    </form>
  )
}
