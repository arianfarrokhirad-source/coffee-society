import 'server-only'
import {
  createRouter,
  createAnthropicProvider,
  createGeminiProvider,
  createOpenAIProvider,
  type AIRouter,
} from '@jarvis/ai'
import { AI_PROVIDERS, type AIProviderName } from '@jarvis/shared'
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
    const providers = [
      createAnthropicProvider(),
      createOpenAIProvider(),
      createGeminiProvider(),
    ].filter((p) => p.isConfigured())
    router = providers.length > 0 ? createRouter(providers) : null
  }
  return router
}

export function getRateLimiter(): RateLimiter {
  if (!limiter) limiter = createInMemoryRateLimiter({ windowMs: 60_000, maxRequests: 30 })
  return limiter
}

/**
 * Credential environment variable per provider.
 *
 * Typed as a total Record over AIProviderName deliberately: adding a
 * provider to AI_PROVIDERS without adding it here is a compile error, not
 * a silent gap. The previous version listed providers by hand and so went
 * stale the moment Gemini was added — the app could not construct it, and
 * a Gemini-only deployment had no router at all.
 */
const PROVIDER_CREDENTIAL_ENV: Record<AIProviderName, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
}

export function providerStatus(): Record<AIProviderName, boolean> {
  const status = {} as Record<AIProviderName, boolean>
  for (const provider of AI_PROVIDERS) {
    status[provider] = (process.env[PROVIDER_CREDENTIAL_ENV[provider]] ?? '').length > 0
  }
  return status
}
