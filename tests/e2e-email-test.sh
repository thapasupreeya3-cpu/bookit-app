#!/bin/bash
# E2E test of the BookIt email build (SMTP off → emails logged to console)
# run from the repo root wherever this is checked out
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
B=http://localhost:3100
PASS=0; FAIL=0
ok(){ echo "  ✓ $1"; PASS=$((PASS+1)); }
bad(){ echo "  ✗ $1"; FAIL=$((FAIL+1)); }
check(){ if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 (wanted [$2] got [$1])"; fi; }
has(){ if echo "$1" | grep -q "$2"; then ok "$3"; else bad "$3 (missing '$2' in: ${1:0:160})"; fi; }

rm -f test.db test.db-wal test.db-shm gate-cookies.txt pj.txt wj.txt rj.txt
fuser -k 3100/tcp 2>/dev/null; sleep 0.4

PORT=3100 DB_PATH=./test.db SMTP_USER=hello@bookit.life APP_URL=http://localhost:3100 ADMIN_EMAILS=bee@example.com node server.js > test-server.log 2>&1 &
SRV=$!
sleep 1.4

echo "— boot —"
has "$(cat test-server.log)" "Email: OFF" "email reported OFF without SMTP_PASS"

echo "— register participant (bee@example.com) —"
R=$(curl -s -c pj.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"participant","name":"Bee Tester","email":"bee@example.com","password":"password99","suburb":"Sydney NSW"}')
has "$R" '"verified":0' "new account starts unverified"
sleep 0.3
VLINK=$(grep "Confirm your email" test-server.log | grep -o 'http://[^ ]*verify-email?token=[^ ]*' | tail -1)
has "$VLINK" 'verify-email?token=v\.' "verification email logged with v. token"

echo "— verify email via link —"
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' "$VLINK")
has "$LOC" '#/verified' "valid token redirects to #/verified"
ME=$(curl -s -b pj.txt $B/api/me)
has "$ME" '"verified":1' "user now verified"

echo "— bad verify token —"
LOC2=$(curl -s -o /dev/null -w '%{redirect_url}' "$B/verify-email?token=v.1.99999999999999.deadbeef")
has "$LOC2" '#/verify-failed' "tampered token redirects to #/verify-failed"

echo "— forgot password —"
R=$(curl -s -X POST $B/api/forgot -H 'Content-Type: application/json' -d '{"email":"bee@example.com"}')
has "$R" '"ok":true' "forgot always returns ok"
R=$(curl -s -X POST $B/api/forgot -H 'Content-Type: application/json' -d '{"email":"nobody@example.com"}')
has "$R" '"ok":true' "forgot for unknown email also ok (no enumeration)"
sleep 0.3
RTOKEN=$(grep "Reset your BookIt password" test-server.log | grep -o 'token=r\.[^ ]*' | tail -1 | sed 's/token=//')
has "$RTOKEN" '^r\.' "reset email logged with r. token"

echo "— reset password —"
R=$(curl -s -c rj.txt -X POST $B/api/reset -H 'Content-Type: application/json' -d "{\"token\":\"$RTOKEN\",\"password\":\"newpass123\"}")
has "$R" '"name":"Bee Tester"' "reset returns user + session"
R=$(curl -s -X POST $B/api/login -H 'Content-Type: application/json' -d '{"email":"bee@example.com","password":"newpass123"}')
has "$R" '"name":"Bee Tester"' "login works with NEW password"
R=$(curl -s -X POST $B/api/login -H 'Content-Type: application/json' -d '{"email":"bee@example.com","password":"password99"}')
has "$R" 'match' "old password rejected"
R=$(curl -s -X POST $B/api/reset -H 'Content-Type: application/json' -d "{\"token\":\"$RTOKEN\",\"password\":\"another123\"}")
has "$R" 'invalid or has expired' "used reset token is dead (pass changed)"

echo "— register real worker + booking emails —"
R=$(curl -s -c wj.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"worker","name":"Wendy Worker","email":"wendy@example.com","password":"password99","suburb":"Sydney NSW","services":["community"],"bio":"test"}')
WID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
has "$R" '"role":"worker"' "worker registered (id $WID)"
curl -s -b pj.txt -X POST $B/api/admin/workers/$WID/approve -H 'Content-Type: application/json' -d '{"override":true}' > /dev/null   # bee is admin; vetting covered in e2e-admin-test.sh
R=$(curl -s -b pj.txt -X POST $B/api/bookings -H 'Content-Type: application/json' -d "{\"worker_id\":$WID,\"service\":\"community\",\"date\":\"2026-08-14\",\"start\":\"09:00\",\"hours\":3}")
BID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
has "$R" '"ok":true' "booking requested (id $BID)"
sleep 0.3
has "$(grep 'New booking request' test-server.log | tail -1)" 'wendy@example.com' "worker notified of new request"
R=$(curl -s -b wj.txt -X PATCH $B/api/bookings/$BID -H 'Content-Type: application/json' -d '{"status":"accepted"}')
has "$R" '"ok":true' "worker accepted"
sleep 0.3
has "$(grep 'Booking accepted' test-server.log | tail -1)" 'bee@example.com' "participant notified of acceptance"
R=$(curl -s -b pj.txt -X PATCH $B/api/bookings/$BID -H 'Content-Type: application/json' -d '{"status":"cancelled"}')
has "$R" '"ok":true' "participant cancelled"
sleep 0.3
has "$(grep 'Booking cancelled' test-server.log | tail -1)" 'wendy@example.com' "worker notified of cancellation"

echo "— booking with DEMO worker sends nothing —"
LINES_BEFORE=$(grep -c 'email off' test-server.log)
SARAH=$(curl -s $B/api/workers | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
curl -s -b pj.txt -X POST $B/api/bookings -H 'Content-Type: application/json' -d "{\"worker_id\":$SARAH,\"service\":\"community\",\"date\":\"2026-08-15\",\"start\":\"09:00\",\"hours\":3}" > /dev/null
sleep 0.3
LINES_AFTER=$(grep -c 'email off' test-server.log)
check "$LINES_AFTER" "$LINES_BEFORE" "no email logged for @demo.bookit.life worker"

echo "— contact form copy —"
R=$(curl -s -X POST $B/api/contact -H 'Content-Type: application/json' -d '{"name":"Vis Itor","email":"vis@example.com","topic":"Pricing","body":"Hello there"}')
has "$R" '"ok":true' "contact accepted"
sleep 0.3
has "$(grep 'Contact form' test-server.log | tail -1)" 'hello@bookit.life' "copy addressed to hello@bookit.life"

echo "— email-test endpoint —"
R=$(curl -s -X POST $B/api/email-test)
has "$R" 'log in' "email-test needs login"
R=$(curl -s -b pj.txt -X POST $B/api/email-test)
has "$R" 'not configured' "email-test reports SMTP unconfigured"

echo "— demo accounts still verified + working —"
R=$(curl -s -X POST $B/api/login -H 'Content-Type: application/json' -d '{"email":"demo@demo.bookit.life","password":"demo1234"}')
has "$R" '"verified":1' "seeded demo account is verified (no banner)"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
kill $SRV 2>/dev/null
exit $FAIL
