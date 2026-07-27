#!/bin/bash
# E2E: credentials auto-checker + incident & complaints registers
# run from the repo root wherever this is checked out
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
B=http://localhost:3100
PASS=0; FAIL=0
ok(){ echo "  ✓ $1"; PASS=$((PASS+1)); }
bad(){ echo "  ✗ $1"; FAIL=$((FAIL+1)); }
has(){ if echo "$1" | grep -q "$2"; then ok "$3"; else bad "$3 (missing '$2' in: ${1:0:180})"; fi; }
hasnt(){ if echo "$1" | grep -q "$2"; then bad "$3 (found '$2')"; else ok "$3"; fi; }

rm -f test.db test.db-wal test.db-shm za.txt zw.txt zp.txt
rm -rf ./bookit-docs
fuser -k 3100/tcp 2>/dev/null; sleep 0.4
PORT=3100 DB_PATH=./test.db SMTP_USER=hello@bookit.life APP_URL=http://localhost:3100 ADMIN_EMAILS=boss@example.com node server.js > test-server.log 2>&1 &
sleep 1.4

curl -s -c za.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"participant","name":"Boss Admin","email":"boss@example.com","password":"password99"}' > /dev/null
R=$(curl -s -c zw.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"worker","name":"Cred Worker","email":"cred@example.com","password":"password99","services":["community"]}')
WID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
curl -s -c zp.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"participant","name":"Pat P","email":"patp@example.com","password":"password99"}' > /dev/null

# 1x1 transparent PNG base64
PNG="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

echo "— approval gate: screening + photo both required —"
R=$(curl -s -b za.txt -X POST $B/api/admin/workers/$WID/approve -H 'Content-Type: application/json' -d '{}')
has "$R" 'NDIS Worker Screening Check (nothing on file)' "approval blocked without screening"
has "$R" 'a profile photo' "approval blocked without photo"
has "$R" '"needs_override":true' "response flags override option"

echo "— worker uploads credentials —"
R=$(curl -s -b zw.txt -X POST $B/api/me/documents -H 'Content-Type: application/json' -d '{"doc_type":"ndis-screening","check_number":"WSC-12345","expiry_date":"bananas"}')
has "$R" 'Expiry date looks wrong' "bad expiry rejected"
R=$(curl -s -b zw.txt -X POST $B/api/me/documents -H 'Content-Type: application/json' -d "{\"doc_type\":\"ndis-screening\",\"check_number\":\"WSC-12345\",\"expiry_date\":\"2029-05-01\",\"file\":{\"name\":\"screening.png\",\"mime\":\"image/png\",\"data\":\"$PNG\"}}")
has "$R" '"ok":true' "screening with file uploaded"
DID=$(echo "$R" | grep -o '"id":[0-9]*' | cut -d: -f2)
R=$(curl -s -b zw.txt $B/api/me/documents)
has "$R" '"status":"valid"' "screening shows valid"
has "$R" '"has_file":true' "file stored"
R=$(curl -s -o /dev/null -w '%{http_code}' -b zw.txt $B/api/documents/$DID/file)
if [ "$R" = "200" ]; then ok "worker can view own file"; else bad "own file view ($R)"; fi
R=$(curl -s -o /dev/null -w '%{http_code}' -b zp.txt $B/api/documents/$DID/file)
if [ "$R" = "403" ]; then ok "others can't view the file"; else bad "file leak ($R)"; fi

echo "— photo upload + profile —"
R=$(curl -s -b za.txt -X POST $B/api/admin/workers/$WID/approve -H 'Content-Type: application/json' -d '{}')
has "$R" 'a profile photo' "still blocked: photo missing (screening now fine)"
hasnt "$R" 'Screening Check' "screening no longer listed as missing"
R=$(curl -s -b zp.txt -X POST $B/api/me/photo -H 'Content-Type: application/json' -d "{\"file\":{\"name\":\"p.png\",\"mime\":\"image/png\",\"data\":\"$PNG\"}}")
has "$R" 'Workers only' "participants can't upload worker photos"
R=$(curl -s -b zw.txt -X POST $B/api/me/photo -H 'Content-Type: application/json' -d "{\"file\":{\"name\":\"p.png\",\"mime\":\"image/png\",\"data\":\"$PNG\"}}")
has "$R" '"ok":true' "worker photo uploaded"
R=$(curl -s -o /dev/null -w '%{http_code}' $B/photos/$WID)
if [ "$R" = "200" ]; then ok "photo serves publicly (behind gate)"; else bad "photo serve ($R)"; fi
R=$(curl -s -b zw.txt -X POST $B/api/me/profile -H 'Content-Type: application/json' -d '{"bio":"Updated bio from test"}')
has "$R" '"ok":true' "bio saved"
R=$(curl -s -b zw.txt $B/api/me/profile)
has "$R" 'Updated bio from test' "profile GET returns bio"
has "$R" '/photos/' "profile GET returns photo url"

