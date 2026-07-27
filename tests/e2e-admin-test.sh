#!/bin/bash
# E2E: worker vetting + admin dashboard (email off → console logging)
# run from the repo root wherever this is checked out
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
B=http://localhost:3100
PASS=0; FAIL=0
ok(){ echo "  ✓ $1"; PASS=$((PASS+1)); }
bad(){ echo "  ✗ $1"; FAIL=$((FAIL+1)); }
has(){ if echo "$1" | grep -q "$2"; then ok "$3"; else bad "$3 (missing '$2' in: ${1:0:150})"; fi; }
hasnt(){ if echo "$1" | grep -q "$2"; then bad "$3 (found '$2')"; else ok "$3"; fi; }

rm -f test.db test.db-wal test.db-shm aj.txt wj2.txt pj2.txt
fuser -k 3100/tcp 2>/dev/null; sleep 0.4
PORT=3100 DB_PATH=./test.db SMTP_USER=hello@bookit.life APP_URL=http://localhost:3100 ADMIN_EMAILS=bee-admin@example.com node server.js > test-server.log 2>&1 &
sleep 1.4

echo "— seeded demo workers still visible —"
W=$(curl -s $B/api/workers)
has "$W" 'Sarah M.' "12 demo workers still listed"

echo "— new worker registers → hidden —"
R=$(curl -s -c wj2.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"worker","name":"Nina Newworker","email":"nina@example.com","password":"password99","suburb":"Gosford NSW","services":["community","household"],"bio":"Keen and qualified."}')
has "$R" '"role":"worker"' "worker registered"
NID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
W=$(curl -s $B/api/workers)
hasnt "$W" 'Nina Newworker' "Nina NOT in Find Workers yet"
sleep 0.3
has "$(grep 'New worker application' test-server.log)" 'hello@bookit.life' "admin notified by email of application"

echo "— hidden worker can't be messaged or booked —"
curl -s -c pj2.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"participant","name":"Paula Part","email":"paula@example.com","password":"password99"}' > /dev/null
R=$(curl -s -b pj2.txt -X POST $B/api/conversations -H 'Content-Type: application/json' -d "{\"worker_id\":$NID}")
has "$R" "taking messages yet" "conversation blocked for hidden worker"
R=$(curl -s -b pj2.txt -X POST $B/api/bookings -H 'Content-Type: application/json' -d "{\"worker_id\":$NID,\"service\":\"community\",\"date\":\"2026-08-20\",\"start\":\"10:00\",\"hours\":3}")
has "$R" "taking bookings yet" "booking blocked for hidden worker"

echo "— admin access control —"
R=$(curl -s $B/api/admin/overview)
has "$R" 'Admin only' "anonymous blocked from admin"
R=$(curl -s -b pj2.txt $B/api/admin/overview)
has "$R" 'Admin only' "normal participant blocked from admin"
R=$(curl -s -b pj2.txt -X POST $B/api/admin/workers/$NID/approve)
has "$R" 'Admin only' "normal user can't approve workers"

echo "— admin account works —"
R=$(curl -s -c aj.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"participant","name":"Bee Admin","email":"bee-admin@example.com","password":"password99"}')
has "$R" '"admin":1' "ADMIN_EMAILS account gets admin flag"
R=$(curl -s -b aj.txt $B/api/admin/overview)
has "$R" 'Nina Newworker' "overview lists pending worker"
has "$R" '"pending":1' "pending count = 1"
has "$R" '"contacts":0' "counts present"

echo "— approve flow —"
R=$(curl -s -b aj.txt -X POST $B/api/admin/workers/$NID/approve -H 'Content-Type: application/json' -d '{"override":true}')
has "$R" '"ok":true' "approve succeeds"
sleep 0.3
has "$(grep 'profile is live' test-server.log)" 'nina@example.com' "approval email sent to worker"
W=$(curl -s $B/api/workers)
has "$W" 'Nina Newworker' "Nina NOW visible in Find Workers"
R=$(curl -s -b pj2.txt -X POST $B/api/bookings -H 'Content-Type: application/json' -d "{\"worker_id\":$NID,\"service\":\"community\",\"date\":\"2026-08-20\",\"start\":\"10:00\",\"hours\":3}")
has "$R" '"ok":true' "booking now allowed"
R=$(curl -s -b aj.txt $B/api/admin/overview)
has "$R" '"pending":0' "pending back to 0"

echo "— hide flow —"
R=$(curl -s -b aj.txt -X POST $B/api/admin/workers/$NID/hide)
has "$R" '"ok":true' "hide succeeds"
W=$(curl -s $B/api/workers)
hasnt "$W" 'Nina Newworker' "Nina hidden again"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
fuser -k 3100/tcp 2>/dev/null
exit $FAIL
