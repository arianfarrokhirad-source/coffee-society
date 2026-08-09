# JARVIS Engineering Review — 399529d → 158b460

**Repository:** arianfarrokhirad-source/coffee-society
**Branch:** `claude/jarvis-phase-1-1-hardening`
**Head:** `158b46029aca1c390cbaa319e9b28be214f7b303` (`158b460`) · working tree clean
**Period:** last checkpoint (`399529d`) to head
**Generated:** 2026-08-08
**Launch target:** 2026-08-28 (20 days)

> Conventions used throughout. **Complete** = shipped and verified. **Partial** = started, not finished. **Planned** = specified, not begun. **Blocked** = cannot proceed in this environment. Percentages are stated against *production-ready*, not against *documented*. Where a figure could not be established from evidence available in this environment it is marked `—` rather than estimated.

---

## 1. Executive summary

### Completed

| Item | Commit | Status |
| --- | --- | --- |
| Continuation packet — 12-section handoff so a fresh session resumes without re-deriving context | `b2349f5` | Complete |
| Multi-model engineering policy recorded, plus an honest note on which parts are not currently enforceable | `fc4480c` | Complete |
| Memory and AI infrastructure design — 852 lines across five documents | `158b460` | Complete |
| Registration wiring investigation — traced the reported failure string to its origin and fix commits | — | Complete |
| ~20 hourly PR check-ins, every one returning no change | — | Wasted effort; see §15 |

### Remaining

- `/register` has never been confirmed working end-to-end on staging — **Blocked** on PRIME retest.
- 14 of 16 Phase 1.1 hardening commits — **Planned**.
- Graphify, Gemini integration, Obsidian vault, Coordinator, Router — **Planned**.
- CRM and website builder — **no code exists for either** — **Planned**.
- PRIME initialization on staging (single-use, irreversible) — **Planned**.

### Overall project health — 35%

Weighted against a working multi-business operating system, not against Phase 1. The foundation is genuinely strong: schema, RLS, permissions, orchestrator, audit trail, and a deployed command centre. But two product surfaces named as launch scope have zero lines of code, the memory layer is specification only, and authentication has not been verified working by anyone.

### Biggest accomplishment

The registration diagnosis. It converted a vague "login is broken" into a commit-level account of when the defect entered, why it produced that specific sentence, and why the deployed code cannot produce it from `/register` — including a falsifiable test: current code appends `(code: …)` or `(status: …)`, so a bare sentence proves the observation came from `/login`, a stale page, or the wrong preview URL.

### Biggest blocker

**Twenty days to the stated launch date, with CRM and website builder at zero and authentication unverified.** The `/register` retest is the immediate blocker; the schedule is the real one. 28 August is not achievable for the full scope — see §11 and §13.

---

## 2. Commits

Three commits since the last checkpoint. All documentation. None touch application code, database schema, migrations, or configuration.

### `b2349f5` — docs: add JARVIS continuation packet

- **Purpose:** context-emergency handoff packet.
- **Files:** `JARVIS_CONTINUATION.md` (+221)
- **Why necessary:** this container is ephemeral. An uncommitted packet is lost when the session is reclaimed, defeating its entire purpose.
- **Risk:** Low — no deployed code path changed.

### `fc4480c` — docs: record PRIME multi-model engineering policy

- **Purpose:** capture a standing governance rule so it survives session boundaries, and record which parts cannot be executed here.
- **Files:** `jarvis-core/docs/codebase/context/ENGINEERING_POLICY.md` (+103); `JARVIS_CONTINUATION.md` (+7/−1)
- **Why necessary:** an unwritten policy is not a policy.
- **Risk:** Low.

### `158b460` — docs: specify JARVIS memory and AI infrastructure

- **Purpose:** the design layer for Phases A–E.
- **Files:** `jarvis-core/docs/MEMORY_ARCHITECTURE.md` (+187), `MODEL_ROUTING.md` (+152), `GRAPHIFY.md` (+174), `GEMINI.md` (+131), `OBSIDIAN.md` (+208)
- **Why necessary:** implementation cannot start — or be delegated to Codex — without a written contract to build against.
- **Risk:** Low.

