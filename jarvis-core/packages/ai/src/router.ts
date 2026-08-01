import type { AIProviderName } from '@jarvis/shared'
import { err, ok, type Result } from '@jarvis/shared'
import type { AIProvider, AIRequest, AIResponse, ModelRoute, RouteKind } from './types'

// ---------------------------------------------------------------------
// Routing policy (section 15):
//   - Long document review        → Anthropic   (JARVIS_MODEL_DOCUMENT)
//   - SOP / policy analysis,
//     second-model review         → Anthropic   (JARVIS_MODEL_REVIEW)
//   - Executive / operational     → OpenAI      (JARVIS_MODEL_EXECUTIVE)
//   - Structured extraction       → economical  (JARVIS_MODEL_EXTRACTION)
// Model names come exclusively from environment variables — nothing is
// hard-coded. When the primary provider is unavailable the router falls
// back to the other provider (with that provider's configured model for
// the closest route) and reports which provider actually answered.
// ---------------------------------------------------------------------

export interface RouterEnv {
  executiveModel?: string
  documentModel?: string
  extractionModel?: string
  reviewModel?: string
}

export function readRouterEnv(): RouterEnv {
  return {
    executiveModel: process.env.JARVIS_MODEL_EXECUTIVE,
    documentModel: process.env.JARVIS_MODEL_DOCUMENT,
    extractionModel: process.env.JARVIS_MODEL_EXTRACTION,
    reviewModel: process.env.JARVIS_MODEL_REVIEW,
  }
}

const ROUTE_PROVIDER: Record<RouteKind, AIProviderName> = {
  executive: 'openai',
  document: 'anthropic',
  extraction: 'openai',
  review: 'anthropic',
}

function modelFor(kind: RouteKind, env: RouterEnv): string | undefined {
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

// Cross-provider fallback model: prefer the fallback provider's most
// general configured model (executive for openai, document for anthropic).
function fallbackModelFor(provider: AIProviderName, env: RouterEnv): string | undefined {
  return provider === 'openai'
    ? (env.executiveModel ?? env.extractionModel)
    : (env.documentModel ?? env.reviewModel)
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

  function resolveRoute(kind: RouteKind): Result<ModelRoute> {
    const primaryName = ROUTE_PROVIDER[kind]
    const fallbackName: AIProviderName = primaryName === 'openai' ? 'anthropic' : 'openai'
    const primary = byName.get(primaryName)
    const fallback = byName.get(fallbackName)
    const primaryModel = modelFor(kind, routerEnv)
    const fallbackModel = fallbackModelFor(fallbackName, routerEnv)

    const primaryUsable = !!primary?.isConfigured() && !!primaryModel
    const fallbackUsable = !!fallback?.isConfigured() && !!fallbackModel

    if (primaryUsable) {
      return ok({
        kind,
        provider: primaryName,
        model: primaryModel,
        fallback: fallbackUsable ? { provider: fallbackName, model: fallbackModel } : null,
      })
    }
    if (fallbackUsable) {
      return ok({ kind, provider: fallbackName, model: fallbackModel, fallback: null })
    }
    return err(
      `No AI provider available for route '${kind}'. Configure API keys and JARVIS_MODEL_* variables.`
    )
  }

  async function complete(
    kind: RouteKind,
    request: Omit<AIRequest, 'model'>
  ): Promise<Result<AIResponse>> {
    const route = resolveRoute(kind)
    if (!route.ok) return route

    const primary = byName.get(route.value.provider)
    if (!primary) return err(`Provider ${route.value.provider} not registered`)

    try {
      return ok(await primary.complete({ ...request, model: route.value.model }))
    } catch (primaryError) {
      const fb = route.value.fallback
      if (!fb) {
        return err(
          `Provider ${route.value.provider} failed and no fallback is configured: ${
            primaryError instanceof Error ? primaryError.message : 'unknown error'
          }`
        )
      }
      const fallbackProvider = byName.get(fb.provider)
      if (!fallbackProvider) return err(`Fallback provider ${fb.provider} not registered`)
      try {
        return ok(await fallbackProvider.complete({ ...request, model: fb.model }))
      } catch (fallbackError) {
        return err(
          `Both providers failed. ${route.value.provider}: ${
            primaryError instanceof Error ? primaryError.message : 'unknown'
          }; ${fb.provider}: ${fallbackError instanceof Error ? fallbackError.message : 'unknown'}`
        )
      }
    }
  }

  return {
    resolveRoute,
    complete,
    availableProviders: () => providers.filter((p) => p.isConfigured()).map((p) => p.name),
  }
}
