#!/bin/bash
# ============================================================================
#  COVER — end-to-end
#  A worker pulls out. Nobody rings anybody. Somebody else is standing at the
#  door. This test proves each tier in turn and proves the booking never dies.
# ============================================================================
set -u
PORT=${PORT:-4599}
DB=/tmp/bookit-cover-test.db
rm -f "$DB" "$DB-wal" "$DB-shm"
# run from the repo root wherever this is checked out
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); echo "  ✓ $1"; }
no(){ FAIL=$((FAIL+1)); echo "  ✗ $1"; echo "     got: $2"; }
chk(){ if [ "$2" = "$3" ]; then ok "$1"; else no "$1" "$2 (wanted $3)"; fi; }
has(){ if echo "$2" | grep -q "$3"; then ok "$1"; else no "$1" "$(echo "$2" | head -c 300)"; fi; }

DB_PATH=$DB PORT=$PORT ADMIN_EMAILS=boss@bookit.test APP_URL=http://localhost:$PORT \
  node server.js > /tmp/cover-server.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break; sleep 0.25; done

API=http://localhost:$PORT/api
reg(){ curl -s -c /tmp/ck-$1.txt -X POST $API/register -H 'Content-Type: application/json' \
  -d "{\"role\":\"$2\",\"name\":\"$3\",\"email\":\"$1@bookit.test\",\"password\":\"password99\",\"suburb\":\"Wyong\"}" >/dev/null; }
as(){ local who=$1; shift; curl -s -b /tmp/ck-$who.txt "$@"; }
post(){ local who=$1 path=$2 data=$3; as $who -X POST "$API$path" -H 'Content-Type: application/json' -d "$data"; }
patch(){ local who=$1 path=$2 data=$3; as $who -X PATCH "$API$path" -H 'Content-Type: application/json' -d "$data"; }

echo; echo "── setting up ──────────────────────────────────────────────"
reg boss worker "Boss Admin"
reg maria participant "Maria Quinn"
reg alex worker "Alex Rivers"        # books the shift, then pulls out
reg jo worker "Jo Chen"              # care web #1
reg sam worker "Sam Okafor"          # care web #2
reg pat worker "Pat Delaney"         # standby
reg kim worker "Kim Barnes"          # pool only

# every worker takes personal care, all seven days, and is approved + visible
for w in alex jo sam pat kim; do
  post $w /me/profile '{"bio":"Test worker","services":["personal-care","household"],"langs":"English","exp":"5 years","days":[1,1,1,1,1,1,1]}' >/dev/null
  WID=$(node tests/dbq.js $DB "SELECT id FROM users WHERE email='$w@bookit.test'")
  post boss "/admin/workers/$WID/approve" '{"override":true}' >/dev/null
done
D=$(date -d '+3 days' +%Y-%m-%d)
ok "workers registered, shift date $D"

echo; echo "── 1. the care web ─────────────────────────────────────────"
JO=$(node tests/dbq.js $DB "SELECT id FROM users WHERE email='jo@bookit.test'")
SAM=$(node tests/dbq.js $DB "SELECT id FROM users WHERE email='sam@bookit.test'")
ALEX=$(node tests/dbq.js $DB "SELECT id FROM users WHERE email='alex@bookit.test'")
PAT=$(node tests/dbq.js $DB "SELECT id FROM users WHERE email='pat@bookit.test'")
R=$(post maria /me/care-web "{\"worker_id\":$SAM,\"role\":\"backup\"}")
has "Sam added to the care web" "$R" '"ok":true'
R=$(post maria /me/care-web "{\"worker_id\":$JO,\"role\":\"backup\"}")
has "Jo added to the care web" "$R" '"ok":true'
# Maria puts Jo first
CWJO=$(node tests/dbq.js $DB "SELECT id FROM care_web WHERE worker_id=$JO")
CWSAM=$(node tests/dbq.js $DB "SELECT id FROM care_web WHERE worker_id=$SAM")
R=$(post maria /me/care-web/order "{\"ids\":[$CWJO,$CWSAM]}")
FIRST=$(node tests/dbq.js $DB "SELECT worker_id FROM care_web WHERE participant_id=(SELECT id FROM users WHERE email='maria@bookit.test') ORDER BY rank LIMIT 1")
chk "Maria's own order is respected (Jo first)" "$FIRST" "$JO"
R=$(as maria $API/me/care-web)
has "suggestions offered from real history" "$R" '"suggestions"'

