<!--
Type: manual
Canonical for: engineering philosophy
Update when: a principle is added, retired or materially reinterpreted (rare)
Owner: PRIME
-->

# Engineering principles

The permanent philosophy of JARVIS. Everything else — phases, commits,
documents — is temporary; these are not. When a decision is contested, the
principle wins over convenience, schedule and elegance.

Each principle states the rule, what it means in practice, and what violating
it looks like so it can be recognised in review.

### 1. One source of truth

Every fact has exactly one authoritative home. Code is canonical for
implementation, migrations for schema, generated types for DB types, the seed
for definitions, `CURRENT_STATE.md` for project state.
**Violation:** the same list maintained in three places (today: business and
agent definitions in constants, seed and the in-memory store).

### 2. Security before convenience

A control is never weakened to make a test pass, a build go green, or a flow
feel smoother. If the secure path is harder, the secure path still wins.
**Violation:** adding a test-mode auth bypass instead of building the real flow.

### 3. Fail closed

Missing configuration, unknown inputs, malformed data and errors all resolve to
_deny_. Unknown action types map to L5 + always-approval. An unset setup token
disables PRIME claiming entirely.
**Violation:** `catch {}` that lets execution continue, or a default that grants.

### 4. Approval before execution

Restricted, external or costly actions become approval records for PRIME —
never silent execution, never silent failure. Phase 1 deliberately ships with
no executors at all.
**Violation:** an action that performs an external side effect on its own
authority, however small.

### 5. Least privilege

Every actor gets the minimum: agents default to L1 with zero financial
authority and never inherit user permissions; clients are excluded from
internal data by RLS; the claim RPC is `service_role`-only; browsers receive
only the anon key.
**Violation:** widening a grant "temporarily", or an agent acting at the
requesting user's level.

### 6. Two enforcement layers

Authorization is enforced in the application **and** in the database. Neither
is removed because the other exists — a bug in one must not be sufficient.
**Violation:** relying on an app-side check for something RLS should also deny.

### 7. Kernel-first architecture

Policy, identity, data access, audit, events and AI capability form the kernel.
It is stable, extension-agnostic and never imports an extension.
**Violation:** kernel code that knows a specific business exists.

### 8. Businesses extend the kernel

Business domains register against the kernel; they never import each other.
Cross-business needs an explicit shared-service contract.
**Violation:** FORGE importing SIGNAL, or business tables landing in kernel
migrations (currently true for FORGE — tracked, not endorsed).

### 9. Models have no permissions

Application code decides what may happen. Model output is schema-validated and
advisory; authority is always re-derived server-side. Models never receive
database or service-role access.
**Violation:** letting a classification determine whether an action is allowed.

### 10. Generate metadata whenever practical

Anything mechanically derivable — module lists, routes, tools, dependency
graphs, checksums — is generated and marked generated. Hand-maintained
catalogs rot.
**Violation:** a hand-written list of files, or editing a generated file.

### 11. Manual docs explain intent, not implementation

Prose captures _why_, constraints and procedure. If a statement can be derived
from code, it belongs in a generated artifact instead.
**Violation:** documentation that restates what the code does, and drifts.

### 12. Tests before architecture changes

Existing tests are behaviour pins: they stay green through a refactor, and new
guarantees ship with new tests. Security-critical files list their required
tests explicitly.
**Violation:** a refactor that changes tests and code in the same step so
nothing pins the behaviour.

### 13. Honest state over comfortable narrative

Say what is implemented, partially implemented and not implemented. Never
describe intended architecture as if it exists. Report failures with evidence;
never claim verification that did not run.
**Violation:** "tamper-proof" for an audit log that is only append-only; docs
describing model-driven tool calling that is not wired up.

### 14. No undocumented shortcuts

Temporary choices are permitted — unrecorded ones are not. Every shortcut goes
into `ARCHITECTURE_EVOLUTION.md` with a replacement trigger.
**Violation:** a `// TODO` standing in for a decision nobody can find later.

### 15. Small, reversible, reviewable steps

One concern per commit, validated before the next begins. Prefer additive
migrations and reversible changes; destructive operations require explicit
approval.
**Violation:** a large mixed commit that cannot be reasoned about or reverted.
