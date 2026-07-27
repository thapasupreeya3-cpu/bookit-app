#!/bin/bash
# E2E: Stripe card payments — checkout session on claims run, signed webhook marks paid
# run from the repo root wherever this is checked out
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
B=http://localhost:3121
PASS=0; FAIL=0
ok(){ echo "  ✓ $1"; PASS=$((PASS+1)); }
bad(){ echo "  ✗ $1"; FAIL=$((FAIL+1)); }
has(){ if echo "$1" | grep -q "$2"; then ok "$3"; else bad "$3 (missing '$2' in: ${1:0:200})"; fi; }
hasnt(){ if echo "$1" | grep -q "$2"; then bad "$3 (found '$2')"; else ok "$3"; fi; }

rm -f sp.db sp.db-wal sp.db-shm sa.txt spp.txt sw.txt
fuser -k 3121/tcp 2>/dev/null; fuser -k 3999/tcp 2>/dev/null; sleep 0.4

# mock Stripe API
node -e "
const http = require('http');
http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => raw += c);
  req.on('end', () => {
    if (req.url === '/v1/checkout/sessions' && req.method === 'POST') {
      const p = new URLSearchParams(raw);
      const auth = req.headers.authorization || '';
      if (!auth.startsWith('Bearer sk_test_')) { res.writeHead(401); return res.end(JSON.stringify({error:{message:'bad key'}})); }
      console.log('MOCK-SESSION amount=' + p.get('line_items[0][price_data][unit_amount]') + ' currency=' + p.get('line_items[0][price_data][currency]') + ' inv=' + p.get('metadata[invoice_no]') + ' email=' + p.get('customer_email'));
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ id: 'cs_test_abc123', url: 'https://checkout.stripe.com/c/pay/cs_test_abc123' }));
    } else { res.writeHead(404); res.end('{}'); }
  });
}).listen(3999, () => console.log('mock stripe up'));
" > mock-stripe.log 2>&1 &
sleep 0.8

PORT=3121 DB_PATH=./sp.db SMTP_USER=hello@bookit.life APP_URL=http://localhost:3121 ADMIN_EMAILS=boss@example.com \
  STRIPE_SECRET_KEY=sk_test_fake123 STRIPE_WEBHOOK_SECRET=whsec_testsecret9 STRIPE_API_URL=http://localhost:3999 \
  node server.js > sp-server.log 2>&1 &
sleep 1.4
TODAY=$(date +%F)

echo "— set up a completed self-managed shift —"
R=$(curl -s -c sw.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"worker","name":"Card Worker","email":"cardw@example.com","password":"password99","services":["community"]}')
WID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
curl -s -c spp.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"participant","name":"Selma Selfmanaged","email":"selma@example.com","password":"password99","plan":"self","ndis_number":"430111222"}' > /dev/null
curl -s -c sa.txt -X POST $B/api/register -H 'Content-Type: application/json' -d '{"role":"participant","name":"Boss","email":"boss@example.com","password":"password99"}' > /dev/null
curl -s -b sa.txt -X POST $B/api/admin/workers/$WID/approve -H 'Content-Type: application/json' -d '{"override":true}' > /dev/null
R=$(curl -s -b spp.txt -X POST $B/api/bookings -H 'Content-Type: application/json' -d "{\"worker_id\":$WID,\"service\":\"community\",\"date\":\"$TODAY\",\"start\":\"09:00\",\"hours\":2}")
BID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
curl -s -b sw.txt -X PATCH $B/api/bookings/$BID -H 'Content-Type: application/json' -d '{"status":"accepted"}' > /dev/null
curl -s -b sw.txt -X PATCH $B/api/bookings/$BID -H 'Content-Type: application/json' -d '{"status":"completed","note":"Two hours out in the community. All good, home on time and happy."}' > /dev/null

