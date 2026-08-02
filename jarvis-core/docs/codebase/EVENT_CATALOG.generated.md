<!-- GENERATED — do not edit by hand. Run: npm run codebase:generate -->

# Event catalog (generated)

Generated from commit `bf4ca8e`. Event names and
producers are discovered in source; consumers, delivery guarantee and security
class come from `tools/codebase/annotations.json` because they cannot be derived
mechanically. `codebase:verify` fails when an event in code has no annotation.

Payload shapes are not duplicated here — see the producing call site and the
`system_events` / `audit_logs` columns in `supabase/migrations/0006_runs_audit.sql`.

## System events

Written to `system_events`. Idempotent via `dedupe_key`. **No consumer exists yet** — the table is a recording seam, not a queue.

| Event | Producers | Consumers | Delivery guarantee | Security class |
| --- | --- | --- | --- | --- |
| `agent.run.completed` | `packages/workflows/src/orchestrator.ts` | none — recorded only | best effort | operational |
| `agent.run.failed` | `packages/workflows/src/orchestrator.ts` | none — recorded only | best effort | operational |
| `approval.requested` | `packages/database/src/store-memory.ts`<br>`supabase/migrations/0010_critical_auditing.sql` | none — recorded only | atomic with state change | security-relevant |
| `daily_brief.requested` | `packages/reporting/src/brief.ts` | none — recorded only | best effort | telemetry |
| `decision.recorded` | `apps/command-center/app/actions/work.ts` | none — recorded only | best effort | operational |
| `task.created` | `apps/command-center/app/actions/work.ts` | none — recorded only | best effort | operational |

## Audit actions

Written to `audit_logs` (append-only). `atomic` means the row commits in the same transaction as its state change.

| Event | Producers | Consumers | Delivery guarantee | Security class |
| --- | --- | --- | --- | --- |
| `agent.actions_changed` | `supabase/migrations/0010_critical_auditing.sql` | none — recorded only | atomic with state change | security-relevant |
| `agent.activated` | `supabase/migrations/0010_critical_auditing.sql` | none — recorded only | atomic with state change | security-relevant |
| `agent.authority_changed` | `supabase/migrations/0010_critical_auditing.sql` | none — recorded only | atomic with state change | security-relevant |
| `agent.deactivated` | `supabase/migrations/0010_critical_auditing.sql` | none — recorded only | atomic with state change | security-relevant |
| `agent.financial_authority_changed` | `supabase/migrations/0010_critical_auditing.sql` | none — recorded only | atomic with state change | security-relevant |
| `agent.run.error` | `packages/workflows/src/orchestrator.ts` | none — recorded only | best effort | operational |
| `agent.run.started` | `packages/workflows/src/orchestrator.ts` | none — recorded only | best effort | operational |
| `approval.created` | `packages/database/src/store-memory.ts`<br>`supabase/migrations/0010_critical_auditing.sql` | none — recorded only | atomic with state change | security-relevant |
| `approval.expired` | `supabase/migrations/0010_critical_auditing.sql` | none — recorded only | atomic with state change | security-relevant |
| `auth.sign_out` | `apps/command-center/app/actions/auth.ts` | none — recorded only | best effort | security-relevant |
| `auth.sign_up` | `apps/command-center/app/actions/register.ts` | none — recorded only | best effort | security-relevant |
| `brief.generated` | `apps/command-center/app/actions/brief.ts` | none — recorded only | best effort | telemetry |
| `brief.generated.cron` | `apps/command-center/app/api/cron/daily-brief/route.ts` | none — recorded only | best effort | telemetry |
| `membership.created` | `supabase/migrations/0010_critical_auditing.sql` | none — recorded only | atomic with state change | security-relevant |
| `membership.revoked` | `supabase/migrations/0010_critical_auditing.sql` | none — recorded only | atomic with state change | security-relevant |
| `membership.role_changed` | `supabase/migrations/0010_critical_auditing.sql` | none — recorded only | atomic with state change | security-relevant |
| `objective.created` | `apps/command-center/app/actions/work.ts` | none — recorded only | best effort | operational |
| `prime.claim_denied` | `apps/command-center/app/actions/auth.ts` | none — recorded only | best effort | security-relevant |
| `prime.claimed` | `supabase/migrations/0007_rls.sql`<br>`supabase/migrations/0009_prime_bootstrap.sql` | none — recorded only | atomic with state change | security-relevant |
| `project.created` | `apps/command-center/app/actions/work.ts` | none — recorded only | best effort | operational |
| `task.status_changed` | `apps/command-center/app/actions/work.ts` | none — recorded only | best effort | operational |
| `tool.executed` | `packages/workflows/src/tools.ts` | none — recorded only | best effort | operational |
