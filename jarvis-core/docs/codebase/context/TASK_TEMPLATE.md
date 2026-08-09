<!--
Type: manual
Canonical for: nothing — a form to copy
Update when: the change-control protocol changes
Owner: PRIME
-->

# Claude task context template

Copy this into the task brief and fill it **before** changing code. An unfilled
field is a signal to ask, not to guess.

```
CLAUDE TASK CONTEXT

Current phase:
Baseline commit:
Approved objective:            # exactly what PRIME approved, in one sentence
Relevant domain:               # kernel | database | security | ai | frontend
Relevant modules:              # paths, from the domain packet
Canonical sources:             # what is authoritative for this change
Security constraints:          # from SECURITY_CONTEXT.md; state "none" only if true
Files allowed to change:
Files prohibited from changing:
Required tests:                # existing tests that must stay green + new tests
Required documentation updates:# at minimum CURRENT_STATE.md at checkpoint
Stop condition:                # what "done" means, and where to stop and report
```

## Rules

1. **Smallest sufficient context.** Start Tiny (`CURRENT_STATE` + one packet).
   Escalate only with a reason.
2. **Prohibited beats allowed.** If a file appears in both lists, it is
   prohibited.
3. **No scope drift.** Discovering a second problem does not authorize fixing
   it — record it and report it at the checkpoint.
4. **Stop at the stop condition** and return the agreed checkpoint format.
5. **Never describe unimplemented behaviour as implemented** in code comments,
   docs or reports.
