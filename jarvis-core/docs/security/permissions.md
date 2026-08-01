# Permissions

## Authority levels

| Level | Meaning                                     |
| ----- | ------------------------------------------- |
| L0    | Observe only                                |
| L1    | Draft and recommend (default for AI agents) |
| L2    | Modify authorized internal records          |
| L3    | Execute approved low-risk external actions  |
| L4    | Requires PRIME approval                     |
| L5    | PRIME only                                  |

Comparison lives in `@jarvis/permissions/authority.ts`; `meetsAuthority()` is
inclusive (`L2` meets `L2`).

## Roles

`prime` (L5, org-wide), `executive` (L3, org-wide), `business_manager` (L2),
`employee` (L1), `contractor` (L1), `client` (L0 — **no internal access in
Phase 1**), `agent` (identity for AI agents; never used for browser sessions).
Role → permission grants are seeded in `supabase/seed/seed.sql`.

## Action policy (application layer)

`ACTION_POLICIES` in `@jarvis/permissions/policy.ts` maps every action type to
`{minAuthority, external, alwaysApproval, risk}`. Highlights:

- `task.create` L1 · `task.update`/`project.create`/`decision.record` L2
- `approval.resolve` L5
- `external.execute`, `client.message`, `public.publish`, `finance.execute`,
  `integration.connect`, `permission.change` → **always approval**, regardless
  of authority
- Unknown action → L5 + always approval (deny by default)

`checkApproval()` additionally forces an approval whenever estimated cost
exceeds the actor's financial authority (0 for every Phase 1 agent).
**Restricted requests become approval records, never silent executions.**

## Agent scope (application layer)

`canAgentAct()` enforces per-agent: active flag, business scope (business
agents cannot touch other businesses; JVS-00 is org-level), allowlist, and
denylist (denylist wins even over the allowlist). Agents never inherit user
permissions; when the orchestrator delegates work to an agent, the acting
authority is the agent's own.

## Row Level Security (database layer)

Helper functions (`is_prime`, `has_business_access`, `has_org_wide_access`,
`can_access_scoped`) drive the policies in `0007_rls.sql`:

- PRIME: full org access; sole write access to businesses, memberships,
  agents; sole resolver of approvals; sole reader of audit logs, briefs,
  model usage and system events
- Business-scoped roles: only their businesses; `client` is excluded from
  `has_business_access` entirely
- Run/log/brief/event tables: read-only for scoped members, written only by
  the server (no client INSERT/UPDATE/DELETE policies exist)
- `restricted` documents: PRIME only
- `audit_logs`: append-only for **everyone**, including the service role

## Adding a permission

1. Add the action type to `ACTION_POLICIES` with the correct minimum
   authority/risk (and to the `permissions` seed if users need it granted).
2. If a tool exposes it, set the tool's `policyAction` and `agentAction`.
3. Add a test in `packages/permissions/tests/policy.test.ts`.
4. If the action needs new table access, extend RLS policies in a new
   migration — never widen an existing policy casually.