echo "— approval now works + verify —"
R=$(curl -s -b za.txt -X POST $B/api/admin/workers/$WID/approve -H 'Content-Type: application/json' -d '{}')
has "$R" '"ok":true' "approval passes with screening + photo"
R=$(curl -s -b za.txt -X POST $B/api/admin/documents/$DID/verify)
has "$R" '"ok":true' "admin records NWSD verification"
R=$(curl -s -b za.txt $B/api/admin/credentials)
has "$R" '"screening":"valid"' "credentials view shows valid screening"
has "$R" '/photos/' "credentials view carries photo url"
has "$R" 'Boss Admin' "verify recorded with admin name"

echo "— expiry sweep auto-hides —"
curl -s -b zw.txt -X POST $B/api/me/documents -H 'Content-Type: application/json' -d '{"doc_type":"first-aid","expiry_date":"2026-08-01"}' > /dev/null   # expiring soon
node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('./test.db');d.prepare(\"UPDATE worker_docs SET expiry_date='2026-07-01' WHERE doc_type='ndis-screening'\").run();" 2>/dev/null
R=$(curl -s -b za.txt -X POST $B/api/admin/credentials/sweep)
has "$R" '"hidden":true' "sweep auto-hid the worker with expired screening"
sleep 0.3
has "$(grep 'profile is paused' test-server.log)" 'cred@example.com' "worker emailed about the pause"
has "$(grep 'auto-hidden' test-server.log)" 'hello@bookit.life' "admin emailed about the auto-hide"
W=$(curl -s $B/api/workers)
hasnt "$W" 'Cred Worker' "hidden worker gone from Find Workers"
R=$(curl -s -b za.txt -X POST $B/api/admin/credentials/sweep)
hasnt "$R" '"hidden":true' "second sweep doesn't repeat the hide"

echo "— incident register —"
R=$(curl -s -b zw.txt -X POST $B/api/incidents -H 'Content-Type: application/json' -d '{"category":"serious-injury","description":"Participant fell in the bathroom","immediate_action":"First aid, ambulance called","participant_name":"Pat P","location":"Home"}')
has "$R" '"reportable":1' "serious injury flagged reportable"
NID=$(echo "$R" | grep -o '"id":[0-9]*' | cut -d: -f2)
has "$R" 'notify_due' "24h deadline set"
sleep 0.3
has "$(grep 'REPORTABLE INCIDENT' test-server.log)" 'hello@bookit.life' "admin urgently emailed"
R=$(curl -s -b zw.txt -X POST $B/api/incidents -H 'Content-Type: application/json' -d '{"category":"near-miss","description":"Loose rug nearly caused a trip"}')
has "$R" '"reportable":0' "near miss not reportable"
R=$(curl -s -b za.txt $B/api/admin/incidents)
has "$R" 'hours_left' "deadline countdown present"
R=$(curl -s -b zw.txt $B/api/admin/incidents)
has "$R" 'Admin only' "register admin-gated"
R=$(curl -s -b za.txt -X POST $B/api/admin/incidents/$NID -H 'Content-Type: application/json' -d '{"action":"notified"}')
has "$R" '"ok":true' "marked notified"
R=$(curl -s -b za.txt -X POST $B/api/admin/incidents/$NID -H 'Content-Type: application/json' -d '{"action":"close","lessons":"Bathroom mat replaced; falls protocol reviewed"}')
has "$R" '"ok":true' "closed with lessons"
CSV=$(curl -s -b za.txt $B/api/admin/incidents.csv)
has "$CSV" 'Bathroom mat replaced' "lessons in CSV register"
has "$CSV" '"YES"' "reportable flag in CSV"

echo "— complaints register —"
curl -s -X POST $B/api/contact -H 'Content-Type: application/json' -d '{"name":"Upset Person","email":"upset@example.com","topic":"Feedback or complaint","body":"The worker was late twice"}' > /dev/null
R=$(curl -s -b za.txt $B/api/admin/complaints)
has "$R" 'The worker was late twice' "contact-form complaint auto-registered"
CID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
R=$(curl -s -b za.txt -X POST $B/api/admin/complaints -H 'Content-Type: application/json' -d '{"source_name":"Phone Caller","channel":"phone","summary":"Invoice confusion"}')
has "$R" '"ok":true' "manual complaint logged"
R=$(curl -s -b za.txt -X POST $B/api/admin/complaints/$CID -H 'Content-Type: application/json' -d '{"action":"acknowledge"}')
has "$R" '"ok":true' "acknowledged"
R=$(curl -s -b za.txt -X POST $B/api/admin/complaints/$CID -H 'Content-Type: application/json' -d '{"action":"resolve","outcome":"Apologised; roster adjusted; participant satisfied"}')
has "$R" '"ok":true' "resolved with outcome"
CSV=$(curl -s -b za.txt $B/api/admin/complaints.csv)
has "$CSV" 'roster adjusted' "outcome in CSV register"

echo "— overview counts —"
R=$(curl -s -b za.txt $B/api/admin/overview)
has "$R" '"open_incidents":1' "one open incident (the near miss)"
has "$R" '"open_complaints":1' "one open complaint (phone one)"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
fuser -k 3100/tcp 2>/dev/null
exit $FAIL
