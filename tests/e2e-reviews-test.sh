#!/bin/bash
# E2E: post-shift reviews — write, aggregate, moderate
# run from the repo root wherever this is checked out
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
B=http://localhost:3119
PASS=0; FAIL=0
ok(){ echo "  ✓ $1"; PASS=$((PASS+1)); }
bad(){ echo "  ✗ $1"; FAIL=$((FAIL+1)); }
has(){ if echo "$1" | grep -q "$2"; then ok "$3"; else bad "$3 (missing '$2' in: ${1:0:180})"; fi; }
hasnt(){ if echo "$1" | grep -q "$2"; then bad "$3 (found '$2')"; else ok "$3"; fi; }

rm -f rv.db rv.db-wal rv.db-shm ra.txt rp.txt rw.txt
fuser -k 3119/tcp 2>/dev/null; sleep 0.4
PORT=3119 DB_PATH=./rv.db SMTP_USER=hello@bookit.life APP_URL=http://localhost:3119 ADMIN_EMAILS=boss@example.com node server.js > rv-server.log 2>&1 &
sleep 1.4
TODAY=$(date +%F)

echo "— set up a completed shift —"
R=$(curl -s -c rw.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"worker","name":"Revie Wworker","email":"revw@example.com","password":"password99","services":["community"]}')
WID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
curl -s -c rp.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"participant","name":"Paula Praise","email":"paula@example.com","password":"password99"}' > /dev/null
curl -s -c ra.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"participant","name":"Boss","email":"boss@example.com","password":"password99"}' > /dev/null
curl -s -b ra.txt -X POST $B/api/admin/workers/$WID/approve -H 'Content-Type: application/json' -d '{"override":true}' > /dev/null
R=$(curl -s -b rp.txt -X POST $B/api/bookings -H 'Content-Type: application/json' -d "{\"worker_id\":$WID,\"service\":\"community\",\"date\":\"$TODAY\",\"start\":\"09:00\",\"hours\":3}")
BID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)

echo "— can't review too early / wrong person —"
R=$(curl -s -b rp.txt -X POST $B/api/bookings/$BID/review -H 'Content-Type: application/json' -d '{"rating":5}')
has "$R" "once it's marked completed" "no review before completion"
curl -s -b rw.txt -X PATCH $B/api/bookings/$BID -H 'Content-Type: application/json' -d '{"status":"accepted"}' > /dev/null
curl -s -b rw.txt -X PATCH $B/api/bookings/$BID -H 'Content-Type: application/json' -d '{"status":"completed","note":"Community access this morning. We walked to the library and back, Paula chose the books herself."}' > /dev/null
R=$(curl -s -b rw.txt -X POST $B/api/bookings/$BID/review -H 'Content-Type: application/json' -d '{"rating":5}')
has "$R" 'Only participants' "workers can't review"
R=$(curl -s -b rp.txt -X POST $B/api/bookings/$BID/review -H 'Content-Type: application/json' -d '{"rating":9}')
has "$R" 'from 1 to 5' "rating bounds enforced"

echo "— the review lands —"
R=$(curl -s -b rp.txt -X POST $B/api/bookings/$BID/review -H 'Content-Type: application/json' -d '{"rating":5,"comment":"Kind, on time and made my day genuinely fun."}')
has "$R" '"ok":true' "review saved"
R=$(curl -s -b rp.txt -X POST $B/api/bookings/$BID/review -H 'Content-Type: application/json' -d '{"rating":4}')
has "$R" 'already reviewed' "one review per booking"
R=$(curl -s -b rp.txt $B/api/bookings)
has "$R" '"reviewed":1' "bookings list flags reviewed"
sleep 0.3
has "$(grep 'new review' rv-server.log)" 'revw@example.com' "worker emailed about the review"

echo "— aggregates + public profile —"
R=$(curl -s $B/api/workers/$WID)
has "$R" '"rating":5' "live rating = 5"
has "$R" '"shifts":1' "review count drives shifts number"
has "$R" 'made my day genuinely fun' "comment on the public profile"
has "$R" '"author":"Paula P."' "author shown as first name + initial"
hasnt "$R" 'paula@example.com' "no reviewer email exposed"
W=$(curl -s $B/api/workers)
has "$W" '"rating":5' "workers list carries the live rating"

echo "— second review averages —"
R=$(curl -s -b rp.txt -X POST $B/api/bookings -H 'Content-Type: application/json' -d "{\"worker_id\":$WID,\"service\":\"community\",\"date\":\"$TODAY\",\"start\":\"14:00\",\"hours\":2}")
B2=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
curl -s -b rw.txt -X PATCH $B/api/bookings/$B2 -H 'Content-Type: application/json' -d '{"status":"accepted"}' > /dev/null
curl -s -b rw.txt -X PATCH $B/api/bookings/$B2 -H 'Content-Type: application/json' -d '{"status":"completed","note":"Afternoon session at the community centre. Quieter than usual but a good couple of hours."}' > /dev/null
curl -s -b rp.txt -X POST $B/api/bookings/$B2/review -H 'Content-Type: application/json' -d '{"rating":4}' > /dev/null
R=$(curl -s $B/api/workers/$WID)
has "$R" '"rating":4.5' "average of 5 and 4 = 4.5"
has "$R" '"shifts":2' "two reviews counted"

echo "— admin moderation —"
R=$(curl -s -b ra.txt $B/api/admin/reviews)
has "$R" 'Paula Praise' "admin sees reviewer names"
RID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
R=$(curl -s -b rp.txt -X POST $B/api/admin/reviews/$RID/toggle)
has "$R" 'Admin only' "non-admin can't moderate"
R=$(curl -s -b ra.txt -X POST $B/api/admin/reviews/$RID/toggle)
has "$R" '"published":0' "review hidden"
R=$(curl -s $B/api/workers/$WID)
if echo "$R" | grep -q '"shifts":1'; then ok "aggregates drop the hidden review"; else bad "aggregates still count hidden review"; fi
curl -s -b ra.txt -X POST $B/api/admin/reviews/$RID/toggle > /dev/null
R=$(curl -s $B/api/workers/$WID)
has "$R" '"shifts":2' "re-shown review counts again"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
fuser -k 3119/tcp 2>/dev/null
exit $FAIL
