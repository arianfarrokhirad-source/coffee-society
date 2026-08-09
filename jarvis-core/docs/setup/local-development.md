# Local development

## Prerequisites

- Node.js 20+ (developed on Node 22) and npm 10+
- A Supabase project (see [supabase.md](supabase.md))

## Steps

1. Install dependencies (workspace root):

   ```bash
   cd jarvis-core
   npm install
   ```

2. Configure environment:

   ```bash
   cp .env.example apps/command-center/.env.local
   ```

   Fill in at minimum `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   and `SUPABASE_SERVICE_ROLE_KEY`. AI keys and `JARVIS_MODEL_*` are optional —
   without them the chat still handles the deterministic command set.

3. Apply migrations + seed to your Supabase project ([supabase.md](supabase.md)).

4. Run:

   ```bash
   npm run dev
   ```

5. Open http://localhost:3000 → create an account at `/login` → click
   **Claim PRIME** on the Executive page (works exactly once).

## Development commands

| Command                               | Purpose                                 |
| ------------------------------------- | --------------------------------------- |
| `npm run dev`                         | Next.js dev server                      |
| `npm run typecheck`                   | `tsc --noEmit` for packages and the app |
| `npm run lint`                        | ESLint (typescript-eslint, flat config) |
| `npm run test` / `npm run test:watch` | Vitest unit tests                       |
| `npm run build`                       | production build                        |
| `npm run validate`                    | all of the above in sequence            |
| `npm run format`                      | Prettier write                          |

## Testing the database layer without Supabase

The migrations run against plain PostgreSQL 16 using the harness that emulates
the Supabase runtime (auth schema, `auth.uid()`, `anon`/`authenticated`/`service_role` roles):

```bash
psql -f supabase/tests/local_harness.sql \
     -f supabase/migrations/0001_extensions_enums.sql \
     -f supabase/migrations/0002_core_identity.sql \
     -f supabase/migrations/0003_agents.sql \
     -f supabase/migrations/0004_work.sql \
     -f supabase/migrations/0005_documents.sql \
     -f supabase/migrations/0006_runs_audit.sql \
     -f supabase/migrations/0007_rls.sql \
     -f supabase/migrations/0008_forge_pilot.sql \
     -f supabase/seed/seed.sql \
     -f supabase/tests/rls_verification.sql
```

Never run `local_harness.sql` against a real Supabase project.
