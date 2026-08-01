'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'

const BUSINESSES = [
  ['auto', 'Auto-route'],
  ['A00', 'A00 ATLAS'],
  ['A01', 'A01 FORGE'],
  ['A02', 'A02 SIGNAL'],
  ['A03', 'A03 VECTOR'],
  ['A04', 'A04 ORACLE'],
  ['A05', 'A05 TEMPO'],
  ['A06', 'A06 ECHO'],
  ['A07', 'A07 ACADEMY'],
  ['A08', 'A08 VOID'],
] as const

interface ChatReply {
  runId: string | null
  businessCode: string | null
  agentCode: string
  provider: 'anthropic' | 'openai' | 'none'
  model: string | null
  intent: string
  text: string
  approvalId: string | null
  error?: string
}

interface ChatEntry {
  role: 'user' | 'jarvis'
  text: string
  meta?: ChatReply
}

const SUGGESTIONS = [
  'Show my pending approvals.',
  'Review A01 performance.',
  'Create a task for FORGE to prepare a dental clinic proposal.',
  'Compare current project risks across all active businesses.',
  "Generate today's PRIME brief.",
]

export default function ChatUI() {
  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [input, setInput] = useState('')
  const [business, setBusiness] = useState<string>('auto')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  async function send(message: string) {
    if (!message.trim() || busy) return
    setBusy(true)
    setInput('')
    setEntries((prev) => [...prev, { role: 'user', text: message }])
    try {
      const response = await fetch('/api/jarvis/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, business }),
      })
      const data = (await response.json()) as ChatReply & { error?: string }
      setEntries((prev) => [
        ...prev,
        {
          role: 'jarvis',
          text: data.error ?? data.text ?? 'No response.',
          meta: data.error ? undefined : data,
        },
      ])
    } catch {
      setEntries((prev) => [
        ...prev,
        { role: 'jarvis', text: 'Request failed. Check your connection and try again.' },
      ])
    } finally {
      setBusy(false)
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
      )
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-edge bg-panel">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {entries.length === 0 && (
          <div className="mt-8 text-center">
            <p className="text-sm text-muted">Try one of these:</p>
            <div className="mx-auto mt-3 flex max-w-md flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded border border-edge px-3 py-2 text-left text-sm text-gray-300 hover:border-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {entries.map((entry, i) => (
          <div key={i} className={entry.role === 'user' ? 'text-right' : ''}>
            <div
              className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-4 py-2 text-left text-sm ${
                entry.role === 'user' ? 'bg-accent/20 text-white' : 'bg-ink text-gray-200'
              }`}
            >
              {entry.text}
            </div>
            {entry.meta && (
              <p className="mt-1 text-xs text-muted">
                {entry.meta.businessCode ?? 'org'} · {entry.meta.agentCode} · {entry.meta.intent} ·{' '}
                {entry.meta.provider === 'none'
                  ? 'no model (deterministic)'
                  : `${entry.meta.provider} / ${entry.meta.model}`}
                {entry.meta.approvalId && (
                  <>
                    {' · '}
                    <Link href="/approvals" className="text-warn underline">
                      approval required
                    </Link>
                  </>
                )}
                {entry.meta.runId && <> · run {entry.meta.runId.slice(0, 8)}</>}
              </p>
            )}
          </div>
        ))}
        {busy && <p className="text-sm text-muted">JARVIS is working…</p>}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void send(input)
        }}
        className="flex gap-2 border-t border-edge p-3"
      >
        <select value={business} onChange={(e) => setBusiness(e.target.value)} className="w-40">
          {BUSINESSES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask JARVIS…"
          maxLength={4000}
          className="flex-1"
        />
        <button className="btn" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}
