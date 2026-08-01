---
name: add-database-table-with-migration-and-seed
description: Workflow command scaffold for add-database-table-with-migration-and-seed in coffee-society.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /add-database-table-with-migration-and-seed

Use this workflow when working on **add-database-table-with-migration-and-seed** in `coffee-society`.

## Goal

Adds a new database table, creates a migration, and updates the seed and verification SQL.

## Common Files

- `jarvis-core/supabase/migrations/*.sql`
- `jarvis-core/supabase/seed/seed.sql`
- `jarvis-core/supabase/tests/*.sql`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Create new migration SQL file in supabase/migrations/ (e.g., 0003_agents.sql)
- Update seed data in supabase/seed/seed.sql
- Add or update verification scripts in supabase/tests/
- Update documentation if needed

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.