**Aggregate:** +1,073 / −1 lines, 7 files, **zero source files**. The Vercel build went green for each commit, which confirms nothing about correctness — only that documentation does not break a Next.js build.

---

## 3. Architecture decisions

Eight decisions were made this period. All are design-level and recorded in documents; **none have been implemented**, so all remain reversible. Every one requires PRIME approval before it becomes code.

| Decision | Why | Alternatives considered | Long-term impact | Approval |
| --- | --- | --- | --- | --- |
| Four-layer memory: Graphify / Obsidian / Supabase / Drive | The four jobs have contradictory requirements — RLS-enforced truth, cheap traversal, human-authored reasoning, blobs. No single store serves all four. | Single Postgres store with a graph extension; vault-in-database; graph-only with Supabase as cache. | High. Determines where every future fact lives and how retrieval is priced. | Required |
| Graphify is derived, never authoritative | Makes the graph safe to delete at any time, so contamination is recoverable rather than catastrophic. | Graph as system of record for code facts — rejected: no deletion story, no authorization. | High. Fixes the failure mode where a stale cache silently outranks the repository. | Required |
| Six cache-invalidation invariants (content hashing, atomic swap, generation counter, provenance, explicit deletion, no mutable global state) | Converts "eliminate cache contamination" from a wish into six testable properties. | Timestamp invalidation — rejected, unreliable across checkouts. Full rebuild only — rejected, too slow to be used. | Medium-high. Determines whether incremental indexing can be trusted. | Required |
| Retrieval precedence is cost-ordered, not authority-ordered | Cheap sources answer first; the repository remains ground truth. Conflating the orderings is a classic source of confident wrong answers. | Authority-ordered precedence — rejected: every question hits the expensive store. | Medium. Shapes the Router's contract. | Required |
| Coordinator and Router are separate components | Coordinator answers *sufficiency*; Router answers *economy*. Merged, the component silently trades correctness for cost. | One orchestrator doing both — rejected for the reason above. | Medium. Two seams instead of one; clearer failure attribution. | Required |
| Identity-data invariant extended to derived data | A summary containing a phone number is still identity data. Without this, extraction quietly launders PII into a store with no access control. | Redaction at read time — rejected: the data is already copied by then. | High, load-bearing for data protection. | Already standing rule |
| Gemini enters as an `AIProvider` adapter | The abstraction exists and is sound. A parallel Gemini stack would fork the routing logic. | Separate extraction pipeline outside `packages/ai` — rejected: duplicate fallback and telemetry logic. | Medium. Keeps one provider seam. | Required |
| ADRs immutable; agent writes to the vault need human review | An edited decision record loses the evidence of what was known at the time. Unreviewed agent writes turn the vault into a second cache. | Editable living documents — rejected: history destroyed within a year. | Medium. Preserves the Graphify/Obsidian boundary. | Required |

---

## 4. Files created

| File | Purpose | Dependencies | Production-ready? |
| --- | --- | --- | --- |
| `JARVIS_CONTINUATION.md` | 12-section session handoff: branch state, approved work, unfinished operation, risks, pending decisions | None; deliberately self-contained | Yes — but it is a snapshot and will go stale |
| `jarvis-core/docs/codebase/context/ENGINEERING_POLICY.md` | PRIME's multi-model policy plus current enforceability | References `SECURITY_CONTEXT.md` | Yes |
| `jarvis-core/docs/MEMORY_ARCHITECTURE.md` | Layer contracts, retrieval precedence, identity invariant, Coordinator/Router roles, failure modes, status table | Conceptually depends on GRAPHIFY.md and OBSIDIAN.md | Yes as a design; describes nothing that exists below Supabase |
| `jarvis-core/docs/MODEL_ROUTING.md` | Engineering-work routing, delegation test, escalation, and an accurate account of the existing runtime router | Mirrors real code in `packages/ai/src/router.ts`; will drift if that file changes | Yes |
| `jarvis-core/docs/GRAPHIFY.md` | Data model, six invariants, six capabilities with definitions of done, production-ready criteria | Depends on a Gemini extraction engine that does not exist | Spec only |
| `jarvis-core/docs/GEMINI.md` | Verification results (1 of 7 pass) and the full integration contract | `AIProvider` interface; `AIProviderName` union in `@jarvis/shared` | Spec only |
| `jarvis-core/docs/OBSIDIAN.md` | Vault structure, ADR/SOP/business/learning/CEO formats, conventions, retrieval interface | Retrieval interface depends on the unbuilt Router | Spec only |

