#!/usr/bin/env bash
# =====================================================================
# Concurrency race test for the PRIME bootstrap (Phase 1.1 commit 1).
# Requires a database with migrations 0001-0009 + seed applied and NO
# claimed PRIME. Two real backends race claim_prime_with_nonce with two
# valid nonces for two different users; exactly one may win.
#
# Usage: PGHOST=... PGPORT=... PGUSER=... PGDATABASE=... ./race_prime_claim.sh
# Exits 0 on pass, 1 on any violated invariant.
# =====================================================================
set -euo pipefail

PSQL="psql -v ON_ERROR_STOP=1 -qtA"

$PSQL <<'SQL'
insert into auth.users (id, email) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'racer1@test.local'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'racer2@test.local')
on conflict (id) do nothing;

insert into public.prime_claim_nonces (nonce_hash, user_id, expires_at) values
  (encode(sha256(convert_to('race-nonce-1', 'UTF8')), 'hex'),
   'bbbbbbbb-0000-0000-0000-000000000001', now() + interval '2 minutes'),
  (encode(sha256(convert_to('race-nonce-2', 'UTF8')), 'hex'),
   'bbbbbbbb-0000-0000-0000-000000000002', now() + interval '2 minutes');
SQL

# Two concurrent backends. Each records success/failure to its own file.
run_claim() {
  local user="$1" nonce="$2" out="$3"
  if $PSQL -c "select public.claim_prime_with_nonce('${user}', '${nonce}');" >/dev/null 2>"$out.err"; then
    echo ok > "$out"
  else
    echo fail > "$out"
  fi
}

TMP=$(mktemp -d)
run_claim 'bbbbbbbb-0000-0000-0000-000000000001' 'race-nonce-1' "$TMP/r1" &
run_claim 'bbbbbbbb-0000-0000-0000-000000000002' 'race-nonce-2' "$TMP/r2" &
wait

R1=$(cat "$TMP/r1"); R2=$(cat "$TMP/r2")
echo "racer1=$R1 racer2=$R2"

OKS=0
[ "$R1" = ok ] && OKS=$((OKS+1))
[ "$R2" = ok ] && OKS=$((OKS+1))
if [ "$OKS" -ne 1 ]; then
  echo "FAIL: expected exactly one winner, got $OKS"; exit 1
fi

# Invariants after the race.
MEMBERS=$($PSQL -c "select count(*) from public.memberships m join public.roles r on r.id = m.role_id where r.key='prime' and m.status='active';")
AUDITS=$($PSQL -c "select count(*) from public.audit_logs where action='prime.claimed';")
UNCONSUMED=$($PSQL -c "select count(*) from public.prime_claim_nonces where nonce_hash in (
  encode(sha256(convert_to('race-nonce-1','UTF8')),'hex'),
  encode(sha256(convert_to('race-nonce-2','UTF8')),'hex')) and consumed_at is null;")

[ "$MEMBERS" = "1" ] || { echo "FAIL: $MEMBERS active PRIME memberships"; exit 1; }
[ "$AUDITS" = "1" ]  || { echo "FAIL: $AUDITS prime.claimed audit rows"; exit 1; }
[ "$UNCONSUMED" = "1" ] || { echo "FAIL: loser's nonce state wrong (unconsumed=$UNCONSUMED, expected 1)"; exit 1; }

# Replay of the winner's nonce and a retry by the loser must both fail.
WINNER_NONCE='race-nonce-1'; LOSER_USER='bbbbbbbb-0000-0000-0000-000000000002'; LOSER_NONCE='race-nonce-2'
if [ "$R2" = ok ]; then WINNER_NONCE='race-nonce-2'; LOSER_USER='bbbbbbbb-0000-0000-0000-000000000001'; LOSER_NONCE='race-nonce-1'; fi
WINNER_USER='bbbbbbbb-0000-0000-0000-000000000001'
[ "$R2" = ok ] && WINNER_USER='bbbbbbbb-0000-0000-0000-000000000002'

if $PSQL -c "select public.claim_prime_with_nonce('${WINNER_USER}', '${WINNER_NONCE}');" >/dev/null 2>&1; then
  echo "FAIL: winning-nonce replay accepted"; exit 1
fi
if $PSQL -c "select public.claim_prime_with_nonce('${LOSER_USER}', '${LOSER_NONCE}');" >/dev/null 2>&1; then
  echo "FAIL: loser retry accepted after PRIME exists"; exit 1
fi

echo "RACE TEST PASSED: one winner, one membership, one audit row, loser nonce unconsumed, replay and retry rejected"
