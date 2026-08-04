# JARVIS CONTINUATION PACKET

Written under PRIME directive "CONTEXT EMERGENCY — STOP NEW WORK" (2026-08-04).
No new work was started to produce this file. Sections that describe work which
did not happen say so plainly rather than inventing content.

---

## 1. Current branch and HEAD commit

- Branch: `claude/jarvis-phase-1-1-hardening`
- HEAD: `399529d38eb653747fd14553725d23fa9bf07877` (`399529d`)
- Subject: `fix(auth): correct registration action wiring`
- Tracking: `origin/claude/jarvis-phase-1-1-hardening`, 0 ahead / 0 behind at the
  time this packet was written (this packet's own commit is the first change
  after that point).

Recent commit chain on this branch, newest last:

| Commit | Subject |
| --- | --- |
| `f3d78e8` | `feat(security): fail-closed critical auditing` (Commit 2) |
| `bf4ca8e` | `fix(auth): distinguish signup failures` (auth blocker hotfix) |
| `cb79457` | `feat(auth): add dedicated registration flow` (adds migration 0011) |
| `399529d` | `fix(auth): correct registration action wiring` |

Phase 1 baseline PR #1 is a separate, frozen branch. Nothing in this packet
changes it.

## 2. Working-tree status

Clean at `399529d`. The only file added afterwards is this packet
(`JARVIS_CONTINUATION.md`), committed in the same action that created it.

No stashes were created. No migration was applied to any remote database from
this environment. No Vercel dashboard setting was changed from this environment.

## 3. Current Graphify state

**No Graphify work occurred in this session.** The `/graphify` command was
issued once and the CLI returned `Unknown command: /graphify`. No Graphify
command ran, no Graphify configuration was read, and no Graphify patch was
attempted.

