import ChatUI from '@/components/ChatUI'

export const dynamic = 'force-dynamic'

export default function JarvisPage() {
  return (
    <div className="mx-auto flex h-[calc(100vh-3rem)] max-w-3xl flex-col">
      <header className="mb-4">
        <h1 className="text-xl font-bold text-white">JARVIS</h1>
        <p className="text-sm text-muted">
          Routed through JVS-00. Restricted actions become approval requests — nothing external
          executes without PRIME.
        </p>
      </header>
      <ChatUI />
    </div>
  )
}
