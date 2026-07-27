#!/bin/bash
# E2E: Australian document catalogue — typeahead data, 100-point ID logic, validation, privacy
# run from the repo root wherever this is checked out
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
B=http://localhost:3115
PASS=0; FAIL=0
ok(){ echo "  ✓ $1"; PASS=$((PASS+1)); }
bad(){ echo "  ✗ $1"; FAIL=$((FAIL+1)); }
has(){ if echo "$1" | grep -q "$2"; then ok "$3"; else bad "$3 (missing '$2' in: ${1:0:180})"; fi; }
hasnt(){ if echo "$1" | grep -q "$2"; then bad "$3 (found '$2')"; else ok "$3"; fi; }

rm -f cat.db cat.db-wal cat.db-shm ca2.txt cw2.txt
rm -rf ./bookit-docs ./bookit-photos
fuser -k 3115/tcp 2>/dev/null; sleep 0.4
PORT=3115 DB_PATH=./cat.db SMTP_USER=hello@bookit.life APP_URL=http://localhost:3115 ADMIN_EMAILS=boss@example.com node server.js > cat-server.log 2>&1 &
sleep 1.4

PNG="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

echo "— the catalogue —"
R=$(curl -s $B/api/doc-catalog)
has "$R" 'Identity — 100 points of ID' "identity category first"
has "$R" '"key":"passport-au"' "Australian Passport present"
has "$R" '"points":70' "primary docs carry 70 points"
has "$R" '"aliases":\["drivers licence"' "licence aliases for typeahead"
has "$R" 'training.ndiscommission.gov.au' "orientation module carries its link"
has "$R" 'Blue Card in QLD' "WWCC state guidance present"

echo "— worker builds their ID —"
curl -s -c cw2.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"worker","name":"Cata Log","email":"cata@example.com","password":"password99","services":["community"]}' > /dev/null
R=$(curl -s -b cw2.txt -X POST $B/api/me/documents -H 'Content-Type: application/json' -d '{"doc_type":"passport-au","check_number":"PA1234567"}')
has "$R" '"ok":true' "passport accepted without expiry (optional)"
R=$(curl -s -b cw2.txt $B/api/me/documents)
has "$R" '"id_points":70' "70 points after passport"
has "$R" '"has_primary":true' "primary flag set"
has "$R" '"id_ok":false' "70 points is not yet 100"
has "$R" '"right_to_work":true' "Australian passport proves right to work"
R=$(curl -s -b cw2.txt -X POST $B/api/me/documents -H 'Content-Type: application/json' -d '{"doc_type":"driver-licence","check_number":"12345678","expiry_date":"2030-01-15"}')
has "$R" '"ok":true' "licence accepted"
R=$(curl -s -b cw2.txt $B/api/me/documents)
has "$R" '"id_points":110' "110 points after licence"
has "$R" '"id_ok":true' "100-point check satisfied"

echo "— validation rules —"
R=$(curl -s -b cw2.txt -X POST $B/api/me/documents -H 'Content-Type: application/json' -d '{"doc_type":"ndis-screening","check_number":"WSC-1"}')
has "$R" 'Please enter the expiry date' "screening still requires expiry"
R=$(curl -s -b cw2.txt -X POST $B/api/me/documents -H 'Content-Type: application/json' -d '{"doc_type":"qualification","check_number":"Q1"}')
has "$R" 'Give the qualification a name' "free-text qualification needs a label"
R=$(curl -s -b cw2.txt -X POST $B/api/me/documents -H 'Content-Type: application/json' -d '{"doc_type":"made-up-thing"}')
has "$R" 'Pick a document type' "unknown types rejected"
R=$(curl -s -b cw2.txt -X POST $B/api/me/documents -H 'Content-Type: application/json' -d '{"doc_type":"qualification","label":"Diploma of Nursing","check_number":"DN-22"}')
has "$R" '"ok":true' "named qualification accepted"
R=$(curl -s -b cw2.txt $B/api/me/documents)
has "$R" 'Diploma of Nursing' "custom label becomes the display label"
has "$R" '"category":"identity"' "docs carry their category for grouping"

echo "— remaining checklist items —"
curl -s -b cw2.txt -X POST $B/api/me/documents -H 'Content-Type: application/json' -d '{"doc_type":"ndis-orientation","check_number":"QSY-1"}' > /dev/null
curl -s -b cw2.txt -X POST $B/api/me/documents -H 'Content-Type: application/json' -d '{"doc_type":"resume"}' > /dev/null
curl -s -b cw2.txt -X POST $B/api/me/documents -H 'Content-Type: application/json' -d '{"doc_type":"first-aid","check_number":"FA-9","expiry_date":"2029-03-10"}' > /dev/null
R=$(curl -s -b cw2.txt $B/api/me/documents)
has "$R" '"orientation":true' "orientation ticked"
has "$R" '"resume":true' "resume ticked"
has "$R" '"first_aid":true' "first aid ticked"

echo "— privacy on the public profile —"
WID=$(curl -s -b cw2.txt $B/api/me | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
curl -s -b cw2.txt -X POST $B/api/me/documents -H 'Content-Type: application/json' -d "{\"doc_type\":\"ndis-screening\",\"check_number\":\"WSC-77\",\"expiry_date\":\"2030-06-01\",\"file\":{\"name\":\"s.png\",\"mime\":\"image/png\",\"data\":\"$PNG\"}}" > /dev/null
curl -s -b cw2.txt -X POST $B/api/me/photo -H 'Content-Type: application/json' -d "{\"file\":{\"name\":\"p.png\",\"mime\":\"image/png\",\"data\":\"$PNG\"}}" > /dev/null
curl -s -c ca2.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"participant","name":"Boss Admin","email":"boss@example.com","password":"password99"}' > /dev/null
curl -s -b ca2.txt -X POST $B/api/admin/workers/$WID/approve -H 'Content-Type: application/json' -d '{}' > /dev/null
R=$(curl -s $B/api/workers/$WID)
has "$R" 'NDIS Worker Screening Check' "screening on public profile"
has "$R" 'First Aid / CPR' "first aid on public profile"
has "$R" 'NDIS Worker Orientation Module' "orientation on public profile"
has "$R" 'Diploma of Nursing' "qualification on public profile"
hasnt "$R" 'Passport' "passport NEVER on public profile"
hasnt "$R" 'Licence\|Driver' "licence NEVER on public profile"
hasnt "$R" 'Resume' "resume NEVER on public profile"
hasnt "$R" 'PA1234567\|12345678' "no ID numbers anywhere"

echo "— admin sees the scorecard —"
R=$(curl -s -b ca2.txt $B/api/admin/credentials)
has "$R" '"id_points":110' "admin sees ID points"
has "$R" '"id_ok":true' "admin sees 100-point pass"
has "$R" '"right_to_work":true' "admin sees right to work"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
fuser -k 3115/tcp 2>/dev/null
exit $FAIL
