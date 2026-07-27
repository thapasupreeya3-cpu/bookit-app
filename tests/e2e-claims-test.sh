#!/bin/bash
# E2E: payment automation vs official 2026-27 Pricing Schedule (v1.2) items
# run from the repo root wherever this is checked out
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
B=http://localhost:3100
PASS=0; FAIL=0
ok(){ echo "  ✓ $1"; PASS=$((PASS+1)); }
bad(){ echo "  ✗ $1"; FAIL=$((FAIL+1)); }
has(){ if echo "$1" | grep -q "$2"; then ok "$3"; else bad "$3 (missing '$2' in: ${1:0:180})"; fi; }
hasnt(){ if echo "$1" | grep -q "$2"; then bad "$3 (found '$2')"; else ok "$3"; fi; }

rm -f test.db test.db-wal test.db-shm ca.txt c1.txt c2.txt c3.txt c4.txt cw.txt
fuser -k 3100/tcp 2>/dev/null; sleep 0.4
PORT=3100 DB_PATH=./test.db SMTP_USER=hello@bookit.life APP_URL=http://localhost:3100 ADMIN_EMAILS=boss@example.com BANK_DETAILS='BSB 000-000 Acct 12345678' node server.js > test-server.log 2>&1 &
sleep 1.4

curl -s -c ca.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"participant","name":"Boss Admin","email":"boss@example.com","password":"password99"}' > /dev/null
curl -s -c c1.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"participant","name":"Nina Ndia","email":"nina-n@example.com","password":"password99","plan":"ndia","ndis_number":"430111222"}' > /dev/null
curl -s -c c2.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"participant","name":"Paul Plan","email":"paul-p@example.com","password":"password99","plan":"plan","ndis_number":"430333444","pm_email":"accounts@pm.example.com"}' > /dev/null
curl -s -c c3.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"participant","name":"Sal Self","email":"sal-s@example.com","password":"password99","plan":"self","ndis_number":"430555666"}' > /dev/null
curl -s -c c4.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"participant","name":"Max Missing","email":"max-m@example.com","password":"password99","plan":"ndia"}' > /dev/null
R=$(curl -s -c cw.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"worker","name":"Wanda Worker","email":"wanda@example.com","password":"password99","services":["personal-care","community","transport","employment","daily-tasks"]}')
WID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
curl -s -b ca.txt -X POST $B/api/admin/workers/$WID/approve -H 'Content-Type: application/json' -d '{"override":true}' > /dev/null

mkbk(){ # jar service date start hours [sleepover] -> id (booked+accepted+completed)
  local SL=${6:-false}
  local R=$(curl -s -b $1 -X POST $B/api/bookings -H 'Content-Type: application/json' -d "{\"worker_id\":$WID,\"service\":\"$2\",\"date\":\"$3\",\"start\":\"$4\",\"hours\":$5,\"sleepover\":$SL}")
  local ID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
  curl -s -b cw.txt -X PATCH $B/api/bookings/$ID -H 'Content-Type: application/json' -d '{"status":"accepted"}' > /dev/null
  curl -s -b cw.txt -X PATCH $B/api/bookings/$ID -H 'Content-Type: application/json' -d '{"status":"completed","note":"Shift went to plan. Support delivered as booked and everyone was settled at the end."}' > /dev/null
  echo $ID
}

echo "— official schedule categories & totals —"
K1=$(mkbk c1.txt personal-care 2026-07-20 09:00 3)      # ndia · Mon day → 01_011 · 220.74
K2=$(mkbk c2.txt community 2026-07-18 10:00 2)          # plan · Sat → 04_105 · 207.08
K3=$(mkbk c3.txt daily-tasks 2026-07-19 10:00 2)        # self · Sun SIL → 01_805 · 267.00
K4=$(mkbk c1.txt transport 2026-07-20 10:00 2)          # ndia · Mon day → 04_104 (confirm) · 147.16
K5=$(mkbk c1.txt employment 2026-07-18 10:00 2)         # ndia · Sat but FLAT → 10_016 · 167.74
K6=$(mkbk c1.txt community 2026-07-21 04:00 2)          # ndia · 4am community → coerced EVENING 04_103 · 162.14
K7=$(mkbk c1.txt personal-care 2026-07-20 22:00 8 true) # ndia · SLEEPOVER → 01_010 · flat 311.79
K8=$(mkbk c4.txt personal-care 2026-07-20 09:00 2)      # ndia but NO ndis number → needs attention

