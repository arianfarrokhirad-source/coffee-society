#!/usr/bin/env bash
# =====================================================================
# Transition-matrix parity (Phase 1.1, commit 2).
#
# The approval transition rules exist in SQL
# (public.approval_transition_allowed, the authority) and are mirrored in
# TypeScript (@jarvis/shared approvalTransitionAllowed) so the in-memory
# store and the UI can reason without a database.
#
# A mirror that can drift is worse than no mirror, so this compares
# EVERY combination of (from, to, actor kind) — including actor kinds
# that do not exist — and fails on the first disagreement.
#
# Requires: migrations 0001-0010 applied. Node 22+ for native TypeScript.
# Usage: PGHOST=... PGPORT=... PGUSER=... PGDATABASE=... ./transition_parity.sh
# =====================================================================
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Actor kinds include two that the rules do not define, so the fail-closed
# default is compared as well as the permitted paths.
STATUSES=$(psql -v ON_ERROR_STOP=1 -qtA -c \
  "select string_agg(e::text, ',' order by e) from unnest(enum_range(null::public.approval_status)) as e;")

psql -v ON_ERROR_STOP=1 -qtA -F',' <<'SQL' | sed '/^$/d' | sort > "$TMP/sql.csv"
select f.s::text, t.s::text, k.k,
       public.approval_transition_allowed(f.s, t.s, k.k)::text
from unnest(enum_range(null::public.approval_status)) as f(s),
     unnest(enum_range(null::public.approval_status)) as t(s),
     unnest(array['prime','system','executor','agent','']) as k(k);
SQL

# Imported by path rather than package name: the dump runs from a temp
# directory and must not depend on workspace linking being present.
cat > "$TMP/dump.ts" <<TS
import { approvalTransitionAllowed } from '$ROOT/packages/shared/src/approval-transitions.ts'

// The status list comes from the database enum, not from a TypeScript
// constant, so a status added in SQL and forgotten in TypeScript still
// gets compared rather than silently skipped.
const APPROVAL_STATUSES = process.argv[2].split(',')
const kinds = ['prime', 'system', 'executor', 'agent', '']
const lines = []
for (const from of APPROVAL_STATUSES) {
  for (const to of APPROVAL_STATUSES) {
    for (const kind of kinds) {
      lines.push(\`\${from},\${to},\${kind},\${approvalTransitionAllowed(from, to, kind)}\`)
    }
  }
}
console.log(lines.sort().join('\n'))
TS

node "$TMP/dump.ts" "$STATUSES" | sed '/^$/d' | sort > "$TMP/ts.csv"

SQL_ROWS=$(wc -l < "$TMP/sql.csv")
TS_ROWS=$(wc -l < "$TMP/ts.csv")
if [ "$SQL_ROWS" -ne "$TS_ROWS" ]; then
  echo "FAIL: SQL produced $SQL_ROWS rows, TypeScript produced $TS_ROWS"
  exit 1
fi

if ! diff -u "$TMP/sql.csv" "$TMP/ts.csv" > "$TMP/diff.txt"; then
  echo "FAIL: the TypeScript mirror disagrees with the SQL matrix."
  echo "      '-' is SQL (authoritative), '+' is TypeScript."
  head -40 "$TMP/diff.txt"
  exit 1
fi

ALLOWED=$(grep -c ',true$' "$TMP/sql.csv" || true)
echo "TRANSITION PARITY PASSED: $SQL_ROWS combinations agree ($ALLOWED allowed, $((SQL_ROWS - ALLOWED)) denied)"