echo "— claims run creates a checkout session —"
R=$(curl -s -b sa.txt -X POST $B/api/admin/claims/run)
has "$R" '"ok":true' "claims run ok"
has "$R" '"invoices":\[{' "an invoice went out"
sleep 0.4
has "$(cat mock-stripe.log)" 'MOCK-SESSION' "Stripe API was called"
has "$(cat mock-stripe.log)" 'currency=aud' "currency is AUD"
INVNO=$(grep -o 'inv=INV-[A-Z0-9-]*' mock-stripe.log | head -1 | cut -d= -f2)
if [ -n "$INVNO" ]; then ok "invoice number in metadata ($INVNO)"; else bad "invoice metadata missing"; fi
has "$(cat mock-stripe.log)" 'email=selma@example.com' "customer email attached"
AMT=$(grep -o 'amount=[0-9]*' mock-stripe.log | head -1 | cut -d= -f2)
R=$(curl -s -b sa.txt $B/api/admin/claims)
has "$R" 'checkout.stripe.com' "pay_url stored on the booking"
TOTAL_CENTS=$(echo "$R" | python3 -c "import json,sys; d=json.load(sys.stdin); print(int(round(d['claimed'][0]['total']*100)))")
if [ "$AMT" = "$TOTAL_CENTS" ]; then ok "charged amount matches invoice total (${AMT}c)"; else bad "amount mismatch: session=$AMT invoice=$TOTAL_CENTS"; fi
has "$(grep "Invoice INV" sp-server.log | grep selma@example.com)" 'checkout.stripe.com' "invoice email carries the pay-by-card link"

echo "— webhook: bad signature rejected —"
EVENT="{\"type\":\"checkout.session.completed\",\"data\":{\"object\":{\"id\":\"cs_test_abc123\",\"metadata\":{\"invoice_no\":\"$INVNO\"}}}}"
R=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/stripe/webhook -H 'Content-Type: application/json' -H 'stripe-signature: t=1,v1=deadbeef' -d "$EVENT")
if [ "$R" = "400" ]; then ok "forged signature → 400"; else bad "forged signature accepted ($R)"; fi
R=$(curl -s -b sa.txt $B/api/admin/claims)
hasnt "$R" '"claim_status":"paid"' "booking still unpaid after forged webhook"

echo "— webhook: properly signed marks paid —"
T=$(date +%s)
SIG=$(printf '%s' "$T.$EVENT" | openssl dgst -sha256 -hmac 'whsec_testsecret9' -hex | sed 's/^.* //')
R=$(curl -s -X POST $B/api/stripe/webhook -H 'Content-Type: application/json' -H "stripe-signature: t=$T,v1=$SIG" -d "$EVENT")
has "$R" '"received":true' "signed webhook accepted"
R=$(curl -s -b sa.txt $B/api/admin/claims)
has "$R" '"claim_status":"paid"' "booking marked paid automatically"
sleep 0.3
has "$(grep 'Card payment received' sp-server.log)" 'hello@bookit.life' "admin emailed about the card payment"
R=$(curl -s -X POST $B/api/stripe/webhook -H 'Content-Type: application/json' -H "stripe-signature: t=$T,v1=$SIG" -d "$EVENT")
has "$R" '"received":true' "replayed webhook is a harmless no-op"

echo "— gate never blocks the webhook —"
fuser -k 3121/tcp 2>/dev/null; sleep 0.4
PORT=3121 DB_PATH=./sp.db SITE_PASSWORD=locked123 STRIPE_SECRET_KEY=sk_test_fake123 STRIPE_WEBHOOK_SECRET=whsec_testsecret9 STRIPE_API_URL=http://localhost:3999 node server.js > sp2-server.log 2>&1 &
sleep 1.2
T2=$(date +%s)
SIG2=$(printf '%s' "$T2.$EVENT" | openssl dgst -sha256 -hmac 'whsec_testsecret9' -hex | sed 's/^.* //')
R=$(curl -s -X POST $B/api/stripe/webhook -H 'Content-Type: application/json' -H "stripe-signature: t=$T2,v1=$SIG2" -d "$EVENT")
has "$R" '"received":true' "webhook passes through the SITE_PASSWORD gate"

echo "— feature dormant without keys —"
fuser -k 3121/tcp 2>/dev/null; sleep 0.4
rm -f sp3.db sp3.db-wal sp3.db-shm
PORT=3121 DB_PATH=./sp3.db SMTP_USER=hello@bookit.life ADMIN_EMAILS=boss@example.com node server.js > sp3-server.log 2>&1 &
sleep 1.2
R=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/stripe/webhook -H 'stripe-signature: t=1,v1=x' -d '{}')
if [ "$R" = "400" ]; then ok "webhook refuses everything when no secret is set"; else bad "webhook without secret ($R)"; fi

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
fuser -k 3121/tcp 2>/dev/null; fuser -k 3999/tcp 2>/dev/null
rm -f sp2-server.log sp3-server.log sp3.db* mock-stripe.log
exit $FAIL
