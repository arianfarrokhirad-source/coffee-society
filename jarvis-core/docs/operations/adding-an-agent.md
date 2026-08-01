# Adding an agent

Agents are database rows (capabilities) + a versioned role card (prompt).

1. **Role card**: create `agents/<business>/role-card.ts` exporting
   `roleCard` and `ROLE_CARD_VERSION`. State scope, allowed behaviour and
   hard prohibitions in plain language. Never duplicate the master
   constitution — `composePrompt()` layers it automatically.

2. **Register the code**: add it to `AGENT_CODES` (and `BUSINESS_AGENT` if it
   is a business's primary agent) in `packages/shared/src/constants.ts`, and
   to `AGENT_ROLE_CARDS` in `agents/src/index.ts`.

3. **Insert the definition** (mirrors `supabase/seed/seed.sql`):

   ```sql
   insert into public.agents
     (organization_id, business_id, code, name, description, authority_level,
      allowed_action_types, prohibited_action_types, max_financial_authority, active, status)
   values (..., 'A09-GM', ..., 'L1',
           array['read_internal','draft','recommend','create_task'],
           array['external_side_effect','financial_execution'], 0, true, 'active');
   ```

   Rules that keep the system safe:
   - default `authority_level` is **L1** (draft and recommend)
   - `max_financial_authority` stays **0** until there is an execution path
     with approvals
   - always include `external_side_effect` and `financial_execution` in the
     prohibited list unless a later phase deliberately changes that

4. **Test**: extend `packages/permissions/tests/agent-scope.test.ts` (scope,
   prohibitions) and run `npm run validate`.

The agent inherits nothing from any user. Its capabilities are exactly the
row + the tool pipeline's checks.
