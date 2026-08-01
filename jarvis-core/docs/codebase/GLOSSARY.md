<!--
Type: manual
Canonical for: nothing — codes are canonical in supabase/seed/seed.sql
Update when: a code, level or term is added or its meaning changes
Owner: PRIME
-->

# Glossary

A lookup table. **Grep this file for a term; do not read it end to end.**

## Identity

| Term            | Meaning                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Farrokhirad** | The company/product name. Vercel project, domains, anything operator-facing.                                                            |
| **JARVIS**      | The internal operating system. Packages (`@jarvis/*`), env vars (`JARVIS_*`), agents, database objects. Never rebranded.                |
| **JEKS**        | JARVIS Engineering Knowledge System — this documentation system (`docs/codebase/`).                                                     |
| **PRIME**       | The founder. Highest authority (L5), org-wide access, sole resolver of approvals. One per organization, claimed once via setup token.   |
| **Kernel**      | Conceptual architectural centre (policy, identity, data access, audit, events, AI capability). **Not a package** — see `SYSTEM_MAP.md`. |
| **Extension**   | Replaceable component registering against the kernel: business domain, integration adapter, notification channel, approval executor.    |

## Businesses (`A00`–`A08`)

| Code | Name    | Domain                                                                       |
| ---- | ------- | ---------------------------------------------------------------------------- |
| A00  | ATLAS   | Holding company, executive command, shared services                          |
| A01  | FORGE   | Websites for small businesses — **the pilot business**                       |
| A02  | SIGNAL  | Marketing, internal and external clients                                     |
| A03  | VECTOR  | Business development, consulting, business plans                             |
| A04  | ORACLE  | Accounting, CFO support, treasury, forecasting, investment **research only** |
| A05  | TEMPO   | Luxury fashion brand                                                         |
| A06  | ECHO    | Music and entertainment                                                      |
| A07  | ACADEMY | Teaching and education platform                                              |
| A08  | VOID    | Reserved — **dormant**, `agents_enabled = false`                             |

## Agents

| Code            | Role                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| **JVS-00**      | JARVIS Core Orchestrator — classifies, routes, selects agent and model. Org-level, no business scope. |
| A00-GM … A07-AD | One per business (`A04-CFO` ORACLE, `A05-CD` TEMPO, `A06-LD` ECHO, `A07-AD` ACADEMY; the rest `-GM`). |
| A08-RSV         | VOID reserved agent — **inactive**, authority L0.                                                     |

Every agent defaults to **L1** and **zero financial authority**. Agents never
inherit user permissions.

## Authority levels

| Level | Meaning                                         |
| ----- | ----------------------------------------------- |
| L0    | Observe only                                    |
| L1    | Draft and recommend — **default for AI agents** |
| L2    | Modify authorized internal records              |
| L3    | Execute approved low-risk external actions      |
| L4    | Requires PRIME approval                         |
| L5    | PRIME only                                      |

`meetsAuthority(actual, required)` is **inclusive** — L2 meets L2.

## Roles

`prime` (L5, org-wide) · `executive` (L3, org-wide) · `business_manager` (L2) ·
`employee` (L1) · `contractor` (L1) · `client` (L0 — **excluded from all
internal data by RLS**) · `agent` (server-mediated identity only).

## AI capabilities

Capabilities, not vendors. Providers are interchangeable implementations.

| Capability                         | Route kind   | Model env var             | Current primary |
| ---------------------------------- | ------------ | ------------------------- | --------------- |
| Long-context analysis              | `document`   | `JARVIS_MODEL_DOCUMENT`   | Anthropic       |
| Policy / second-opinion review     | `review`     | `JARVIS_MODEL_REVIEW`     | Anthropic       |
| Executive reasoning                | `executive`  | `JARVIS_MODEL_EXECUTIVE`  | OpenAI          |
| Structured extraction (economical) | `extraction` | `JARVIS_MODEL_EXTRACTION` | OpenAI          |

No model name is hard-coded. An unset env var makes that capability
unavailable; the router falls back cross-provider or degrades to deterministic
output rather than inventing an answer.

## Operational terms

| Term                      | Meaning                                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Approval**              | A record created when a restricted, over-authority or costly action is requested. PRIME-only resolution. **No executors exist** — approving records a decision, nothing runs.                |
| **Action type**           | String key (`task.create`, `external.execute`, …) mapped to `{minAuthority, external, alwaysApproval, risk}`. Unknown ⇒ L5 + always-approval (deny by default).                              |
| **Critical audit**        | Audit row committed in the same transaction as its state change, so the change cannot exist unaudited. Currently only the PRIME claim.                                                       |
| **Telemetry audit**       | Best-effort audit (tool calls, run summaries). Failure is logged, operation proceeds.                                                                                                        |
| **Append-only**           | `audit_logs` blocks UPDATE/DELETE by trigger for all roles including `service_role`. **Not tamper-proof** (an owner can drop the trigger) and **not yet tamper-evident** (no hash chaining). |
| **Deterministic command** | A chat command handled by rules with no model call — works with zero AI keys.                                                                                                                |
| **Nonce (PRIME claim)**   | Single-use, user-bound, 2-minute proof minted server-side after setup-token validation. Only its SHA-256 hash is stored.                                                                     |
| **P0–P3**                 | Notification priority: P0 emergency · P1 same-day · P2 daily operational · P3 weekly strategy.                                                                                               |
