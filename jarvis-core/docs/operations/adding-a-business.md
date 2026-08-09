# Adding a business

Businesses live in the `businesses` table; A00–A08 are seeded. To add A09+:

1. **Insert the row** (PRIME session or a migration):

   ```sql
   insert into public.businesses (organization_id, code, name, description, status, agents_enabled)
   select id, 'A09', 'NAME', 'What it does.', 'active', true
   from public.organizations where slug = 'atlas-holdings';
   ```

   The `code` check constraint requires the `A##` format.

2. **Register the code in `@jarvis/shared`** (`packages/shared/src/constants.ts`):
   extend `BUSINESS_CODES`, `BUSINESS_NAMES`, and `BUSINESS_AGENT` (the
   type system will then force every switch/map to handle it).

3. **Create its agent** — see [adding-an-agent.md](adding-an-agent.md).

4. **Memberships**: PRIME has org-wide access automatically. Grant scoped
   staff access by inserting `memberships` rows (PRIME can do this under RLS).

5. **Verify**: `npm run typecheck && npm run test`, then check the business
   appears on `/businesses` and routes correctly in JARVIS chat
   (mentioning the code or name should select it).

Dormant pattern (like A08 VOID): `status = 'dormant', agents_enabled = false`
— the orchestrator refuses all work for it.