echo; echo "── 2. the booking, and its exposure before anything goes wrong ──"
R=$(post maria /bookings "{\"worker_id\":$ALEX,\"service\":\"personal-care\",\"date\":\"$D\",\"start\":\"09:00\",\"hours\":3}")
BK=$(echo "$R" | sed 's/.*"id":\([0-9]*\).*/\1/')
has "booking created" "$R" '"ok":true'
patch alex "/bookings/$BK" '{"status":"accepted"}' >/dev/null
R=$(as maria "$API/bookings/$BK/cover")
has "cover depth is known at booking time, not at 6am" "$R" '"depth"'
DEPTH=$(echo "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin)["depth"]["web"])')
chk "two people in the web are eligible" "$DEPTH" "2"

echo; echo "── 3. standby: a paid on-call period, not a rostered shift ──"
post pat /me/standby-settings '{"optin":true,"max":3,"services":["personal-care"]}' >/dev/null
R=$(post boss /admin/standby "{\"date\":\"$D\",\"worker_ids\":[$PAT]}")
has "standby offered to Pat" "$R" '"offered":1'
BAND=$(node tests/dbq.js $DB "SELECT band FROM standby WHERE worker_id=$PAT")
ALLOW=$(node tests/dbq.js $DB "SELECT allowance FROM standby WHERE worker_id=$PAT")
if [ "$BAND" = "weekday" ]; then chk "weekday allowance is the SCHADS cl.26 figure" "$ALLOW" "25.66";
else chk "weekend allowance is the SCHADS cl.26 figure" "$ALLOW" "50.81"; fi
SBID=$(node tests/dbq.js $DB "SELECT id FROM standby WHERE worker_id=$PAT")
R=$(post pat "/me/standby/$SBID/accept" '{}')
has "Pat accepts the on-call period" "$R" '"ok":true'
NROSTER=$(node tests/dbq.js $DB "SELECT COUNT(*) FROM bookings WHERE worker_id=$PAT AND date='$D'")
chk "accepting standby did NOT create a rostered shift (cl.25.5(f) avoided)" "$NROSTER" "0"

echo; echo "── 4. Alex can't make it ───────────────────────────────────"
R=$(post alex "/bookings/$BK/cant-make-it" '{"reason":"Car broke down"}')
has "cover opened" "$R" '"ok":true'
has "the office is told how many people are being asked" "$R" '"depth"'
ST=$(node tests/dbq.js $DB "SELECT status FROM bookings WHERE id=$BK")
CS=$(node tests/dbq.js $DB "SELECT cover_state FROM bookings WHERE id=$BK")
chk "THE BOOKING IS NOT CANCELLED" "$ST" "accepted"
chk "it is marked as finding cover" "$CS" "finding"
TIER=$(node tests/dbq.js $DB "SELECT tier FROM cover WHERE booking_id=$BK")
chk "cascade starts at the participant's own care web" "$TIER" "web"
OFFERED=$(node tests/dbq.js $DB "SELECT worker_id FROM cover_offers WHERE cover_id=(SELECT id FROM cover WHERE booking_id=$BK) ORDER BY id LIMIT 1")
chk "…and asks Jo first, because Maria said so" "$OFFERED" "$JO"
NALEX=$(node tests/dbq.js $DB "SELECT COUNT(*) FROM cover_offers WHERE worker_id=$ALEX")
chk "the worker who pulled out is never asked to cover himself" "$NALEX" "0"

echo; echo "── 5. one tap from the email, no login ─────────────────────"
OID=$(node tests/dbq.js $DB "SELECT id FROM cover_offers WHERE cover_id=(SELECT id FROM cover WHERE booking_id=$BK) ORDER BY id LIMIT 1")
TOK=$(node -e "const c=require('crypto');const s=require('fs').readFileSync('.secret','utf8').trim();console.log(c.createHmac('sha256',s).update('cover.$OID').digest('hex').slice(0,32))")
R=$(curl -s "http://localhost:$PORT/cover?o=$OID&t=badtoken&k=accept")
has "a forged token is refused" "$R" "expired"
R=$(curl -s "http://localhost:$PORT/cover?o=$OID&t=$TOK&k=accept")
has "the signed link works with no session at all" "$R" "locked in"
NEW=$(node tests/dbq.js $DB "SELECT worker_id FROM bookings WHERE id=$BK")
chk "the booking now belongs to Jo" "$NEW" "$JO"
chk "…and is still accepted, same date, same time" "$(node tests/dbq.js $DB "SELECT status||'|'||date||'|'||start FROM bookings WHERE id=$BK")" "accepted|$D|09:00"
chk "the original worker is remembered" "$(node tests/dbq.js $DB "SELECT original_worker_id FROM bookings WHERE id=$BK")" "$ALEX"
chk "cover closed as filled" "$(node tests/dbq.js $DB "SELECT status FROM cover WHERE booking_id=$BK")" "filled"
chk "no human was ever emailed" "$(node tests/dbq.js $DB "SELECT COALESCE(office_alerted_at,'none') FROM cover WHERE booking_id=$BK")" "none"

echo; echo "── 6. the cascade falls through to standby ─────────────────"
D2=$(date -d '+4 days' +%Y-%m-%d)
R=$(post maria /bookings "{\"worker_id\":$ALEX,\"service\":\"personal-care\",\"date\":\"$D2\",\"start\":\"09:00\",\"hours\":3}")
BK2=$(echo "$R" | sed 's/.*"id":\([0-9]*\).*/\1/')
patch alex "/bookings/$BK2" '{"status":"accepted"}' >/dev/null
post boss "/admin/standby" "{\"date\":\"$D2\",\"worker_ids\":[$PAT]}" >/dev/null
SB2=$(node tests/dbq.js $DB "SELECT id FROM standby WHERE worker_id=$PAT AND date='$D2'")
post pat "/me/standby/$SB2/accept" '{}' >/dev/null
post alex "/bookings/$BK2/cant-make-it" '{"reason":"Sick"}' >/dev/null
# every care-web member declines
for OF in $(node tests/dbq.js $DB "SELECT id FROM cover_offers WHERE cover_id=(SELECT id FROM cover WHERE booking_id=$BK2)"); do
  W=$(node tests/dbq.js $DB "SELECT worker_id FROM cover_offers WHERE id=$OF")
  WHO=$(node tests/dbq.js $DB "SELECT email FROM users WHERE id=$W" | cut -d@ -f1)
  post $WHO "/me/offers/$OF/decline" '{}' >/dev/null
done
CID=$(node tests/dbq.js $DB "SELECT id FROM cover WHERE booking_id=$BK2")
node tests/dbq.js $DB "UPDATE cover_offers SET expires_at='2020-01-01T00:00:00.000Z' WHERE cover_id=$CID AND response IS NULL"
post boss "/admin/cover/$CID/escalate" '{}' >/dev/null
node tests/dbq.js $DB "UPDATE cover_offers SET expires_at='2020-01-01T00:00:00.000Z' WHERE cover_id=$CID AND response IS NULL"
post boss "/admin/cover/$CID/escalate" '{}' >/dev/null
SBOFFER=$(node tests/dbq.js $DB "SELECT COUNT(*) FROM cover_offers WHERE cover_id=$CID AND worker_id=$PAT")
if [ "$SBOFFER" -ge 1 ]; then ok "the standby worker gets asked once the web is exhausted"
else no "standby tier reached" "$(node tests/dbq.js $DB "SELECT tier||' offers='||(SELECT COUNT(*) FROM cover_offers WHERE cover_id=$CID) FROM cover WHERE id=$CID")"; fi
CALLED=$(node tests/dbq.js $DB "SELECT COALESCE(called_at,'none') FROM standby WHERE worker_id=$PAT AND date='$D2'")
if [ "$CALLED" != "none" ]; then ok "the standby period is stamped as called on (it becomes a paid shift too)"; else no "standby called_at" "$CALLED"; fi

echo; echo "── 7. allied providers: the third option ───────────────────"
R=$(post boss /admin/allied '{"name":"Central Coast Care","email":"ops@cccare.test","ndis_reg":"4-XXXXXX","reg_groups":["0107","0120"],"suburbs":["Wyong"],"share":0.85,"agreement_ref":"DMHC-CCC-2026","insurance_expiry":"2027-06-30"}')
has "allied provider registered" "$R" '"ok":true'
R=$(post boss /admin/allied '{"name":"No Paperwork Pty Ltd","email":"x@nopaper.test","reg_groups":["0107"],"share":0.85}')
AID2=$(echo "$R" | sed 's/.*"id":\([0-9]*\).*/\1/')
R=$(as boss "$API/admin/cover/$CID/candidates")
has "the provider WITH an agreement on file is offerable" "$R" "Central Coast Care"
if echo "$R" | grep -q "No Paperwork"; then no "no agreement ⇒ no referral" "No Paperwork was offered"; else ok "no agreement on file ⇒ never offered a shift"; fi

echo; echo "── 8. the board, the money, the audit trail ────────────────"
R=$(as boss "$API/admin/cover")
has "cover board loads" "$R" '"stats"'
has "…and reports how much ran hands-off" "$R" 'hands_off_pct'
has "…and what the bench costs" "$R" 'standby_spend_90d'
R=$(as boss "$API/admin/payroll.csv")
has "the on-call allowance reaches payroll" "$R" "On-call standby"
has "…flagged as not claimable against a plan" "$R" "not claimable"
NOFF=$(node tests/dbq.js $DB "SELECT COUNT(*) FROM cover_offers")
if [ "$NOFF" -ge 4 ]; then ok "every offer, answer and expiry is on the record ($NOFF rows)"; else no "audit trail" "$NOFF offers"; fi

echo; echo "── 9. participant control ──────────────────────────────────"
R=$(post maria "/bookings/$BK2/stand-down" '{"reason":"Family stepping in"}')
has "the participant can stand cover down" "$R" '"ok":true'
chk "…which cancels the booking, not the person" "$(node tests/dbq.js $DB "SELECT status||'/'||cover_state FROM bookings WHERE id=$BK2")" "cancelled/stood-down"
R=$(post kim "/bookings/$BK/cant-make-it" '{"reason":"nope"}')
has "a stranger cannot open cover on someone else's shift" "$R" "isn't your shift"

echo; echo "════════════════════════════════════════════════════════════"
echo "  $PASS passed, $FAIL failed"
echo "════════════════════════════════════════════════════════════"
[ "$FAIL" -eq 0 ]
