# Adding an integration

All external services go through `@jarvis/integrations` adapters. Phase 1
ships seven disabled adapters (Composio, Firecrawl, Relay, Manus, Hedra,
Lindy, Obsidian). To bring one to life:

1. **Implement the adapter** against `IntegrationAdapter`
   (`packages/integrations/src/adapter.ts`):
   - `configSchema`: Zod schema of required credentials (validated, never logged)
   - `allowedActions` / `prohibitedActions`: explicit lists; prohibited wins
   - `request()`: validate input, check the allowlist, call the service,
     validate the response shape, return errors as values
   - `verifyWebhook()` where the service sends webhooks — use
     `createHmacSha256Verifier` from `@jarvis/security`
   - audit every side-effect attempt via the store

2. **Credentials** are server-only environment variables. Document them in
   `.env.example` (placeholder only).

3. **Status honesty**: `status()` must return `configured_untested` until a
   real connection test has passed. **Never claim an integration works
   without valid credentials and a successful test.**

4. **Gate activation**: `integration.connect` is an always-approval action —
   surface enabling the adapter as an approval request for PRIME.

5. **Test**: unit tests with a mocked `fetch`; extend
   `packages/integrations/tests/integrations.test.ts`.

6. Update `/settings` expectations if the adapter exposes new actions.

External side effects through an adapter remain subject to the same approval
policy as everything else — an adapter existing does not authorize its use.
