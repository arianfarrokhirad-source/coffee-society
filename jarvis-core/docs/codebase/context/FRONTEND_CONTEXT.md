<!--
Type: manual
Canonical for: nothing — apps/command-center is canonical
Update when: routes, data-access patterns or client/server boundaries change
Owner: PRIME
Budget: Tiny (~150 lines)
-->

# Frontend context

Load for: pages, server actions, components, API routes in
`apps/command-center`. Next.js 15 App Router + React 19 + Tailwind 3.

## The one rule that matters

**Pages and server actions use the session-bound anon client — the database
enforces access via RLS.** Only the orchestrator path uses the service role,
and only behind application-level permission checks.

```ts
createUserClient() // lib/supabase/server.ts — RLS applies. Default choice.
getStore() // lib/jarvis.ts — service role, RLS bypassed. Requires
// a permission check first. Server-only.
```

If you reach for `getStore()` in a page, you are almost certainly wrong.

## Routes

Pages (all `force-dynamic`, no caching strategy yet): `/login`, `/` (→
`/executive`), `/executive`, `/businesses`, `/businesses/[businessId]`,
`/objectives`, `/projects`, `/tasks`, `/approvals`, `/decisions`, `/agents`,
`/knowledge`, `/reports`, `/settings`, `/jarvis`.

API: `POST /api/jarvis/chat` (auth → membership → rate limit → Zod →
orchestrator) · `POST /api/cron/daily-brief` (constant-time bearer, idempotent).

`middleware.ts` gates everything except `/login` and the cron route.

## Client components — the complete list

`app/login/page.tsx`, `components/{ChatUI,forms,TaskStatusButtons,
ApprovalActions,GenerateBriefButton,ClaimPrimeBanner}.tsx`. Everything else is
a server component. **No client component may import from `lib/jarvis.ts`,
`@jarvis/database` clients, or anything server-only** — the `server-only`
import makes this a build error, which is the intended guardrail.

## Server actions

`app/actions/{auth,work,approvals,brief}.ts`. Pattern: membership check → Zod
parse → RLS-scoped write → audit → system event (where applicable) →
`revalidatePath`. Approval resolution is PRIME-checked in the action **and**
by RLS policy.

## Conventions

- Honest empty states. Never render placeholder or invented data — the
  Executive "Revenue" card explicitly says no financial metrics are connected.
- Errors shown to users are generic (`toSafeError` / `GENERIC_CLAIM_ERROR`);
  detail goes to server logs and audit.
- Secrets never enter React state, URLs, query params or storage. The setup
  token input is `type="password"` with autocomplete suppressed and is read
  only from `FormData` inside the action.
- Shared UI primitives (`Card`, `Badge`, `EmptyState`, `StatTile`) come from
  `@jarvis/ui`; they are server-component safe.
- Untyped Supabase joins currently require casts like
  `(x.businesses as { code?: string } | null)` — removed by codegen in commit 7.

## Known issues

No pagination on tasks (150 rows) or approvals · every navigation costs a
middleware `auth.getUser()` plus 5–8 uncached queries · `getBusinessSummary`
is 5 round trips · a chat message is ~15–20 sequential Supabase round trips
(commit 12 batching) · `forms.tsx` holds four near-identical components ·
no browser/E2E coverage exists yet.

## Tests

`apps/command-center/tests/{cron-auth,prime-claim}.test.ts` — pure logic only.
Server actions and pages have **no direct tests**; their risky logic is
dual-enforced by tested layers (permissions package + RLS). Verify UI changes
with `npm run build` and a manual pass.
