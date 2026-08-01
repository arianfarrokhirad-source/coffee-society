import { describe, expect, it } from 'vitest'
import { integrations, listIntegrations } from '../src/registry'

describe('integration adapters', () => {
  it('registers all seven Phase 1 adapters, all disabled', () => {
    const names = listIntegrations().map((i) => i.name)
    expect(names.sort()).toEqual(
      ['composio', 'firecrawl', 'hedra', 'lindy', 'manus', 'obsidian', 'relay'].sort()
    )
    expect(listIntegrations().every((i) => i.status === 'disabled')).toBe(true)
  })

  it('disabled adapters refuse allowed actions with an honest error', async () => {
    const result = await integrations.firecrawl!.request({
      action: 'scrape_url',
      payload: { url: 'https://example.com' },
      requestId: 'r1',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.ok).toBe(false)
      expect(result.value.error).toContain('not connected')
    }
  })

  it('rejects actions outside the allowlist entirely', async () => {
    const result = await integrations.firecrawl!.request({
      action: 'submit_forms',
      payload: {},
      requestId: 'r2',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('not allowed')
  })
})
