import Link from 'next/link'
import { getAuthContext } from '@/lib/auth'
import { signOut } from '@/app/actions/auth'

const links = [
  ['/executive', 'Executive'],
  ['/businesses', 'Businesses'],
  ['/clients', 'Clients'],
  ['/audits', 'Audits'],
  ['/proposals', 'Proposals'],
  ['/delivery', 'Delivery'],
  ['/maintenance', 'Maintenance'],
  ['/objectives', 'Objectives'],
  ['/projects', 'Projects'],
  ['/tasks', 'Tasks'],
  ['/approvals', 'Approvals'],
  ['/decisions', 'Decisions'],
  ['/agents', 'Agents'],
  ['/knowledge', 'Knowledge'],
  ['/reports', 'Reports'],
  ['/jarvis', 'JARVIS'],
  ['/settings', 'Settings'],
] as const

export default async function Nav() {
  const auth = await getAuthContext()
  if (!auth) return null
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-edge bg-panel">
      <div className="border-b border-edge p-4">
        <p className="text-lg font-bold tracking-widest text-white">JARVIS</p>
        <p className="text-xs text-muted">
          {auth.isPrime ? 'PRIME' : (auth.displayName ?? auth.email ?? 'Member')} · {auth.authority}
        </p>
      </div>
      <nav className="flex-1 space-y-0.5 p-2">
        {links.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            className="block rounded px-3 py-1.5 text-sm text-gray-300 hover:bg-edge hover:text-white"
          >
            {label}
          </Link>
        ))}
      </nav>
      <form action={signOut} className="border-t border-edge p-3">
        <button className="text-xs text-muted hover:text-white">Sign out</button>
      </form>
    </aside>
  )
}
