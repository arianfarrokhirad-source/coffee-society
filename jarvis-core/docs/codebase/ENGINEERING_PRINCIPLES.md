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

Each principle states the rule and what violating it looks like, so it can be
recognised in review. Principles do not list current violations — those live in
`ARCHITECTURE_EVOLUTION.md` (temporary decisions) and `SYSTEM_MAP.md` (known
coupling).

### 1. One source of truth

Every fact has exactly one authoritative home. Code is canonical for
implementation, migrations for schema, generated types for DB types, the seed
for definitions, `CURRENT_STATE.md` for project state.
**Violation:** the same list maintained in more than one place. Current
instances live in `ARCHITECTURE_EVOLUTION.md`, not here.

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

### 6. Every external action is auditable

Anything leaving the system is reconstructable afterwards: who asked, who
approved, what ran, what came back. An action that cannot be audited is an
action that must not execute.
**Violation:** a side effect with no run, tool-call or audit record behind it.

### 7. Two enforcement layers

Authorization is enforced in the application **and** in the database. Neither
is removed because the other exists — a bug in one must not be sufficient.
**Violation:** relying on an app-side check for something RLS should also deny.

### 8. The kernel owns permissions

Authorization lives in the kernel and nowhere else. No extension, business
module, integration or route re-implements, caches or reinterprets it.
**Violation:** an extension deciding for itself what a caller may do.

### 9. Kernel-first architecture

Policy, identity, data access, audit, events and AI capability form the kernel.
It is stable, extension-agnostic and never imports an extension.
**Violation:** kernel code that knows a specific business exists.

### 10. Businesses extend the kernel

Business domains register against the kernel; they never import each other.
Cross-business needs an explicit shared-service contract.
**Violation:** one business importing another, or business tables landing in
kernel migrations.

### 11. No hidden AI autonomy

Models hold no permissions. Application code decides what may happen. Model output is schema-validated and
advisory; authority is always re-derived server-side. Models never receive
database or service-role access.
**Violation:** letting a classification determine whether an action is allowed.

### 12. Generate metadata whenever practical

Anything mechanically derivable — module lists, routes, tools, dependency
graphs, checksums — is generated and marked generated. Hand-maintained
catalogs rot.
**Violation:** a hand-written list of files, or editing a generated file.

### 13. Manual docs explain intent, not implementation

Prose captures _why_, constraints and procedure. If a statement can be derived
from code, it belongs in a generated artifact instead.
**Violation:** documentation that restates what the code does, and drifts.

### 14. Tests before architecture changes

Existing tests are behaviour pins: they stay green through a refactor, and new
guarantees ship with new tests. Security-critical files list their required
tests explicitly.
**Violation:** a refactor that changes tests and code in the same step so
nothing pins the behaviour.

### 15. Every major architectural decision requires an ADR

Decisions that shape boundaries, security posture or data ownership are
recorded as immutable decision records — context, alternatives, consequences,
reversal strategy. Superseded, never edited.
**Violation:** a boundary that changed with no record of who decided or why.

### 16. Honest state over comfortable narrative

Say what is implemented, partially implemented and not implemented. Never
describe intended architecture as if it exists. Report failures with evidence;
never claim verification that did not run.
**Violation:** claiming a guarantee stronger than the implementation provides,
or documenting a capability that is not wired up.

### 17. No undocumented shortcuts

Temporary choices are permitted — unrecorded ones are not. Every shortcut goes
into `ARCHITECTURE_EVOLUTION.md` with a replacement trigger.
**Violation:** a `// TODO` standing in for a decision nobody can find later.

### 18. No circular dependencies

Module dependencies form a directed acyclic graph, enforced mechanically by
`codebase:verify`. Cycles make reasoning, testing and extraction impossible.
**Violation:** two modules importing each other, directly or transitively.

### 19. Small, reversible, reviewable steps

One concern per commit, validated before the next begins. Prefer additive
migrations and reversible changes; destructive operations require explicit
approval.
**Violation:** a large mixed commit that cannot be reasoned about or reverted.
