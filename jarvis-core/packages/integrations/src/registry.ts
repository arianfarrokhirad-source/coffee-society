import { z } from 'zod'
import { createDisabledAdapter, type IntegrationAdapter } from './adapter'

// Phase 1 registry: every adapter present, every adapter disabled.
// Enabling one requires credentials + a successful connection test +
// PRIME approval (integration.connect is an always-approval action).

export const integrations: Record<string, IntegrationAdapter> = {
  composio: createDisabledAdapter({
    name: 'composio',
    allowedActions: ['list_tools', 'execute_tool'],
    prohibitedActions: ['manage_billing'],
    configSchema: z.object({ apiKey: z.string().min(1) }),
  }),
  firecrawl: createDisabledAdapter({
    name: 'firecrawl',
    allowedActions: ['scrape_url', 'crawl_site'],
    prohibitedActions: ['submit_forms'],
    configSchema: z.object({ apiKey: z.string().min(1) }),
  }),
  relay: createDisabledAdapter({
    name: 'relay',
    allowedActions: ['trigger_workflow', 'get_workflow_status'],
    configSchema: z.object({ apiKey: z.string().min(1) }),
  }),
  manus: createDisabledAdapter({
    name: 'manus',
    allowedActions: ['create_session', 'get_session_result'],
    configSchema: z.object({ apiKey: z.string().min(1) }),
  }),
  hedra: createDisabledAdapter({
    name: 'hedra',
    allowedActions: ['generate_media', 'get_generation_status'],
    prohibitedActions: ['publish_media'],
    configSchema: z.object({ apiKey: z.string().min(1) }),
  }),
  lindy: createDisabledAdapter({
    name: 'lindy',
    allowedActions: ['trigger_agent', 'get_agent_status'],
    prohibitedActions: ['send_messages'],
    configSchema: z.object({ apiKey: z.string().min(1) }),
  }),
  obsidian: createDisabledAdapter({
    name: 'obsidian',
    allowedActions: ['sync_notes', 'read_note'],
    prohibitedActions: ['delete_vault'],
    configSchema: z.object({ vaultPath: z.string().min(1), syncToken: z.string().min(1) }),
  }),
}

export function listIntegrations(): {
  name: string
  status: string
  allowedActions: readonly string[]
}[] {
  return Object.values(integrations).map((a) => ({
    name: a.name,
    status: a.status(),
    allowedActions: a.allowedActions,
  }))
}
