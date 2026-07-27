#!/bin/bash
# E2E: shift completion + invoicing (email off → console logging)
# run from the repo root wherever this is checked out
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
B=http://localhost:3100
PASS=0; FAIL=0
ok(){ echo "  ✓ $1"; PASS=$((PASS+1)); }
bad(){ echo "  ✗ $1"; FAIL=$((FAIL+1)); }
has(){ if echo "$1" | grep -q "$2"; then ok "$3"; else bad "$3 (missing '$2' in: ${1:0:170})"; fi; }
hasnt(){ if echo "$1" | grep -q "$2"; then bad "$3 (found '$2')"; else ok "$3"; fi; }

rm -f test.db test.db-wal test.db-shm ip.txt iw.txt ia.txt
fuser -k 3100/tcp 2>/dev/null; sleep 0.4
PORT=3100 DB_PATH=./test.db SMTP_USER=hello@bookit.life APP_URL=http://localhost:3100 ADMIN_EMAILS=boss@example.com node server.js > test-server.log 2>&1 &
sleep 1.4

# setup: admin+participant+worker(approved)
curl -s -c ia.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"participant","name":"Boss Admin","email":"boss@example.com","password":"password99"}' > /dev/null
curl -s -c ip.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"participant","name":"Pat Client","email":"pat@example.com","password":"password99"}' > /dev/null
R=$(curl -s -c iw.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"worker","name":"Wally Worker","email":"wally@example.com","password":"password99","services":["community","household"]}')
WID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
curl -s -b ia.txt -X POST $B/api/admin/workers/$WID/approve -H 'Content-Type: application/json' -d '{"override":true}' > /dev/null

book(){ # service date start hours -> booking id
  local R=$(curl -s -b ip.txt -X POST $B/api/bookings -H 'Content-Type: application/json' -d "{\"worker_id\":$WID,\"service\":\"$1\",\"date\":\"$2\",\"start\":\"$3\",\"hours\":$4}")
  echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2
}
accept(){ curl -s -b iw.txt -X PATCH $B/api/bookings/$1 -H 'Content-Type: application/json' -d '{"status":"accepted"}' > /dev/null; }
complete(){ curl -s -b iw.txt -X PATCH $B/api/bookings/$1 -H 'Content-Type: application/json' -d '{"status":"completed","note":"Support delivered as booked. Good session, nothing out of the ordinary to report."}'; }

echo "— guards —"
FUT=$(date -d '+8 days' +%Y-%m-%d)
B1=$(book community $FUT 09:00 3); accept $B1
R=$(complete $B1)
has "$R" "hasn't happened yet" "future shift can't be completed"
B2=$(book community 2026-07-20 09:00 3)   # Mon 20 Jul 2026 (past)
R=$(complete $B2)
has "$R" "isn't allowed" "can't complete a not-yet-accepted booking"
accept $B2
R=$(curl -s -b ip.txt -X PATCH $B/api/bookings/$B2 -H 'Content-Type: application/json' -d '{"status":"completed","note":"Trying to complete my own booking, which should not work."}')
has "$R" "isn't allowed" "participant can't mark completed"

echo "— rate categories —"
R=$(complete $B2)   # Mon 09:00 3h → weekday-day 3×73.58=220.74
has "$R" '"total":220.74' "Mon 9am 3h → weekday day \$220.74"
sleep 0.3
has "$(grep 'Shift completed' test-server.log | tail -1)" 'pat@example.com' "participant emailed on completion"

B3=$(book community 2026-07-21 19:00 3); accept $B3; R=$(complete $B3)   # Tue 19:00+3h ends 22:00 → evening 3×81.07=243.21
has "$R" '"total":243.21' "Tue 7pm 3h → evening \$243.21"
B4=$(book community 2026-07-21 04:00 2); accept $B4; R=$(complete $B4)   # 4am community → coerced evening 2×81.07=162.14
has "$R" '"total":162.14' "Tue 4am 2h community → coerced evening \$162.14"
B5=$(book community 2026-07-18 10:00 2); accept $B5; R=$(complete $B5)   # Sat 18 Jul 2026 → 2×103.54=207.08
has "$R" '"total":207.08' "Sat 10am 2h → Saturday \$207.08"
B6=$(book community 2026-07-19 10:00 2); accept $B6; R=$(complete $B6)   # Sun 19 Jul → 2×133.50=267
has "$R" '"total":267' "Sun 10am 2h → Sunday \$267.00"
B7=$(book household 2026-07-19 10:00 2); accept $B7; R=$(complete $B7)   # household always 60.10 → 120.20
has "$R" '"total":120.2' "household on a Sunday still cleaning rate \$120.20"

echo "— admin invoices —"
R=$(curl -s -b ip.txt $B/api/admin/invoices)
has "$R" 'Admin only' "invoices admin-gated"
R=$(curl -s -b ia.txt $B/api/admin/invoices)
has "$R" '"billed":1220.37' "totals billed sum right (220.74+243.21+162.14+207.08+267+120.20 = 1220.37)"
has "$R" 'Wally Worker' "rows carry worker name"
R=$(curl -s -b ia.txt -X POST $B/api/admin/invoices/$B2/category -H 'Content-Type: application/json' -d '{"category":"public-holiday"}')
has "$R" '"total":490.38' "override to public holiday reprices 3h → \$490.38"
R=$(curl -s -b ia.txt -X POST $B/api/admin/invoices/$B2/category -H 'Content-Type: application/json' -d '{"category":"nonsense"}')
has "$R" 'Unknown rate' "bad category rejected"

echo "— CSV export —"
CSV=$(curl -s -b ia.txt $B/api/admin/invoices.csv)
has "$CSV" 'Registration group' "csv header present"
has "$CSV" '"0125"' "registration group code in csv"
has "$CSV" '"Public holiday"' "overridden category in csv"
has "$CSV" '"490.38"' "overridden total in csv"
N=$(echo "$CSV" | grep -c 'Wally Worker')
if [ "$N" = "6" ]; then ok "6 invoice rows in csv"; else bad "expected 6 rows, got $N"; fi
R=$(curl -s -o /dev/null -w '%{http_code}' -b ip.txt $B/api/admin/invoices.csv)
if [ "$R" = "403" ]; then ok "csv admin-gated (403 for others)"; else bad "csv gate ($R)"; fi

echo "— bookings payload carries invoice fields —"
R=$(curl -s -b ip.txt $B/api/bookings)
has "$R" '"rate_category":"public-holiday"' "participant sees rate category"
has "$R" '"total":490.38' "participant sees total"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
fuser -k 3100/tcp 2>/dev/null
exit $FAIL
