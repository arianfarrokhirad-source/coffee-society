import type { ReactNode } from 'react'

// Minimal server-component-friendly primitives shared by the Command
// Centre. Styling relies on the app's Tailwind theme tokens.

export function Card({
  title,
  children,
  action,
}: {
  title?: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="rounded-lg border border-edge bg-panel p-4">
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between">
          {title && (
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{title}</h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

const badgeTones: Record<string, string> = {
  ok: 'bg-ok/15 text-ok',
  warn: 'bg-warn/15 text-warn',
  danger: 'bg-danger/15 text-danger',
  info: 'bg-accent/15 text-accent',
  muted: 'bg-edge text-muted',
  gold: 'bg-gold/15 text-gold',
}

export function Badge({
  tone = 'muted',
  children,
}: {
  tone?: keyof typeof badgeTones
  children: ReactNode
}) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${badgeTones[tone] ?? badgeTones.muted}`}
    >
      {children}
    </span>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded border border-dashed border-edge p-6 text-center">
      <p className="text-sm text-muted">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted/70">{hint}</p>}
    </div>
  )
}

export function StatTile({
  label,
  value,
  tone = 'info',
}: {
  label: string
  value: string | number
  tone?: keyof typeof badgeTones
}) {
  return (
    <div className="rounded-lg border border-edge bg-panel p-4">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-white'}`}
      >
        {value}
      </p>
    </div>
  )
}
