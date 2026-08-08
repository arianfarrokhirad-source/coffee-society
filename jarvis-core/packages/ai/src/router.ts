import { AI_PROVIDERS, type AIProviderName } from '@jarvis/shared'
import { err, ok, type Result } from '@jarvis/shared'
import type { AIProvider, AIRequest, AIResponse, ModelRoute, RouteKind } from './types'

// ---------------------------------------------------------------------
// Provider-agnostic routing.
//
// Adding a provider means implementing the AIProvider interface and
// naming it in ROUTE_PREFERENCE — no structural change. The router holds
// no provider-specific logic beyond those ordered preference lists.
//
// Two orderings live here and they are deliberately separate:
//
//   ROUTE_PREFERENCE — the order providers are actually tried. This is
//     the routing policy and it is what changes when a new provider is
//     better at something.
//
//   LEGACY_ROUTE_ANCHOR — which provider the route-scoped
//     JARVIS_MODEL_<KIND> variables belong to. This exists so that
//     changing a preference order can never silently hand one vendor's
//     model name to another vendor. A model string is not portable
//     across providers; treating it as portable is how a routing change
//     turns into a 404 from an API.
//
// Model names come exclusively from the environment. Nothing is
// hard-coded, and no provider is hard-coded as the default.
// ---------------------------------------------------------------------

/** Per-provider model configuration, most specific wins. */
export interface ProviderModelConfig {
  /** Used for any route this provider has no specific model for. */
  default?: string
  executive?: string
  document?: string
  extraction?: string
  review?: string
}

export interface RouterEnv {
  // Route-scoped legacy variables. Retained because they are already
  // deployed; they apply only to that route's anchor provider.
  executiveModel?: string
  documentModel?: string
  extractionModel?: string
  reviewModel?: string
  /** Per-provider models — the mechanism new providers use. */
  providerModels?: Partial<Record<AIProviderName, ProviderModelConfig>>
}

const ROUTE_KINDS: readonly RouteKind[] = ['executive', 'document', 'extraction', 'review']

/**
 * Ordered candidates per route. First configured provider with a
 * resolvable model wins; the rest become the fallback chain.
 *
 * Extraction leads with Gemini because bulk, high-volume extraction is
 * what it is cheapest at — but it degrades to OpenAI and then Anthropic
 * rather than failing when Gemini is absent.
 */
const ROUTE_PREFERENCE: Record<RouteKind, readonly AIProviderName[]> = {
  executive: ['openai', 'anthropic', 'gemini'],
  document: ['anthropic', 'gemini', 'openai'],
  extraction: ['gemini', 'openai', 'anthropic'],
  review: ['anthropic', 'openai', 'gemini'],
}

/** Which provider owns each route-scoped legacy model variable. */
const LEGACY_ROUTE_ANCHOR: Record<RouteKind, AIProviderName> = {
  executive: 'openai',
  document: 'anthropic',
  extraction: 'openai',
  review: 'anthropic',
}

/**
 * Legacy per-provider default, derived from the route variables that
 * provider anchors. Only the two providers that predate per-provider
 * configuration get one — a new provider must be configured explicitly
 * rather than inheriting a model name that belongs to another vendor.
 */
function legacyProviderDefault(provider: AIProviderName, env: RouterEnv): string | undefined {
  if (provider === 'openai') return env.executiveModel ?? env.extractionModel
  if (provider === 'anthropic') return env.documentModel ?? env.reviewModel
  return undefined
}

function legacyRouteModel(kind: RouteKind, env: RouterEnv): string | undefined {
  switch (kind) {
    case 'executive':
      return env.executiveModel
    case 'document':
      return env.documentModel
    case 'extraction':
      return env.extractionModel
    case 'review':
      return env.reviewModel
  }
}

/** Most specific configured model for a (provider, route) pair. */
export function modelFor(
  provider: AIProviderName,
  kind: RouteKind,
  env: RouterEnv
): string | undefined {
  const configured = env.providerModels?.[provider]
  return (
    configured?.[kind] ??
    configured?.default ??
    (LEGACY_ROUTE_ANCHOR[kind] === provider ? legacyRouteModel(kind, env) : undefined) ??
    legacyProviderDefault(provider, env)
  )
}