---

## 5. Files modified

Exactly one file modified; **no source file touched** in this period.

| File | What changed | Why | Debt introduced |
| --- | --- | --- | --- |
| `JARVIS_CONTINUATION.md` | Added §12 item 7 — multi-model routing seam as a decision awaiting approval; renumbered the following item | The policy created a new pending decision; the packet is the register of pending decisions | None directly — see caveat |

**Honest caveat.** The seven documents are themselves a maintenance obligation. `MODEL_ROUTING.md` describes real code; when `packages/ai/src/router.ts` changes, that document becomes wrong and nothing enforces the link. Documentation drift is real debt, just cheaper than code debt. Nothing this period wired docs into CI, so drift is currently undetectable.

---

## 6. Graphify

> **Verified 2026-08-07 in the JARVIS build environment: Graphify does not exist here.** No `graphify-out` directory, no source, no configuration, no `/graphify` command (the CLI returns `Unknown command`). The only occurrences of the string "graphify" in the repository are inside documents recording PRIME's rules. This assessment covers only this environment — it cannot see PRIME's local machine.

| Item | Status | Detail |
| --- | --- | --- |
| Installed | No | Nothing to install from: no package, binary, or script |
| Working | N/A | No implementation to run |
| `graph.json` | Absent | No file; no schema previously defined. A schema is now specified in GRAPHIFY.md §2 |
| Semantic cache | Absent | The "cache contamination" referenced in the directive has no observable instance here. Six invariants preventing the failure class were specified rather than diagnosing an incident that cannot be seen |
| Resume support | Specified | Crash-safe resume is capability 6 with a definition of done |
| Incremental indexing | Specified | Capability 5, including byte-equality-against-full-rebuild |

### Remaining issues

1. **Unresolved and blocking:** is Graphify a third-party tool run elsewhere, or a component to be built here? The answer changes the work completely — import versus build.
2. No extraction engine (Gemini absent).
3. `GRAPH_REPORT.md` and `GRAPH_HEALTH.md` were requested. Both are outputs of a run. Authoring them by hand would mean inventing measurements, so they were not written; their required contents are specified instead.

**Readiness: 5%** — specification complete, implementation zero.

---

## 7. Gemini

Seven items requested for verification. **One passes.** This is a verification result, not an estimate.

| Item | Result | Evidence |
| --- | --- | --- |
| API configured | Absent | No `GEMINI_API_KEY`. The only AI-related environment variable present is `ANTHROPIC_BASE_URL` |
| Provider working | Absent | `packages/ai/src/providers/` contains exactly `anthropic.ts` and `openai.ts` |
| Retry logic | Absent | Cross-*provider* fallback exists; no per-request retry or backoff for any provider |
| Rate limiting | Absent | `packages/security/src/rate-limit.ts` limits application actions, not provider quotas — unrelated concern |
| Cost optimization / logging | Absent | `AIResponse.usage` carries token counts; nothing aggregates or prices them |
| Health check | Absent | `isConfigured()` checks credential presence only; it never contacts the provider |
| **Provider abstraction** | **Sound** | `AIProvider` in `packages/ai/src/types.ts`. Clean interface, env-driven model names, never throws on missing credentials. Gemini is simply not one of its implementations |

### Remaining work

1. Provision `GEMINI_API_KEY` — PRIME's to do; this session must not request or handle the value.
2. Add `'gemini'` to the `AIProviderName` union in `@jarvis/shared`.
3. Write `packages/ai/src/providers/gemini.ts` against the existing interface — direct HTTPS, no SDK, matching house style.
4. **Replace the binary fallback expression.** `primary === 'openai' ? 'anthropic' : 'openai'` is structurally two-provider. Adding a third without fixing it produces silently wrong fallbacks — a latent bug found by reading the code this period.
5. Rate limiting, retry with jitter, cost logging, live health check.

**Readiness: 15%.** The one passing item is the most valuable one — the abstraction makes integration additive rather than invasive.

---

## 8. Obsidian

**Not implemented. No vault exists.** Design complete.

