#!/usr/bin/env bash
# =====================================================================
# Concurrency race test for critical auditing (Phase 1.1, commit 2).
#
# Three races, each run by real concurrent backends:
#   A. Two PRIME resolutions of the same pending approval (approve vs
#      reject). The row lock plus the expected-status check must let
#      exactly one through.
#   B. The same request id submitted twice concurrently. Idempotency
#      must collapse it to one state change and one audit row.
#   C. Concurrent creation with one request id. Exactly one approval.
#
# Requires: local_harness.sql + migrations 0001-0010 + seed.sql on a
# database with NO claimed PRIME. NEVER run against a real project.
#
# Usage: PGHOST=... PGPORT=... PGUSER=... PGDATABASE=... ./race_approval_transition.sh
# Exits 0 on pass, 1 on any violated invariant.
# =====================================================================
set -euo pipefail

PSQL="psql -v ON_ERROR_STOP=1 -qtA"
PRIME='daaaaaaa-0000-0000-0000-000000000001'

cleanup() { rm -rf "${TMP:-}"; }
TMP=$(mktemp -d)
trap cleanup EXIT

# ---------------------------------------------------------------------
# Fixture: one PRIME. The single-PRIME trigger from 0009 means this is
# the only actor that can resolve anything.
# ---------------------------------------------------------------------
$PSQL <<SQL
insert into auth.users (id, email) values ('${PRIME}', 'race-prime@test.local')
on conflict (id) do nothing;
insert into public.profiles (id, email, display_name)
values ('${PRIME}', 'race-prime@test.local', 'Race Prime')
on conflict (id) do nothing;
insert into public.memberships (organization_id, profile_id, role_id, authority_level)
select o.id, '${PRIME}', r.id, 'L5'
from public.organizations o, public.roles r
where r.key = 'prime'
  and not exists (
    select 1 from public.memberships m join public.roles r2 on r2.id = m.role_id
    where m.organization_id = o.id and m.status = 'active' and r2.key = 'prime')
limit 1;
SQL

new_approval() {
  $PSQL -c "select public.create_approval_audited(
    (select id from public.organizations limit 1), null, '${PRIME}', null,
    '$1', '{}'::jsonb, null, null, null, 'low', null, '$2', 'web');"
}

# =====================================================================
# Race A — two different resolutions of the same pending approval.
# =====================================================================
APPROVAL=$(new_approval 'race.a' 'race-a-setup')

resolve() {
  local res="$1" req="$2" out="$3"
  # pg_sleep inside the same transaction widens the window between the
  # row lock and the audit write so the race is real, not theoretical.
  if $PSQL -c "begin; select pg_sleep(0.05);
       select public.resolve_approval('${PRIME}', '${APPROVAL}', 'pending', '${res}', '${req}', 'web'); commit;" \
       >/dev/null 2>"$out.err"; then
    echo ok > "$out"
  else
    echo fail > "$out"
  fi
}

resolve approved 'race-a-approve' "$TMP/a1" &
resolve rejected 'race-a-reject'  "$TMP/a2" &
wait

A1=$(cat "$TMP/a1"); A2=$(cat "$TMP/a2")
echo "race A: approve=$A1 reject=$A2"

OKS=0
[ "$A1" = ok ] && OKS=$((OKS + 1))
[ "$A2" = ok ] && OKS=$((OKS + 1))
[ "$OKS" -eq 1 ] || { echo "FAIL A: expected exactly one winner, got $OKS"; exit 1; }

STATUS=$($PSQL -c "select status from public.approvals where id = '${APPROVAL}';")
AUDITS=$($PSQL -c "select count(*) from public.audit_logs
  where resource_id = '${APPROVAL}' and action in ('approval.approved','approval.rejected');")
EVENTS=$($PSQL -c "select count(*) from public.system_events
  where payload->>'approvalId' = '${APPROVAL}'
    and event_type in ('approval.approved','approval.rejected');")

[ "$AUDITS" = "1" ] || { echo "FAIL A: $AUDITS resolution audit rows, expected 1"; exit 1; }
[ "$EVENTS" = "1" ] || { echo "FAIL A: $EVENTS resolution events, expected 1"; exit 1; }
case "$STATUS" in
  approved|rejected) ;;
  *) echo "FAIL A: unexpected terminal status '$STATUS'"; exit 1 ;;
