export default function Footer() {
  return (
    <footer className="relative z-20 border-t border-line mt-20">
      <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="text-ash text-sm">
          <span className="serif italic">Nulla dies sine cafe.</span> — no day without coffee.
        </div>
        <div className="text-ash text-xs">
          © {new Date().getFullYear()} The Coffee Society. A slow reading room.
        </div>
      </div>
    </footer>
  )
}