const ENV_KIND_SUFFIX: Record<RouteKind, string> = {
  executive: 'EXECUTIVE',
  document: 'DOCUMENT',
  extraction: 'EXTRACTION',
  review: 'REVIEW',
}

/**
 * Reads JARVIS_MODEL_<KIND> (legacy) plus, for every known provider,
 * JARVIS_MODEL_<PROVIDER> and JARVIS_MODEL_<PROVIDER>_<KIND>.
 */
export function readRouterEnv(): RouterEnv {
  const providerModels: Partial<Record<AIProviderName, ProviderModelConfig>> = {}

  for (const provider of AI_PROVIDERS) {
    const prefix = `JARVIS_MODEL_${provider.toUpperCase()}`
    const config: ProviderModelConfig = {}
    const fallback = process.env[prefix]
    if (fallback) config.default = fallback
    for (const kind of ROUTE_KINDS) {
      const specific = process.env[`${prefix}_${ENV_KIND_SUFFIX[kind]}`]
      if (specific) config[kind] = specific
    }
    if (Object.keys(config).length > 0) providerModels[provider] = config
  }

  return {
    executiveModel: process.env.JARVIS_MODEL_EXECUTIVE,
    documentModel: process.env.JARVIS_MODEL_DOCUMENT,
    extractionModel: process.env.JARVIS_MODEL_EXTRACTION,
    reviewModel: process.env.JARVIS_MODEL_REVIEW,
    ...(Object.keys(providerModels).length > 0 ? { providerModels } : {}),
  }
}

export interface AIRouter {
  resolveRoute(kind: RouteKind): Result<ModelRoute>
  complete(kind: RouteKind, request: Omit<AIRequest, 'model'>): Promise<Result<AIResponse>>
  /** Names of providers with credentials configured. */
  availableProviders(): AIProviderName[]
}

export function createRouter(providers: AIProvider[], env?: RouterEnv): AIRouter {
  const byName = new Map<AIProviderName, AIProvider>(providers.map((p) => [p.name, p]))
  const routerEnv = env ?? readRouterEnv()

  /** Every registered, configured provider with a model, in preference order. */
  function usableChain(kind: RouteKind): { provider: AIProviderName; model: string }[] {
    const chain: { provider: AIProviderName; model: string }[] = []
    for (const name of ROUTE_PREFERENCE[kind]) {
      const provider = byName.get(name)
      if (!provider?.isConfigured()) continue
      const model = modelFor(name, kind, routerEnv)
      if (!model) continue
      chain.push({ provider: name, model })
    }
    return chain
  }

  function resolveRoute(kind: RouteKind): Result<ModelRoute> {
    const chain = usableChain(kind)
    const primary = chain[0]
    if (!primary) {
      return err(
        `No AI provider available for route '${kind}'. Configure API keys and JARVIS_MODEL_* variables.`
      )
    }
    return ok({
      kind,
      provider: primary.provider,
      model: primary.model,
      fallback: chain[1] ?? null,
      chain,
    })
  }

  async function complete(
    kind: RouteKind,
    request: Omit<AIRequest, 'model'>
  ): Promise<Result<AIResponse>> {
    const route = resolveRoute(kind)
    if (!route.ok) return route

    const failures: string[] = []
    for (const candidate of route.value.chain) {
      const provider = byName.get(candidate.provider)
      if (!provider) continue
      try {
        return ok(await provider.complete({ ...request, model: candidate.model }))
      } catch (cause) {
        failures.push(
          `${candidate.provider}: ${cause instanceof Error ? cause.message : 'unknown error'}`
        )
      }
    }

    // Wording is provider-count agnostic: this router is no longer
    // limited to two providers, so "both" would become wrong the moment
    // a third is registered.
    return err(`All providers failed for route '${kind}'. ${failures.join('; ')}`)
  }

  return {
    resolveRoute,
    complete,
    availableProviders: () => providers.filter((p) => p.isConfigured()).map((p) => p.name),
  }
}