### What is missing

- The vault itself, and a decision on **where it lives**: inside this repository, a separate repository, or a synced folder outside git. PRIME's call; it materially affects review flow, backup, and whether agents can read it at all.
- Any content — no ADRs, SOPs, business knowledge, learning notes, or CEO notes.
- The retrieval interface, which depends on the unbuilt Router.

### Proposed architecture

Numbered top-level folders (`00-inbox`, `10-decisions`, `20-sops`, `30-businesses`, `40-learning`, `50-ceo`, `60-reference`, `99-archive`) with links and tags carrying the real structure rather than deep hierarchy. Mandatory frontmatter so retrieval can filter by `type`, `tags`, `status`, `last_reviewed`. Immutable ADRs that supersede rather than change. Read-only agent access; agent writes land in `00-inbox` as `status: unreviewed` and a human promotes them.

The boundary against Graphify is a test, not a slogan: *if deleting it loses nothing but time, it belongs in Graphify; if deleting it loses something no one can reconstruct, it belongs in Obsidian.*

**Readiness: 35%** — design complete, nothing built.

---

## 9. Multi-model architecture

**Implemented** = code exists and runs. **Documented** = a contract exists to build against.

| Component | Implemented | Documented | Reality |
| --- | --- | --- | --- |
| Claude | Yes | Yes | Operational. Also wired as a runtime provider for the `document` and `review` routes |
| Gemini | No | Yes | No credential, no adapter, no route. Bulk processing has no engine |
| Codex | No | Yes | Not reachable from this environment. Delegation is a manual step PRIME performs elsewhere; there is no dispatch mechanism |
| Graphify | No | Yes | Does not exist here (§6) |
| Obsidian | No | Yes | No vault (§8) |
| Runtime AI router | Yes | Yes | Real and working for Anthropic + OpenAI across four route kinds with cross-provider fallback. **Not** the engineering-work router — two different things sharing a name |
| Coordinator / retrieval Router | No | Yes | Unbuilt. Everything in the retrieval precedence chain depends on it |

**Net:** the multi-model architecture is one model (Claude) doing everything, with a two-provider runtime router for application traffic. The policy describing three models and four memory layers is currently aspirational — that is the gap the policy exists to close, not a criticism of it.

---

## 10. Documentation

| Document | Purpose | Complete | Should become permanent? |
| --- | --- | --- | --- |
| `JARVIS_CONTINUATION.md` | Session handoff snapshot | 100% | **No.** Archive once the next checkpoint lands — a stale handoff is worse than none |
| `ENGINEERING_POLICY.md` | Standing model-responsibility policy | 100% | **Yes.** Governance. Update the enforceability section as capabilities arrive |
| `MEMORY_ARCHITECTURE.md` | Four-layer memory design | 90% | **Yes.** Should become the ADR the vault's first record points at |
| `MODEL_ROUTING.md` | Routing rules + real router state | 95% | **Yes**, with the caveat that it mirrors live code and will drift silently |
| `GRAPHIFY.md` | Spec and acceptance criteria | 85% | **Yes** until Graphify exists, then it becomes the test plan |
| `GEMINI.md` | Verification + integration contract | 90% | **Partly.** The verification table is dated and should be replaced by a live health check |
| `OBSIDIAN.md` | Vault design | 85% | **Yes**, and it should be the vault's own first document |

Completeness is measured against each document's own stated scope, not against the system it describes. All seven are complete documents; four describe systems that do not exist.

---

## 11. Launch progress — 20 days to 28 August

| Area | % | Basis |
| --- | --- | --- |
| Infrastructure | 70% | Monorepo, tooling, Vercel deploying the right app, staging Supabase live |
| Backend | 75% | Schema 0001–0011 applied, RLS verified, orchestrator, permissions, store abstraction, 227 unit tests |
| Frontend | 55% | 11 command-centre routes exist and deploy. Unverified against real data; no design-system pass |
| AI | 40% | Router, two providers, structured outputs, agent scoping. No Gemini, no cost control, no health checks |
| Memory | 25% | Supabase layer live; three of four layers are documents |
| CRM | **0%** | **No code exists.** No package, no schema, no route. Not started |
| Website builder | **0%** | **No code exists.** Not started, and not specified either |
| Security | 65% | RLS, authority model, fail-closed critical auditing, SECURITY DEFINER discipline. 14 hardening commits remain; audit log is not tamper-evident |
| Deployment | 60% | Preview green and correct. No production promotion, no domain decision, no rollback drill |
| Documentation | 80% | Strongest area. JEKS, security context, evolution log, and now the infrastructure design set |
| Business readiness | **—** | **Cannot be rated from this environment.** No visibility into contracts, pricing, staffing, or operational readiness for the nine businesses. Any number would be invented |

