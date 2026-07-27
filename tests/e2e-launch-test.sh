#!/bin/bash
# E2E: launch sweep — demo data removal + go-live signals
# run from the repo root wherever this is checked out
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
B=http://localhost:3118
PASS=0; FAIL=0
ok(){ echo "  ✓ $1"; PASS=$((PASS+1)); }
bad(){ echo "  ✗ $1"; FAIL=$((FAIL+1)); }
has(){ if echo "$1" | grep -q "$2"; then ok "$3"; else bad "$3 (missing '$2' in: ${1:0:180})"; fi; }
hasnt(){ if echo "$1" | grep -q "$2"; then bad "$3 (found '$2')"; else ok "$3"; fi; }

rm -f ln.db ln.db-wal ln.db-shm la.txt lp.txt lw.txt
fuser -k 3118/tcp 2>/dev/null; sleep 0.4
PORT=3118 DB_PATH=./ln.db SITE_PASSWORD=preview123 ADMIN_EMAILS=boss@example.com node server.js > ln-server.log 2>&1 &
sleep 1.4
# unlock the private-preview gate (form POST, sets the bk_gate cookie)
curl -s -c gate.txt -X POST $B/gate --data 'pw=preview123' -o /dev/null

echo "— before: demo data present —"
R=$(curl -s -b gate.txt $B/api/me)
has "$R" '"demo":true' "/api/me flags demo data present"
W=$(curl -s -b gate.txt $B/api/workers)
has "$W" 'Sarah M.' "demo workers listed"

echo "— access control —"
curl -s -b gate.txt -c lp.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"participant","name":"Real Person","email":"real@example.com","password":"password99"}' > /dev/null
R=$(curl -s -b lp.txt -b gate.txt -X POST $B/api/admin/launch-sweep -H 'Content-Type: application/json' -d '{"confirm":"LAUNCH"}')
has "$R" 'Admin only' "non-admin blocked"
curl -s -b gate.txt -c la.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"participant","name":"Boss","email":"boss@example.com","password":"password99"}' > /dev/null
R=$(curl -s -b la.txt -b gate.txt -X POST $B/api/admin/launch-sweep -H 'Content-Type: application/json' -d '{"confirm":"nope"}')
has "$R" 'Type LAUNCH to confirm' "wrong confirmation rejected"

echo "— overview shows launch state —"
R=$(curl -s -b la.txt -b gate.txt $B/api/admin/overview)
has "$R" '"gate":true' "gate reported ON"
has "$R" '"demo_accounts":13' "13 demo accounts counted"

echo "— demo activity exists then the sweep runs —"
curl -s -b gate.txt -c lw.txt -X POST $B/api/login -H 'Content-Type: application/json' -d '{"email":"demo@demo.bookit.life","password":"demo1234"}' > /dev/null
SID=$(curl -s -b gate.txt $B/api/workers | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
curl -s -b lw.txt -b gate.txt -X POST $B/api/conversations -H 'Content-Type: application/json' -d "{\"worker_id\":$SID}" > /dev/null
curl -s -b lw.txt -b gate.txt -X POST $B/api/bookings -H 'Content-Type: application/json' -d "{\"worker_id\":$SID,\"service\":\"community\",\"date\":\"2026-09-01\",\"start\":\"10:00\",\"hours\":2}" > /dev/null
R=$(curl -s -b la.txt -b gate.txt -X POST $B/api/admin/launch-sweep -H 'Content-Type: application/json' -d '{"confirm":"LAUNCH"}')
has "$R" '"ok":true' "sweep runs"
has "$R" '"removed":13' "13 demo accounts removed"

echo "— after: clean —"
W=$(curl -s -b gate.txt $B/api/workers)
hasnt "$W" 'Sarah M.' "demo workers gone from Find Workers"
R=$(curl -s -b gate.txt $B/api/me)
has "$R" '"demo":false' "/api/me now flags demo gone"
R=$(curl -s -b gate.txt -X POST $B/api/login -H 'Content-Type: application/json' -d '{"email":"demo@demo.bookit.life","password":"demo1234"}')
has "$R" "doesn't match" "demo login no longer works"
R=$(curl -s -b lp.txt -b gate.txt $B/api/me)
has "$R" 'Real Person' "real accounts untouched"
R=$(curl -s -b la.txt -b gate.txt $B/api/admin/overview)
has "$R" '"demo_accounts":0' "overview shows clean"
has "$R" '"bookings":0' "demo bookings gone"
R=$(curl -s -b la.txt -b gate.txt -X POST $B/api/admin/launch-sweep -H 'Content-Type: application/json' -d '{"confirm":"LAUNCH"}')
has "$R" '"removed":0' "second sweep is a no-op"

echo "— SEED_DEMO=off keeps a fresh DB clean —"
fuser -k 3118/tcp 2>/dev/null; sleep 0.4
rm -f ln2.db ln2.db-wal ln2.db-shm
PORT=3118 DB_PATH=./ln2.db SEED_DEMO=off node server.js > ln2-server.log 2>&1 &
sleep 1.2
W=$(curl -s $B/api/workers)
has "$W" '"workers":\[\]' "fresh DB with SEED_DEMO=off has zero demo workers"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
fuser -k 3118/tcp 2>/dev/null
rm -f gate.txt ln2.db* ln2-server.log
exit $FAIL
