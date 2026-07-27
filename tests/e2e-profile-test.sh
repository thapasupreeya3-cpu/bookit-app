#!/bin/bash
# E2E: public worker profile endpoint + profile editing (days/langs/exp)
# run from the repo root wherever this is checked out
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
B=http://localhost:3113
PASS=0; FAIL=0
ok(){ echo "  ✓ $1"; PASS=$((PASS+1)); }
bad(){ echo "  ✗ $1"; FAIL=$((FAIL+1)); }
has(){ if echo "$1" | grep -q "$2"; then ok "$3"; else bad "$3 (missing '$2' in: ${1:0:180})"; fi; }
hasnt(){ if echo "$1" | grep -q "$2"; then bad "$3 (found '$2')"; else ok "$3"; fi; }

rm -f pf.db pf.db-wal pf.db-shm pa.txt pw.txt
rm -rf ./bookit-docs ./bookit-photos
fuser -k 3113/tcp 2>/dev/null; sleep 0.4
PORT=3113 DB_PATH=./pf.db SMTP_USER=hello@bookit.life APP_URL=http://localhost:3113 ADMIN_EMAILS=boss@example.com node server.js > pf-server.log 2>&1 &
sleep 1.4

PNG="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

echo "— public profile of a seeded worker —"
SID=$(curl -s $B/api/workers | python3 -c "import json,sys; d=json.load(sys.stdin); print([w['id'] for w in d['workers'] if w['name']=='Sarah M.'][0])")
R=$(curl -s $B/api/workers/$SID)
has "$R" '"name":"Sarah M."' "profile returns Sarah"
has "$R" '"member_since"' "member_since present"
has "$R" '"completed"' "completed count present"
has "$R" '"days":\[' "availability days present"
has "$R" '"docs":\[\]' "no real docs yet → empty docs (checks strings still shown)"
R=$(curl -s -o /dev/null -w '%{http_code}' $B/api/workers/99999)
if [ "$R" = "404" ]; then ok "unknown id → 404"; else bad "unknown id ($R)"; fi

echo "— hidden worker is not public —"
R=$(curl -s -c pw.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"worker","name":"Petra Profile","email":"petra@example.com","password":"password99","suburb":"Newcastle NSW","services":["community","household"],"bio":"Line one.\nLine two."}')
NID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
R=$(curl -s -o /dev/null -w '%{http_code}' $B/api/workers/$NID)
if [ "$R" = "404" ]; then ok "pending worker → 404"; else bad "pending worker leaked ($R)"; fi

echo "— credentials appear safely after approval —"
curl -s -b pw.txt -X POST $B/api/me/documents -H 'Content-Type: application/json' -d "{\"doc_type\":\"ndis-screening\",\"check_number\":\"WSC-SECRET-99\",\"expiry_date\":\"2029-05-01\",\"file\":{\"name\":\"s.png\",\"mime\":\"image/png\",\"data\":\"$PNG\"}}" > /dev/null
DID=$(curl -s -b pw.txt $B/api/me/documents | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
curl -s -b pw.txt -X POST $B/api/me/documents -H 'Content-Type: application/json' -d '{"doc_type":"first-aid","expiry_date":"2026-01-01"}' > /dev/null   # already expired
curl -s -b pw.txt -X POST $B/api/me/documents -H 'Content-Type: application/json' -d '{"doc_type":"other","check_number":"OTH-1"}' > /dev/null
curl -s -b pw.txt -X POST $B/api/me/photo -H 'Content-Type: application/json' -d "{\"file\":{\"name\":\"p.png\",\"mime\":\"image/png\",\"data\":\"$PNG\"}}" > /dev/null
curl -s -c pa.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"participant","name":"Boss Admin","email":"boss@example.com","password":"password99"}' > /dev/null
curl -s -b pa.txt -X POST $B/api/admin/workers/$NID/approve -H 'Content-Type: application/json' -d '{}' > /dev/null
R=$(curl -s $B/api/workers/$NID)
has "$R" '"name":"Petra Profile"' "approved worker now public"
has "$R" 'NDIS Worker Screening Check' "screening listed"
has "$R" '"valid_to":"May 2029"' "expiry shown month-level only"
has "$R" '"verified":false' "not yet verified"
hasnt "$R" 'WSC-SECRET-99' "check number NEVER exposed"
hasnt "$R" '2029-05-01' "exact expiry date not exposed"
hasnt "$R" 'First Aid' "expired credential hidden"
hasnt "$R" 'OTH-1\|Other credential' "'other' docs never public"
has "$R" '/photos/' "photo url present"
curl -s -b pa.txt -X POST $B/api/admin/documents/$DID/verify > /dev/null
R=$(curl -s $B/api/workers/$NID)
has "$R" '"verified":true' "verified flag after admin NWSD check"

echo "— worker edits days / langs / exp —"
R=$(curl -s -b pw.txt -X POST $B/api/me/profile -H 'Content-Type: application/json' -d '{"bio":"Fresh bio line one.\nFresh line two.","days":[0,0,0,0,0,1,1],"langs":"English, Greek","exp":"3 yrs experience"}')
has "$R" '"ok":true' "profile save ok"
R=$(curl -s -b pw.txt $B/api/me/profile)
has "$R" '"days":\[0,0,0,0,0,1,1\]' "days round-trip"
has "$R" 'English, Greek' "langs round-trip"
has "$R" '3 yrs experience' "exp round-trip"
R=$(curl -s $B/api/workers/$NID)
has "$R" '"days":\[0,0,0,0,0,1,1\]' "public profile shows new days"
has "$R" 'English, Greek' "public profile shows langs"
has "$R" 'Fresh line two' "multi-line bio intact"
R=$(curl -s -b pw.txt -X POST $B/api/me/profile -H 'Content-Type: application/json' -d '{"bio":"Fresh bio","days":[1,1]}')
R=$(curl -s -b pw.txt $B/api/me/profile)
has "$R" '"days":\[0,0,0,0,0,1,1\]' "bad-length days ignored"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
fuser -k 3113/tcp 2>/dev/null
exit $FAIL
