# Incident response

## Severity

| Level | Example                                                          | Response                        |
| ----- | ---------------------------------------------------------------- | ------------------------------- |
| P0    | Leaked service-role key / AI key; data exposure                  | Act immediately, all else stops |
| P1    | Suspicious agent runs; approval bypass suspicion; auth anomalies | Same day                        |
| P2    | Repeated agent failures; provider outage                         | Next working session            |

## Leaked credential (P0)

1. **Rotate first, investigate second.**
   - Supabase service-role key: Dashboard → Settings → API → regenerate;
     update Vercel/local env; redeploy.
   - Anthropic/OpenAI key: revoke in the provider console, issue a new one.
   - `JARVIS_CRON_SECRET`: replace in env; old value stops working instantly.
2. If the key was committed to git: rotate anyway (history is permanent),
   then scrub the repo history if the repo is shared.
3. Review `audit_logs` and `model_usage` for activity during the exposure
   window (PRIME can read both in the SQL editor or dashboards).

## Suspicious agent behaviour (P1)

1. Deactivate the agent: `update public.agents set active = false where code = '...';`
   — the tool pipeline denies everything for inactive agents immediately.
2. Reconstruct the timeline: `agent_runs` → `tool_calls` (arguments +
   denial reasons) → `audit_logs` (by `request_id`).
3. Check `approvals` for anything pending/approved you did not expect;
   reject or cancel them.
4. Tighten the agent's `allowed_action_types` / policy before reactivating.

## Auth anomalies (P1)

1. Supabase Dashboard → Authentication → Users: review sessions, revoke as
   needed; audit `auth.sign_in` events in `audit_logs`.
2. If public signups are enabled and shouldn't be, disable them
   (Authentication → Settings).
3. Memberships are PRIME-managed; verify no unexpected `memberships` rows
   (RLS lets PRIME see all).

## Provider outage (P2)

The router falls back to the other provider automatically; with both down,
chat degrades to deterministic summaries and says so. No action needed
beyond monitoring; check `model_usage.success` for the window.

## Non-negotiables

- Audit logs are append-only — never "clean up" during an incident; they are
  the record.
- Do not weaken RLS policies or approval gates as a workaround while
  firefighting. Deactivate agents / revoke sessions instead.
