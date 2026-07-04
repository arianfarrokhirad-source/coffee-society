import Link from 'next/link'

export default function Nav() {
  return (
    <header className="relative z-20 border-b border-line">
      <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
        <Link href="/" className="serif text-2xl font-black tracking-tight">
          The Coffee Society
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/" className="text-bone hover:text-blood transition">History</Link>
          <Link href="/archive" className="text-bone hover:text-blood transition">Archive</Link>
          <Link href="/ask" className="px-4 py-2 border border-blood text-blood hover:bg-blood hover:text-bone transition">
            Ask a question
          </Link>
        </nav>
      </div>
    </header>
  )
}
