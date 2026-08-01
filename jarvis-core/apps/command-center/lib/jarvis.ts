import 'server-only'
import {
  createRouter,
  createAnthropicProvider,
  createOpenAIProvider,
  type AIRouter,
} from '@jarvis/ai'
import { createServiceClient, createSupabaseStore, type JarvisStore } from '@jarvis/database'
import { createInMemoryRateLimiter, type RateLimiter } from '@jarvis/security'

// Server-side singletons for the orchestrator path. The service-role
// store is used ONLY after application-level permission checks; the
// import of 'server-only' guarantees none of this reaches the browser.

let store: JarvisStore | null = null
let router: AIRouter | null = null
let limiter: RateLimiter | null = null

export function getStore(): JarvisStore {
  if (!store) store = createSupabaseStore(createServiceClient())
  return store
}

export function getRouter(): AIRouter | null {
  if (!router) {
    const providers = [createAnthropicProvider(), createOpenAIProvider()].filter((p) =>
      p.isConfigured()
    )
    router = providers.length > 0 ? createRouter(providers) : null
  }
  return router
}

export function getRateLimiter(): RateLimiter {
  if (!limiter) limiter = createInMemoryRateLimiter({ windowMs: 60_000, maxRequests: 30 })
  return limiter
}

export function providerStatus(): { anthropic: boolean; openai: boolean } {
  return {
    anthropic: (process.env.ANTHROPIC_API_KEY ?? '').length > 0,
    openai: (process.env.OPENAI_API_KEY ?? '').length > 0,
  }
}
