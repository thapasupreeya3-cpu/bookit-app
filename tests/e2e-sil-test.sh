#!/bin/bash
# E2E: SIL rosters — houses, weekly slots, idempotent booking generation, invoicing flow
# run from the repo root wherever this is checked out
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
B=http://localhost:3122
PASS=0; FAIL=0
ok(){ echo "  ✓ $1"; PASS=$((PASS+1)); }
bad(){ echo "  ✗ $1"; FAIL=$((FAIL+1)); }
has(){ if echo "$1" | grep -q "$2"; then ok "$3"; else bad "$3 (missing '$2' in: ${1:0:200})"; fi; }
hasnt(){ if echo "$1" | grep -q "$2"; then bad "$3 (found '$2')"; else ok "$3"; fi; }

rm -f sl.db sl.db-wal sl.db-shm sla.txt slp.txt slw.txt
fuser -k 3122/tcp 2>/dev/null; sleep 0.4
PORT=3122 DB_PATH=./sl.db SMTP_USER=hello@bookit.life APP_URL=http://localhost:3122 ADMIN_EMAILS=boss@example.com node server.js > sl-server.log 2>&1 &
sleep 1.4

# next Monday (UTC-safe: date only)
MON=$(python3 -c "
from datetime import date, timedelta
d = date.today()
print((d + timedelta(days=(7 - d.weekday()))).isoformat())")

echo "— setup —"
R=$(curl -s -c slw.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"worker","name":"Silvia Silworker","email":"silvia@example.com","password":"password99","services":["daily-tasks","personal-care"]}')
WID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
R=$(curl -s -c slp.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"participant","name":"Harry House","email":"harry@example.com","password":"password99","plan":"ndia","ndis_number":"430999888"}')
PID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
curl -s -c sla.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"participant","name":"Boss","email":"boss@example.com","password":"password99"}' > /dev/null
curl -s -b sla.txt -X POST $B/api/admin/workers/$WID/approve -H 'Content-Type: application/json' -d '{"override":true}' > /dev/null

echo "— access + house creation —"
R=$(curl -s -b slp.txt $B/api/admin/sil)
has "$R" 'Admin only' "non-admin blocked"
R=$(curl -s -b sla.txt -X POST $B/api/admin/sil/houses -H 'Content-Type: application/json' -d '{"name":""}')
has "$R" 'Give the house a name' "house needs a name"
R=$(curl -s -b sla.txt -X POST $B/api/admin/sil/houses -H 'Content-Type: application/json' -d '{"name":"Wattle St","address":"12 Wattle St, Gosford NSW"}')
has "$R" '"ok":true' "house created"
HID=$(echo "$R" | grep -o '"id":[0-9]*' | cut -d: -f2)

echo "— slots —"
R=$(curl -s -b sla.txt -X POST $B/api/admin/sil/slots -H 'Content-Type: application/json' -d "{\"house_id\":$HID,\"day\":9,\"start\":\"09:00\",\"hours\":4}")
has "$R" 'Pick a day' "day validated"
R=$(curl -s -b sla.txt -X POST $B/api/admin/sil/slots -H 'Content-Type: application/json' -d "{\"house_id\":$HID,\"day\":0,\"start\":\"nine\",\"hours\":4}")
has "$R" 'Start time looks wrong' "start validated"
R=$(curl -s -b sla.txt -X POST $B/api/admin/sil/slots -H 'Content-Type: application/json' -d "{\"house_id\":$HID,\"day\":0,\"start\":\"09:00\",\"hours\":4,\"service\":\"daily-tasks\",\"worker_id\":$WID,\"participant_id\":$PID}")
has "$R" '"ok":true' "Monday day slot added"
R=$(curl -s -b sla.txt -X POST $B/api/admin/sil/slots -H 'Content-Type: application/json' -d "{\"house_id\":$HID,\"day\":0,\"start\":\"22:00\",\"hours\":8,\"service\":\"daily-tasks\",\"sleepover\":true,\"worker_id\":$WID,\"participant_id\":$PID}")
has "$R" '"ok":true' "Monday sleepover slot added"
R=$(curl -s -b sla.txt -X POST $B/api/admin/sil/slots -H 'Content-Type: application/json' -d "{\"house_id\":$HID,\"day\":2,\"start\":\"10:00\",\"hours\":3,\"service\":\"daily-tasks\"}")
has "$R" '"ok":true' "unfilled Wednesday slot added (no worker yet)"
R=$(curl -s -b sla.txt $B/api/admin/sil)
has "$R" 'Wattle St' "roster lists the house"
has "$R" 'Silvia Silworker' "assigned worker named"

echo "— generation —"
R=$(curl -s -b sla.txt -X POST $B/api/admin/sil/generate -H 'Content-Type: application/json' -d '{"week_start":"2026-08-04"}')
has "$R" 'starts on a Monday' "non-Monday rejected (2026-08-04 is a Tuesday)"
R=$(curl -s -b sla.txt -X POST $B/api/admin/sil/generate -H 'Content-Type: application/json' -d "{\"week_start\":\"$MON\"}")
has "$R" '"created":2' "two filled slots became bookings"
has "$R" '"missing":"worker"' "unfilled slot reported"
R=$(curl -s -b sla.txt -X POST $B/api/admin/sil/generate -H 'Content-Type: application/json' -d "{\"week_start\":\"$MON\"}")
has "$R" '"created":0' "second run creates nothing"
has "$R" '"existing":2' "duplicates skipped"

echo "— the bookings are real —"
R=$(curl -s -b slw.txt $B/api/bookings)
has "$R" 'SIL roster — Wattle St' "worker sees the rostered shift with the house tag"
has "$R" '"status":"accepted"' "generated shifts are pre-accepted"
has "$R" "\"date\":\"$MON\"" "Monday slot landed on the Monday"
has "$R" '"sleepover":1' "sleepover flag carried through"

echo "— completion flows into invoicing (0115 pricing) —"
BID=$(echo "$R" | python3 -c "
import json,sys
d = json.load(sys.stdin)
print([b['id'] for b in d['bookings'] if not b['sleepover']][0])")
# rostered date is in the future; server allows completion on/after the date — simulate the day arriving
node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('./sl.db');db.prepare('UPDATE bookings SET date = ? WHERE id = ?').run(new Date().toISOString().slice(0,10), $BID);" 2>/dev/null
R=$(curl -s -b slw.txt -X PATCH $B/api/bookings/$BID -H 'Content-Type: application/json' -d '{"status":"completed","note":"Rostered shift at the house. Meals, medication prompts and evening routine all done as per the plan."}')
has "$R" '"ok":true' "rostered shift completes like any other"
has "$R" '"unit_price"' "invoice line priced"
R=$(curl -s -b sla.txt $B/api/admin/claims)
has "$R" 'Harry House' "shift waiting in claims for the NDIA file"

echo "— house removal keeps bookings —"
R=$(curl -s -b sla.txt -X POST $B/api/admin/sil/houses/$HID/delete)
has "$R" '"ok":true' "house removed"
R=$(curl -s -b slw.txt $B/api/bookings)
has "$R" 'SIL roster — Wattle St' "already-generated bookings survive"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
fuser -k 3122/tcp 2>/dev/null
exit $FAIL
