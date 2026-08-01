---
name: add-new-agent-or-business
description: Workflow command scaffold for add-new-agent-or-business in coffee-society.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /add-new-agent-or-business

Use this workflow when working on **add-new-agent-or-business** in `coffee-society`.

## Goal

Adds a new agent or business definition, including role cards and registry updates, with documentation.

## Common Files

- `jarvis-core/agents/*/role-card.ts`
- `jarvis-core/packages/shared/src/constants.ts`
- `jarvis-core/docs/operations/adding-an-agent.md`
- `jarvis-core/docs/operations/adding-a-business.md`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Create new role-card file under agents/ (e.g., agents/atlas/role-card.ts)
- Update agent or business registry in shared/src/constants.ts or similar
- Update documentation in docs/operations/ (e.g., adding-an-agent.md, adding-a-business.md)

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.