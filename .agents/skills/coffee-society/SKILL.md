```markdown
# coffee-society Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches the core development patterns, coding conventions, and common workflows used in the `coffee-society` TypeScript monorepo. You will learn how to add new modules, database tables, agents/businesses, and API endpoints, as well as how to write and organize code and tests according to the established standards of the repository.

## Coding Conventions

- **Language:** TypeScript
- **Framework:** None detected (custom architecture)
- **File Naming:** Use `camelCase` for file and directory names.
  - Example: `roleCard.ts`, `featureModule.ts`
- **Import Style:** Mixed (both default and named imports may be used)
  - Example:
    ```typescript
    import { myFunction } from './utils';
    import defaultExport from './defaultModule';
    ```
- **Export Style:** Prefer named exports.
  - Example:
    ```typescript
    // Good
    export function doSomething() { ... }
    export const CONSTANT = 42;

    // Avoid
    export default function() { ... }
    ```
- **Commit Messages:** Use [Conventional Commits](https://www.conventionalcommits.org/) with the `feat` prefix for features.
  - Example: `feat: add agent onboarding workflow`

## Workflows

### Add New Package Module
**Trigger:** When introducing a new logical module (e.g., ai, permissions, security, reporting, workflows)  
**Command:** `/new-package`

1. Create a new directory under `packages/` (e.g., `packages/ai/`).
2. Add a `package.json` with dependencies and metadata.
3. Implement core logic in `src/` (e.g., `src/index.ts`, `src/feature.ts`).
4. Write unit tests in `tests/` (e.g., `tests/feature.test.ts`).
5. Update monorepo package management files if needed (e.g., `package-lock.json`).

**Example:**
```bash
mkdir packages/ai
cd packages/ai
npm init -y
# Add dependencies to package.json
mkdir src tests
touch src/index.ts tests/index.test.ts
```

### Add Database Table with Migration and Seed
**Trigger:** When introducing a new entity or feature requiring persistent storage  
**Command:** `/new-table`

1. Create a new migration SQL file in `supabase/migrations/` (e.g., `0003_agents.sql`).
2. Update seed data in `supabase/seed/seed.sql`.
3. Add or update verification scripts in `supabase/tests/`.
4. Update documentation if needed.

**Example:**
```sql
-- supabase/migrations/0003_agents.sql
CREATE TABLE agents (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT
);
```

### Add New Agent or Business
**Trigger:** When onboarding a new agent or business to the system  
**Command:** `/new-agent`

1. Create a new role-card file under `agents/` (e.g., `agents/atlas/role-card.ts`).
2. Update the agent or business registry in `shared/src/constants.ts` or similar.
3. Update documentation in `docs/operations/` (e.g., `adding-an-agent.md`, `adding-a-business.md`).

**Example:**
```typescript
// agents/atlas/role-card.ts
export const atlasRoleCard = {
  name: 'Atlas',
  permissions: ['read', 'write']
};
```

### Add API Endpoint with Auth and Tests
**Trigger:** When exposing a new API endpoint for the frontend or integrations  
**Command:** `/new-api`

1. Create a new route file under `app/api/` (e.g., `app/api/jarvis/chat/route.ts`).
2. Implement authentication and rate limiting in `lib/` (e.g., `lib/auth.ts`, `lib/cron-auth.ts`).
3. Write corresponding tests in `tests/` (e.g., `tests/cron-auth.test.ts`).
4. Update documentation if needed.

**Example:**
```typescript
// app/api/jarvis/chat/route.ts
import { authenticate } from '../../lib/auth';

export async function POST(req: Request) {
  const user = await authenticate(req);
  if (!user) return new Response('Unauthorized', { status: 401 });
  // ...handle chat logic
}
```

## Testing Patterns

- **Framework:** [Vitest](https://vitest.dev/)
- **Test File Pattern:** `*.test.ts`
- **Test Placement:** Place test files in a `tests/` directory within each package or module.
- **Example Test:**
  ```typescript
  // tests/feature.test.ts
  import { doSomething } from '../src/feature';

  describe('doSomething', () => {
    it('should return expected result', () => {
      expect(doSomething()).toBe('expected');
    });
  });
  ```

## Commands

| Command      | Purpose                                                    |
|--------------|------------------------------------------------------------|
| /new-package | Scaffold a new package/module in the monorepo              |
| /new-table   | Add a new database table with migration and seed scripts    |
| /new-agent   | Add a new agent or business with role card and documentation|
| /new-api     | Add a new API endpoint with authentication and tests        |
```