The only occurrence of the string "graphify" anywhere in this repository is
prose I authored in
`jarvis-core/docs/codebase/context/SECURITY_CONTEXT.md`, recording PRIME's
memory-architecture rule ("Do not implement Graphiti, Graphify or Obsidian
yet").

If PRIME expected Graphify state here, it belongs to a different session. Do not
treat this section as evidence that Graphify is installed, configured, broken,
or patched.

## 4. Files currently present in `graphify-out`

**None — the directory does not exist** anywhere in this repository. This was
checked directly. Nothing was written to it and nothing was deleted from it.

## 5. Exact cache-contamination finding

**No cache-contamination finding was produced in this session.** No cache was
inspected, no contamination was diagnosed, and no cache was cleared. Reporting a
finding here would be fabrication.

The nearest real correctness findings from this session — all already fixed and
committed — are recorded in section 6 and in
`jarvis-core/docs/codebase/context/SECURITY_CONTEXT.md`.

## 6. Commands already approved and their results

### Approved and completed

| Work | Result |
| --- | --- |
| Commit 2 — `feat(security): fail-closed critical auditing` (`f3d78e8`) | Complete. Migration `0010_critical_auditing.sql`: 11 `SECURITY DEFINER` RPCs, `approval_transition_allowed` as the single source of transition rules, `write_critical_audit` with `request_id`/`request_origin` validation, two idempotency indexes, explicit per-function grants, four direct-write RLS policies dropped. |
| Vercel switch plan (inspection only) | Delivered. Root cause was the Vercel **Root Directory**, not the project name. Correct value: `jarvis-core/apps/command-center`, with "Include source files outside of the Root Directory" enabled. Nothing was applied from this environment. |
| Staging deployment packet | Delivered. No Supabase project created, no credentials requested or displayed, no `vercel.json` added, legacy Coffee Society app untouched. |
| Migrations `0001`–`0011` + `seed.sql` + `rls_verification.sql` shown verbatim | Done, unmodified, one file per message. |
| Migrations `0001`–`0010` applied to staging by PRIME | PRIME reported each as succeeded. |
| `rls_verification.sql` on staging | PRIME reported all checks passed. |
| Auth blocker hotfix (`bf4ca8e`) | Complete. Every signup failure previously collapsed to "the email may already be registered"; failures are now classified into 11 distinct kinds with a safe diagnostic code or HTTP status appended. |
| Registration flow (`cb79457`) | Complete, with all PRIME corrections applied: no `sex` collected and no `sex` column; existing `public.profiles.display_name` reused (no duplicate `full_name`); `0011` adds only `phone` and `date_of_birth`; age never stored; trigger is `SECURITY DEFINER` with `SET search_path = ''` and fully-qualified objects; no bare `metadata::date` cast; DOB validated at DB level including for `profiles_update_own`; no time-dependent CHECK constraint. |
| Registration wiring fix (`399529d`) | Complete. `classifyAuthError` is now operation-aware: HTTP 400/401 maps to `invalid_credentials` **only** for `sign_in`; for `sign_up` it maps to `unknown` with a diagnostic. This removes the "Those credentials are not valid" message from `/register`. |

### Validation run at `399529d`

Prettier clean · ESLint clean · TypeScript clean · **227 unit tests passing
across 20 files** · production build compiled · `codebase:verify` all checks
passed.

### Local PostgreSQL integration testing (throwaway cluster, never staging)

- `critical_audit_verification.sql` — 19 checks passed.
- `race_approval_transition.sh` — races A–D. **Race C initially failed and
  exposed a real bug:** two concurrent `create_approval_audited` calls sharing
  one `request_id` created two approvals. Fixed with
  `audit_logs_creation_idempotency_idx` plus advisory lock
  `(742618, hashtext(request_id))`. Re-run passed.
- `transition_parity.sh` — 320 SQL↔TypeScript transition combinations, full
  parity.
- `registration_verification.sql` — 9 checks passed. Check 4 caught a **real
  bug**: `safe_parse_birth_date` accepted a future date that
  `validate_profile_identity` then rejected, which would have aborted account
  creation because of an *optional* field. The parser now enforces the full
  valid range and is `STABLE`, not `IMMUTABLE`.

### Deployment

`399529d` deployed green to Vercel preview
`farrokhirad-git-claude-jarvis-phase-1-1-hardening-arian-mercer.vercel.app`
(deployment `7Gf9yDZmjhs8VziDxSZggECfhQBK`).

### Explicitly NOT run

- Migration `0011` against staging — PRIME forbade applying migrations to the
  remote project from this environment.
- `prime_bootstrap_verification.sql` against staging — it commits, and would
  permanently burn the single-PRIME slot.
- Any write to the legacy Coffee Society application or its Supabase project.

## 7. Whether Gemini API was detected

**Not applicable — no Gemini API detection was performed or requested in this
session.** No Gemini endpoint, key, SDK or configuration was looked for, found,
or used. Every model-facing decision in this session was made without any
external model API call. If a Gemini determination is needed, it is unmade work,
not a finding to carry forward.

## 8. Whether Claude subagents were avoided during the latest attempt

**Yes — no subagents were spawned at any point in this session.** All work was
performed inline in the main session. This is a direct observation, not an
inference.

## 9. Unfinished operation

`/register` is not yet confirmed working end to end on staging. Two things are
outstanding, in order:

1. **Migration `0011_profile_identity.sql` has not been applied to staging.** It
   is committed at `cb79457` and reviewed, but unapplied. Until it is applied,
   registration runs against the older `handle_new_user` from `0002`. That state
   is **degraded, not broken** — the old trigger does not reference `phone` or
   `date_of_birth`, so those two optional fields are silently dropped while
   account creation still succeeds.
2. **The exact `/register` failure string from deployment `399529d` has not been
   reported.** `399529d` changed the message that `/register` produces, so any
   error text observed before that deployment is stale. The precise post-`399529d`
   string is the single piece of evidence needed to decide whether anything
   further is wrong.

No code change should be made until item 2 is answered — the previous defect was
diagnosed from the exact message text, and guessing was what produced the wrong
first hypothesis.

## 10. Safest next action

In this order, all performed by PRIME, none from this environment:

1. Apply `jarvis-core/supabase/migrations/0011_profile_identity.sql` in the
   Supabase SQL Editor of the **JARVIS staging** project. Not the legacy Coffee
   Society project.
2. Re-run `jarvis-core/supabase/tests/rls_verification.sql`. Expected: 9 checks
   PASS across 31 tables.
3. Optionally run `jarvis-core/supabase/tests/registration_verification.sql`
   (9 checks) on staging — it is non-committing and safe.
4. Retest `/register` on the preview URL and report the **exact** error string,
   character for character, or confirm the account was created.

Do not begin Commit 3 until `/register` is confirmed.

## 11. Risks

- **Wrong-project migration.** Applying `0011` to the legacy Coffee Society
  Supabase project would alter a live unrelated system. Confirm the project name
  in the SQL Editor header before running anything.
- **`prime_bootstrap_verification.sql` on staging.** It commits. Running it
  would consume the single-PRIME slot irreversibly. Do not run it against
  staging.
- **Stale error evidence.** Any `/register` message observed before deployment
  `399529d` no longer matches the code. Acting on it would repeat the previous
  misdiagnosis.
- **Pre-`0011` degradation is silent.** Registrations completed before `0011` is
  applied will have `phone` and `date_of_birth` as NULL with no error shown to
  the user. If test accounts are created now, expect those fields empty.
- **Audit log wording.** The audit log is append-only for application and
  database roles and deletion-resistant. It is **not tamper-proof and not
  tamper-evident** — hash chaining is deliberately out of scope for Phase 1.1.
  Do not describe it more strongly than this in any external document.
- **Migration numbering.** `0011` is registration/profile identity. **Commit 3's
  migration must be `0012`**, per PRIME's correction. Re-using `0011` would
  collide with an already-committed file.
- **Unpushed tag.** The `jarvis-phase-1-audit` tag could not be pushed from this
  environment (HTTP 403). PRIME must push it.
- **Ephemeral environment.** This container is reclaimed on inactivity. Anything
  not committed and pushed is lost — which is why this packet is committed.

## 12. Decisions requiring PRIME approval

1. **Apply `0011` to staging** — approval to run it, and confirmation of which
   Supabase project is the JARVIS staging target.
2. **Begin Commit 3** — currently blocked by explicit standing instruction. Its
   migration is `0012`.
3. **Promote the preview deployment to production**, and whether the JARVIS
   production domain replaces or coexists with the legacy Coffee Society
   deployment.
4. **PRIME initialization sequence on staging** — when to claim PRIME, and
   confirmation that `JARVIS_PRIME_SETUP_TOKEN` is set in the Vercel environment
   before the claim is attempted. Single-use and irreversible.
5. **JEKS Slice 3** — deferred until after commit 10.
6. **Memory phase (Graphiti / Graphify / Obsidian)** — remains prohibited. The
   standing rule stands: graph memory is JARVIS operational and temporal memory,
   the Obsidian vault is the Farrokhirad reviewed human knowledge base, and
   Supabase is authoritative transactional and identity state. No passwords,
   tokens, phone numbers, birth dates, sex, or other identity data may live in
   graph memory or Obsidian. Integration belongs to the conversation-memory
   phase after current hardening.
7. **Multi-model routing seam (Gemini / Codex).** PRIME's Multi-Model
   Engineering Policy is recorded verbatim in
   `jarvis-core/docs/codebase/context/ENGINEERING_POLICY.md`. Neither Gemini nor
   Codex is reachable from this environment, so delegation is currently manual.
   Building an actual routing seam is unbuilt work and needs approval.
8. **`unknown_outcome` approval state** — designed and documented in
   `ARCHITECTURE_EVOLUTION.md`, deliberately excluded from Commit 2. Needs a
   decision on which commit introduces it.