### Schedule assessment

Two named launch surfaces are at zero with 20 days left, and one — the website builder — has no specification at all, so its scope is unknown rather than merely unbuilt. **28 August is not achievable for the full scope.**

Plausibly achievable by that date: a hardened, authenticated command centre on production with the current feature set, PRIME initialized, and the memory layer still on paper. If the launch definition can be narrowed to that, the date is defensible. If CRM and the website builder are required, it is not.

---

## 12. Technical debt

### Critical

| Item | Consequence | Status |
| --- | --- | --- |
| `/register` never verified working end-to-end on staging | Nobody can create an account. PRIME claim, memberships, and the whole product are gated behind this | Blocked on retest |
| PRIME bootstrap is single-use and irreversible, with no tested recovery path | One mistaken claim permanently consumes the only PRIME slot. `prime_bootstrap_verification.sql` commits, so running it against staging burns the slot | Known; guarded by procedure only |

### High

- **Binary provider fallback.** `primary === 'openai' ? 'anthropic' : 'openai'` — a third provider yields silently wrong fallbacks. Documented this period, not fixed.
- **In-memory rate limiter in a serverless deployment.** `packages/security/src/rate-limit.ts` holds state per instance; Vercel runs many. The PRIME claim path already works around this with a database-backed limiter over audit rows — evidence the general limiter is unsound for its stated purpose, not merely theoretically weak.
- **No cost logging or budget enforcement** on any AI call. Token counts are captured and discarded.
- **No provider health check.** "Key present" is treated as "provider works".
- **Audit log is not tamper-evident.** Append-only for application and database roles, deletion-resistant, but no hash chaining. Deliberately out of scope for Phase 1.1; must never be described more strongly than this.
- **PR #3 is 217 files and 28,443 lines.** Effectively unreviewable as a unit; merging it is a high-risk single event.

### Medium

- 14 of 16 hardening commits outstanding; Commit 3's migration must be `0012`.
- `unknown_outcome` approval state designed and documented but unimplemented — the state machine has a known gap.
- Seven integration adapters and Google Drive are stubs.
- Documentation drift is undetectable — `MODEL_ROUTING.md` mirrors live code with nothing enforcing the link.
- No end-to-end or browser tests. 227 unit tests, zero integration coverage of the deployed app.

### Low

- `jarvis-phase-1-audit` tag still unpushed (this session gets HTTP 403).
- `JARVIS_CONTINUATION.md` will become stale and misleading if not archived.
- Two Vercel projects build the same branch; the `coffee-society` preview serves the legacy app and is an easy source of confused testing.

---

## 13. Risks, ranked by severity

| # | Risk | Severity | Why it is realistic |
| --- | --- | --- | --- |
| 1 | Scope versus calendar | Critical | Two launch surfaces at 0% with 20 days left. On current scope this is not a risk of delay but a certainty of it |
| 2 | Authentication still unproven | Critical | No account has been confirmed created through the deployed UI. A second defect behind the fixed one would be undiscovered |
| 3 | PRIME bootstrap is one-shot | Critical | A single mistake permanently consumes the slot. Under launch pressure that mistake becomes more likely, not less |
| 4 | Big-bang merge of PR #3 | High | 28k lines merged at once, with no integration tests to catch what unit tests miss |
| 5 | Memory phase absorbs remaining time | High | Graphify + Gemini + Obsidian + Coordinator + Router is multi-week work. Starting it now trades launch for infrastructure |
| 6 | Unbudgeted AI spend | High | No cost logging, no caps, and bulk extraction is exactly the workload that produces surprise invoices |
| 7 | Directives issued against state that does not exist | High | Already happened once — Phases A and B produced specifications instead of progress. Recurrence wastes whole cycles |
| 8 | Production promotion untested | Medium | Only previews have deployed. Domain, environment variables, and rollback are unexercised |
| 9 | Wrong-project database operation | Medium | The legacy Coffee Society Supabase project is one dropdown away in the same console |
| 10 | Single-operator dependency | Medium | Every credential, approval, and manual step routes through PRIME. Illness or unavailability halts everything |