esac
# The surviving status must be the one whose audit row exists.
AUDITED=$($PSQL -c "select replace(action, 'approval.', '') from public.audit_logs
  where resource_id = '${APPROVAL}' and action in ('approval.approved','approval.rejected');")
[ "$STATUS" = "$AUDITED" ] || {
  echo "FAIL A: status '$STATUS' disagrees with the audit row '$AUDITED'"; exit 1; }
echo "  A ok: status=$STATUS, 1 audit row, 1 event, state and audit agree"

# =====================================================================
# Race B — the same request id resolved twice concurrently.
# =====================================================================
APPROVAL=$(new_approval 'race.b' 'race-b-setup')

replay() {
  local out="$1"
  if $PSQL -c "begin; select pg_sleep(0.05);
       select public.resolve_approval('${PRIME}', '${APPROVAL}', 'pending', 'approved', 'race-b-same', 'web'); commit;" \
       >/dev/null 2>"$out.err"; then
    echo ok > "$out"
  else
    echo fail > "$out"
  fi
}

replay "$TMP/b1" &
replay "$TMP/b2" &
wait
echo "race B: r1=$(cat "$TMP/b1") r2=$(cat "$TMP/b2")"

AUDITS=$($PSQL -c "select count(*) from public.audit_logs
  where resource_id = '${APPROVAL}' and action = 'approval.approved';")
STATUS=$($PSQL -c "select status from public.approvals where id = '${APPROVAL}';")
[ "$AUDITS" = "1" ] || { echo "FAIL B: $AUDITS audit rows for one request id, expected 1"; exit 1; }
[ "$STATUS" = "approved" ] || { echo "FAIL B: status is '$STATUS', expected approved"; exit 1; }
# Both callers must have succeeded: a replay is a success, not an error.
[ "$(cat "$TMP/b1")" = ok ] && [ "$(cat "$TMP/b2")" = ok ] || {
  echo "FAIL B: a concurrent replay was reported as an error"; exit 1; }
echo "  B ok: both callers succeeded, 1 audit row, status approved"

# =====================================================================
# Race C — concurrent creation under one request id.
# =====================================================================
create() {
  local out="$1"
  if $PSQL -c "begin; select pg_sleep(0.05);
       select public.create_approval_audited(
         (select id from public.organizations limit 1), null, '${PRIME}', null,
         'race.c', '{}'::jsonb, null, null, null, 'low', null, 'race-c-same', 'web'); commit;" \
       >"$out" 2>"$out.err"; then
    echo ok >> "$out"
  else
    echo fail >> "$out"
  fi
}

create "$TMP/c1" &
create "$TMP/c2" &
wait

CREATED=$($PSQL -c "select count(*) from public.approvals where action_type = 'race.c';")
CAUDITS=$($PSQL -c "select count(*) from public.audit_logs
  where action = 'approval.created' and request_id = 'race-c-same';")
echo "race C: approvals=$CREATED audits=$CAUDITS"
[ "$CREATED" = "1" ] || { echo "FAIL C: $CREATED approvals created for one request id"; exit 1; }
[ "$CAUDITS" = "1" ] || { echo "FAIL C: $CAUDITS creation audit rows for one request id"; exit 1; }
echo "  C ok: 1 approval, 1 audit row"

# =====================================================================
# Race D — concurrent membership creation under one request id. Same
# generated-resource-id hazard as race C, different RPC.
# =====================================================================
TARGET='daaaaaaa-0000-0000-0000-000000000002'
$PSQL <<SQL
insert into auth.users (id, email) values ('${TARGET}', 'race-target@test.local')
on conflict (id) do nothing;
insert into public.profiles (id, email, display_name)
values ('${TARGET}', 'race-target@test.local', 'Race Target')
on conflict (id) do nothing;
SQL

assign() {
  local out="$1"
  if $PSQL -c "begin; select pg_sleep(0.05);
       select public.assign_membership('${PRIME}',
         (select id from public.organizations limit 1), '${TARGET}', null,
         'employee', 'L1', 'race-d-same', 'web'); commit;" \
       >/dev/null 2>"$out.err"; then
    echo ok > "$out"
  else
    echo fail > "$out"
  fi
}

assign "$TMP/d1" &
assign "$TMP/d2" &
wait

MEMBERSHIPS=$($PSQL -c "select count(*) from public.memberships where profile_id = '${TARGET}';")
DAUDITS=$($PSQL -c "select count(*) from public.audit_logs
  where action = 'membership.created' and request_id = 'race-d-same';")
echo "race D: memberships=$MEMBERSHIPS audits=$DAUDITS"
[ "$MEMBERSHIPS" = "1" ] || { echo "FAIL D: $MEMBERSHIPS memberships for one request id"; exit 1; }
[ "$DAUDITS" = "1" ] || { echo "FAIL D: $DAUDITS membership audit rows for one request id"; exit 1; }
echo "  D ok: 1 membership, 1 audit row"

# =====================================================================
# Global invariant: no critical state change exists without its audit.
# =====================================================================
ORPHANS=$($PSQL -c "
  select count(*) from public.approvals a
  where a.status <> 'pending'
    and not exists (
      select 1 from public.audit_logs l
      where l.resource_id = a.id and l.action = 'approval.' || a.status::text);")
[ "$ORPHANS" = "0" ] || { echo "FAIL: $ORPHANS resolved approvals have no audit row"; exit 1; }

echo "APPROVAL RACE TEST PASSED: serialised transitions, idempotent replays, no unaudited state"
