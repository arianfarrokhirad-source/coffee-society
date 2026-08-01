import { z } from 'zod'
import type { Result } from '@jarvis/shared'
import { err, ok } from '@jarvis/shared'

// ---------------------------------------------------------------------
// External integration adapter contract (section 25). Every adapter is
// disabled by default and returns honest 'not connected' errors until
// real credentials are configured AND a connection test has passed.
// Nothing here claims a third-party integration works.
// ---------------------------------------------------------------------

export type AdapterStatus = 'disabled' | 'configured_untested' | 'connected' | 'error'

export interface AdapterRequest {
  action: string
  payload: Record<string, unknown>
  requestId: string
}

export interface AdapterResponse {
  ok: boolean
  data?: unknown
  error?: string
}

export interface IntegrationAdapter {
  /** Stable identifier, e.g. 'composio'. */
  readonly name: string
  /** Zod schema describing required configuration (validated, never logged). */
  readonly configSchema: z.ZodTypeAny
  readonly allowedActions: readonly string[]
  readonly prohibitedActions: readonly string[]
  status(): AdapterStatus
  /**
   * Execute an allowed action. Implementations must validate input,
   * verify the action is allowed, and surface errors as values.
   */
  request(request: AdapterRequest): Promise<Result<AdapterResponse>>
  /** Verify an inbound webhook signature (when the service supports webhooks). */
  verifyWebhook?(payload: string, signatureHeader: string): boolean
}

export interface MockAdapterOptions {
  name: string
  allowedActions: readonly string[]
  prohibitedActions?: readonly string[]
  configSchema?: z.ZodTypeAny
}

/**
 * Disabled placeholder adapter. Used for every integration in Phase 1.
 * All requests fail loudly with a clear reason; nothing silently no-ops.
 */
export function createDisabledAdapter(options: MockAdapterOptions): IntegrationAdapter {
  return {
    name: options.name,
    configSchema: options.configSchema ?? z.object({ apiKey: z.string().min(1) }),
    allowedActions: options.allowedActions,
    prohibitedActions: options.prohibitedActions ?? [],
    status: () => 'disabled',
    async request(request: AdapterRequest): Promise<Result<AdapterResponse>> {
      if (!options.allowedActions.includes(request.action)) {
        return err(`Action '${request.action}' is not allowed for integration '${options.name}'`)
      }
      return ok({
        ok: false,
        error: `Integration '${options.name}' is not connected. Configure credentials and run its connection test before use.`,
      })
    },
  }
}
