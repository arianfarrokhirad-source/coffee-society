---
name: add-new-package-module
description: Workflow command scaffold for add-new-package-module in coffee-society.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /add-new-package-module

Use this workflow when working on **add-new-package-module** in `coffee-society`.

## Goal

Adds a new package (module) to the monorepo, including implementation, tests, and package.json.

## Common Files

- `jarvis-core/packages/*/package.json`
- `jarvis-core/packages/*/src/*.ts`
- `jarvis-core/packages/*/tests/*.test.ts`
- `jarvis-core/package-lock.json`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Create new package directory under packages/ (e.g., packages/ai/)
- Add package.json with dependencies and metadata
- Implement core logic in src/ (e.g., src/index.ts, src/feature.ts)
- Write corresponding unit tests in tests/ (e.g., tests/feature.test.ts)
- Update monorepo package management files if needed (e.g., package-lock.json)

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.