---

## 14. Recommended next ten tasks

Ordered by what unblocks the most. **Strong recommendation: do not start the memory phase until items 1–4 are done.**

| # | Task | Effort | Impact | Depends on |
| --- | --- | --- | --- | --- |
| 1 | Retest `/register` on the JARVIS preview in a fresh private window; report the exact string including any `(code:)` / `(status:)` suffix | Minutes | Critical | Nothing |
| 2 | Decide the launch definition: full scope, or command-centre-only with CRM and site builder deferred | Hours | Critical | Nothing — and it changes every estimate below |
| 3 | Set `JARVIS_PRIME_SETUP_TOKEN`, run PRIME initialization on staging, confirm authority works | Hours | Critical | #1 |
| 4 | Add end-to-end coverage for sign-up → sign-in → PRIME claim (Playwright is preinstalled) | 1–2 days | High | #1, #3 |
| 5 | Replace the in-memory rate limiter with a database-backed one, following the PRIME-claim pattern already in the codebase | 1 day | High | Freeze lift |
| 6 | Fix the binary provider fallback in `router.ts` — independently valuable, and a prerequisite for Gemini | Half day | High | Freeze lift |
| 7 | Add cost logging over the existing `AIUsage` field, plus a per-run budget cap | 1 day | High | #6 |
| 8 | Resolve the Graphify question: import an existing tool, or scope it as a build | Hours to decide | Medium | PRIME's knowledge of what exists elsewhere |
| 9 | Provision `GEMINI_API_KEY` and implement the adapter — good Codex delegation, contract already written | 1–2 days | Medium | #6, credential |
| 10 | Plan production promotion: domain, environment variables, rollback drill | 1 day | Medium | #1–#4 |

---

## 15. Lessons learned

Including mistakes made by this agent. Each has a concrete fix attached.

### Context usage — the worst offender

The hourly PR check-in ran roughly **twenty consecutive cycles with zero state change**. Each fetched the full PR object including a ~4,000-character description, then re-armed itself. That directly contradicts the token-efficiency policy, and it was run rather than questioned.
**Fix:** rely on the webhook events, which already arrive; drop the poll to once every few hours as a safety net; use `minimal_output` so the check returns state rather than the entire PR body.

### Directives issued against unverified state

Phases A and B assumed Graphify and Gemini existed. They do not, here. An entire work cycle produced specifications instead of progress. **Share of blame on this agent:** their absence was recorded in the continuation packet but buried in a numbered section rather than led with.
**Fix:** a one-command capability check before any phase directive — credentials present, tools reachable, subject exists — reported in a single line.

### Graphify

The recurring problem is that "Graphify" refers to something never observed in this environment. Every instruction about it has been unactionable.
**Fix:** settle its provenance (§14 item 8) before any further instruction references it.

### Gemini

Six of seven verification items were not merely unknown — they were verifiably absent, establishable in one command at any point in the past week.
**Fix:** verify before planning around a capability.

### Documentation

852 lines of design were written while the one open production blocker stayed unverified. Correct per directive, wrong per outcome.
**Fix:** when a directive arrives while a production blocker is open, say so before starting, not after finishing.

### Architecture

The design work is ahead of implementation, which is the right way round — but the gap is now wide enough to be its own risk. Four documents describe systems that do not exist.
**Fix:** cap unimplemented design at what the next two commits will consume.

### Agent workflow

The freeze protected correctness and was kept to. But a freeze plus a continuously growing PR compounds merge risk with every commit.
**Fix:** land Phase 1 to `main` behind a flag, or split the PR, so freezes stop accumulating debt in a single unreviewable branch.

### Token optimization

Concretely for this project: use `minimal_output` on repeated GitHub reads; stop re-reading files already established in context; batch verification into single commands (the environment check this period was one command answering four questions — the pattern to repeat); prefer one well-scoped tool call over several exploratory ones.
