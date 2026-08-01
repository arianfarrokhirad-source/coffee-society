<!--
Type: manual
Canonical for: nothing
Update when: kernel module responsibilities or invariants change
Owner: PRIME
Budget: Tiny (~150 lines)
-->

# Kernel context

Load for: authority/permission logic, orchestration, tool pipeline, store
access, cross-cutting refactors. Pair with `CURRENT_STATE.md`.

## The five things that matter

1. **Application code decides permissions — never the model.** Model output is
   advisory and Zod-validated; the tool pipeline re-derives authority itself.
2. **Deny by default.** Unknown action types map to L5 + always-approval.
   Unknown tools are denied and audited. Agent denylists beat allowlists.
3. **Restricted requests become approval records** — never silent execution,
   never silent failure. There are **no approval executors**; approving records
   a decision and runs nothing.
4. **Acting authority = the agent's own level** when work is delegated to an
   agent (L1 default), and the **user's** level for direct commands
   (`show_approvals`, `generate_brief`). An agent can never borrow PRIME's L5.
5. **Pure policy code must stay I/O-free.** `packages/permissions` imports only
   `@jarvis/shared`. Keep it that way — it is what makes the security-critical
   logic unit-testable.

## Modules

| Path                                      | Role                                           | Notes                                                                            |
| ----------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/permissions/src/authority.ts`   | L0–L5 comparison                               | `meetsAuthority` inclusive                                                       |
| `packages/permissions/src/policy.ts`      | `ACTION_POLICIES`, `checkApproval()`           | unknown ⇒ `UNKNOWN_ACTION_POLICY` (L5, always-approval, critical)                |
| `packages/permissions/src/agent-scope.ts` | `canAgentAct()`                                | inactive → deny; denylist → deny; cross-business → deny; not allowlisted → deny  |
| `packages/workflows/src/tools.ts`         | 10 internal tools + enforcement pipeline       | order: rate limit → exists → Zod → agent scope → policy/approval → execute → log |
| `packages/workflows/src/orchestrator.ts`  | `runJarvis()` — 12-step pipeline               | ~500 lines, intent switch; **split is commit 9**                                 |
| `packages/workflows/src/classifier.ts`    | deterministic rules first, model second        | external-action keywords force approval _before_ any model sees input            |
| `packages/database/src/store.ts`          | `JarvisStore` interface                        | god-interface; **segregation is commit 10**                                      |
| `packages/database/src/store-memory.ts`   | in-memory double                               | mirrors the seed by hand — a known drift risk                                    |
| `packages/shared/src/`                    | codes, authority levels, Zod schemas, `Result` |                                                                                  |

## Invariants to preserve

- `JarvisStore` performs **no authorization**. Callers check first. A new
  `getStore()` / `createServiceClient()` call site without a preceding
  permission check is a defect, not a style question.
- Every tool outcome is recorded in `tool_calls` **and** `audit_logs`,
  including denials.
- The orchestrator creates the `agent_runs` row _before_ work starts, so
  failures are logged too.
- Deterministic commands must keep working with **zero AI keys**.
- `A08` VOID is dormant: the orchestrator refuses work for it.

## Common mistakes

- Adding a tool without setting both `policyAction` (authority) and
  `agentAction` (agent scope) — they are different vocabularies.
- Assuming `Result<T,E>`: `@jarvis/ai` and `@jarvis/shared` return `Result`,
  `@jarvis/database` throws. Two regimes exist today (commit 15).
- Typos in action-type strings compile fine and silently become deny-by-default
  — safe, but invisible. A typed union arrives in commit 5.
- Editing `store-memory.ts` without the matching change to `seed.sql` (or vice
  versa) — three-way definition duplication, resolved in commit 6.

## Tests to run

```bash
npx vitest run packages/permissions packages/workflows
```

`packages/permissions/tests/{authority,policy,agent-scope}.test.ts` ·
`packages/workflows/tests/{classifier,tools,orchestrator}.test.ts`

## Escalate to Standard context if

the change crosses into database schema (`DATABASE_CONTEXT.md`), security
classification (`SECURITY_CONTEXT.md`), or model routing (`AI_CONTEXT.md`),
or touches a boundary listed in `SYSTEM_MAP.md` § Known coupling.