R=$(curl -s -b ca.txt $B/api/admin/claims)
has "$R" '"item":"01_011_0107_1_1"' "0107 Mon day item"
has "$R" '"item":"04_105_0125_6_1"' "0125 Saturday item"
has "$R" '"item":"01_805_0115_1_1"' "0115 SIL Sunday item (official 01_8xx set)"
has "$R" '"item":"10_016_0102_5_3"' "0102 employment flat item"
has "$R" '"item":"04_103_0125_6_1"' "4am community coerced to evening item"
has "$R" '"item":"01_010_0107_1_1"' "sleepover claims the 01_010 sleepover item"
has "$R" 'confirm the prefilled support item' "transport carries confirm note"
has "$R" 'NDIS number missing' "missing NDIS number flagged"

echo "— totals per official prices —"
BK=$(curl -s -b c1.txt $B/api/bookings)
has "$BK" '"total":311.79' "sleepover = flat \$311.79 regardless of 8 hours"
has "$BK" '"total":167.74' "employment Sat = 2 × \$83.87 flat (not Saturday rate)"
has "$BK" '"total":162.14' "community night billed at evening \$81.07 × 2"
has "$BK" '"total":147.16' "transport Mon = 2 × \$73.58"

echo "— claim run —"
R=$(curl -s -b ca.txt -X POST $B/api/admin/claims/run)
has "$R" '"ndia_claimed":5' "5 NDIA shifts claimed (incl. transport prefill + sleepover)"
has "$R" 'accounts@pm.example.com' "plan invoice to plan manager"
has "$R" 'sal-s@example.com' "self invoice to participant"
has "$R" 'NDIS number missing' "Max's line skipped with reason"
sleep 0.5
has "$(grep 'attachments: INV-' test-server.log | head -1)" 'INV-' "invoice PDFs attached"

echo "— PACE CSV (official schedule) —"
CSV=$(curl -s -b ca.txt $B/api/admin/claims/pace.csv)
N=$(echo "$CSV" | wc -l); if [ "$N" = "6" ]; then ok "5 claim lines + header"; else bad "csv lines $N (want 6)"; fi
has "$CSV" '"01_010_0107_1_1","BK'$K7'",1,,311.79,P2' "sleepover line: item 01_010, Quantity 1 Each, \$311.79"
has "$CSV" '"10_016_0102_5_3","BK'$K5'",2,,83.87,P2' "employment line: flat \$83.87 × 2h"
has "$CSV" '"04_103_0125_6_1","BK'$K6'",2,,81.07,P2' "community-night line claims evening item/price"
has "$CSV" '"04_104_0125_6_1","BK'$K4'",2,,73.58,P2' "transport line under 0125 day item"
hasnt "$CSV" 'BK'$K8 "Max's unclaimable line NOT in file"

echo "— totals + paid —"
R=$(curl -s -b ca.txt $B/api/admin/claims)
has "$R" '"claimed":1483.65' "claimed total = \$1,483.65 (all seven shifts)"
curl -s -b ca.txt -X POST $B/api/admin/claims/$K7/paid -H 'Content-Type: application/json' -d '{"paid":true}' > /dev/null
CSV=$(curl -s -b ca.txt $B/api/admin/claims/pace.csv)
hasnt "$CSV" 'BK'$K7 "paid sleepover leaves the PACE file"
R=$(curl -s -b ca.txt -X POST $B/api/admin/claims/run)
has "$R" '"ndia_claimed":0' "second run claims nothing new"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
fuser -k 3100/tcp 2>/dev/null
exit $FAIL
