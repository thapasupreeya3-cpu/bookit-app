#!/bin/bash
# E2E: high-intensity (0104) screening — signup declaration, self-service update,
# admin visibility and the record-the-introduction action.
# run from the repo root wherever this is checked out
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
B=http://localhost:3126
PASS=0; FAIL=0
ok(){ echo "  ✓ $1"; PASS=$((PASS+1)); }
bad(){ echo "  ✗ $1"; FAIL=$((FAIL+1)); }
has(){ if echo "$1" | grep -q "$2"; then ok "$3"; else bad "$3 (missing '$2' in: ${1:0:200})"; fi; }
hasnt(){ if echo "$1" | grep -q "$2"; then bad "$3 (found '$2')"; else ok "$3"; fi; }
J(){ curl -s -H 'Content-Type: application/json' "$@"; }

rm -f hi.db hi.db-wal hi.db-shm ha.txt hp.txt hq.txt hw.txt
fuser -k 3126/tcp 2>/dev/null; sleep 0.4
PORT=3126 DB_PATH=./hi.db SEED_DEMO=off ADMIN_EMAILS=boss@example.com node server.js > hi-server.log 2>&1 &
sleep 1.4

echo "— the public list of what we don't deliver —"
R=$(curl -s $B/api/high-intensity)
has "$R" 'Complex bowel care' "bowel care listed"
has "$R" 'PEG or tube' "enteral feeding listed"
has "$R" 'Dysphagia' "dysphagia listed"
has "$R" 'Ventilator support' "ventilator listed"
has "$R" 'Tracheostomy' "tracheostomy listed"
has "$R" 'inserting, changing or irrigating' "catheter label is qualified, not bare 'catheter'"
has "$R" 'Subcutaneous injections' "injections listed"
has "$R" 'Complex wound management' "wound care listed"
N=$(echo "$R" | grep -o '"key"' | wc -l)
if [ "$N" = "8" ]; then ok "exactly 8 supports (Module 1 has 8)"; else bad "expected 8 supports, got $N"; fi

echo "— signup without any declaration —"
J -c hq.txt -X POST $B/api/register -d '{"role":"participant","name":"Quiet Person","email":"quiet@example.com","password":"password99","suburb":"Wyong","services":["household"]}' > /dev/null
R=$(curl -s -b hq.txt $B/api/me)
has "$R" '"hi_flags":\[\]' "clean participant has an empty declaration"

echo "— signup that declares two Module 1 supports —"
J -c hp.txt -X POST $B/api/register -d '{"role":"participant","name":"Ada Flagged","email":"ada@example.com","password":"password99","suburb":"Tuggerah","phone":"0400111222","services":["personal-care","community"],"hi_flags":["enteral","bowel"]}' > /dev/null
R=$(curl -s -b hp.txt $B/api/me)
has "$R" 'enteral' "enteral flag saved on the account"
has "$R" 'bowel' "bowel flag saved on the account"
has "$R" '"hi_at":"20' "declaration is dated"

echo "— junk and non-Module-1 values are dropped —"
J -c hw.txt -X POST $B/api/register -d '{"role":"participant","name":"Junk Tester","email":"junk@example.com","password":"password99","hi_flags":["bowel","showering","<script>","bowel"]}' > /dev/null
R=$(curl -s -b hw.txt $B/api/me)
has "$R" 'bowel' "valid key kept"
hasnt "$R" 'showering' "unknown key rejected"
hasnt "$R" 'script' "injected value rejected"
N=$(echo "$R" | grep -o 'bowel' | wc -l)
if [ "$N" = "1" ]; then ok "duplicate keys de-duplicated"; else bad "expected 1 'bowel', got $N"; fi

echo "— participant services are no longer discarded —"
R=$(curl -s -b ha.txt $B/api/me)
J -c ha.txt -X POST $B/api/register -d '{"role":"participant","name":"Boss","email":"boss@example.com","password":"password99"}' > /dev/null
R=$(curl -s -b ha.txt $B/api/admin/overview)
has "$R" 'personal-care' "what a flagged participant asked for is visible to admin"

echo "— admin sees the enquiry —"
has "$R" '"hi_open":' "open count present"
has "$R" 'Ada Flagged' "flagged participant listed"
has "$R" 'PEG or tube' "human-readable labels supplied, not raw keys"
has "$R" '"hi_referred_at":""' "starts as not-yet-handled"
hasnt "$R" 'Quiet Person"[^}]*"hi_labels"' "unflagged participant not in the enquiry list"

echo "— a worker cannot declare, and cannot be flagged —"
J -c hw.txt -X POST $B/api/register -d '{"role":"worker","name":"Wendy Worker","email":"wendy@example.com","password":"password99","hi_flags":["bowel"]}' > /dev/null
R=$(curl -s -b hw.txt -X POST $B/api/me/high-intensity -H 'Content-Type: application/json' -d '{"hi_flags":["bowel"]}')
has "$R" 'Only participants' "worker blocked from the declaration endpoint"

echo "— logged out is refused —"
R=$(J -X POST $B/api/me/high-intensity -d '{"hi_flags":["bowel"]}')
has "$R" 'Please log in' "anonymous blocked"

echo "— participant updates the declaration themselves —"
R=$(curl -s -b hp.txt -X POST $B/api/me/high-intensity -H 'Content-Type: application/json' -d '{"hi_flags":["catheter"]}')
has "$R" 'catheter' "new flag saved"
hasnt "$R" 'enteral' "removed flag is gone"
R=$(curl -s -b hp.txt -X POST $B/api/me/high-intensity -H 'Content-Type: application/json' -d '{"hi_flags":["catheter"]}')
has "$R" '"unchanged":true' "resubmitting the same set is a no-op"
R=$(curl -s -b hp.txt -X POST $B/api/me/high-intensity -H 'Content-Type: application/json' -d '{"hi_flags":[]}')
has "$R" '"flagged":false' "clearing every box clears the flag"
R=$(curl -s -b hp.txt -X POST $B/api/me/high-intensity -H 'Content-Type: application/json' -d '{"hi_flags":["bowel"]}')
has "$R" '"flagged":true' "re-declaring flags again"

echo "— recording the introduction —"
PID=$(curl -s -b ha.txt $B/api/admin/overview | grep -o '{"id":[0-9]*,"name":"Ada Flagged"' | grep -o '[0-9]*' | head -1)
R=$(curl -s -b hp.txt -X POST $B/api/admin/participants/$PID/high-intensity -H 'Content-Type: application/json' -d '{"note":"x"}')
has "$R" 'Admin only' "non-admin cannot record a referral"
R=$(curl -s -b ha.txt -X POST $B/api/admin/participants/$PID/high-intensity -H 'Content-Type: application/json' -d '{}')
has "$R" 'that line is the record' "a referral with no note is refused"
R=$(curl -s -b ha.txt -X POST $B/api/admin/participants/999999/high-intensity -H 'Content-Type: application/json' -d '{"note":"hello"}')
has "$R" 'not found' "unknown participant refused"
R=$(curl -s -b ha.txt -X POST $B/api/admin/participants/$PID/high-intensity -H 'Content-Type: application/json' -d '{"note":"Called 21/07 — introduced to Coast Community Nursing, Ada is contacting them direct. We keep her community access shifts."}')
has "$R" '"ok":true' "referral recorded"
R=$(curl -s -b ha.txt $B/api/admin/overview)
has "$R" 'Coast Community Nursing' "the note is kept as the record"
has "$R" 'bowel' "the declaration itself is NOT erased by recording a referral"
has "$R" '"hi_open":1' "handled enquiry drops out of the open count (only Junk Tester left)"

echo "— clearing a mis-tick —"
R=$(curl -s -b ha.txt -X POST $B/api/admin/participants/$PID/high-intensity -H 'Content-Type: application/json' -d '{"clear":true}')
has "$R" 'why it is being cleared' "clearing with no reason is refused"
R=$(curl -s -b ha.txt -X POST $B/api/admin/participants/$PID/high-intensity -H 'Content-Type: application/json' -d '{"clear":true,"note":"Ticked in error — Ada manages her own bowel care, confirmed by phone 21/07."}')
has "$R" '"cleared":true' "cleared with a reason"
R=$(curl -s -b ha.txt $B/api/admin/overview)
has "$R" 'Ticked in error' "the reason is kept — the row is not deleted"
has "$R" 'declaration since cleared\|"hi_labels":\[\]' "the cleared row survives with no flags on it"
JID=$(echo "$R" | grep -o '{"id":[0-9]*,"name":"Junk Tester"' | grep -o '[0-9]*' | head -1)
curl -s -b ha.txt -X POST $B/api/admin/participants/$JID/high-intensity -H 'Content-Type: application/json' -d '{"note":"Called 21/07 — introduced to Coast Community Nursing."}' > /dev/null
R=$(curl -s -b ha.txt $B/api/admin/overview)
has "$R" '"hi_open":0' "with every enquiry handled the open count reaches zero"

echo "— nothing anywhere can claim a 0104 support item —"
R=$(grep -c '_0104_' server.js || true)
if [ "$R" = "0" ]; then ok "no 0104 support item code exists in the pricing engine"; else bad "a 0104 item code appears $R times in server.js"; fi

fuser -k 3126/tcp 2>/dev/null
rm -f hi.db hi.db-wal hi.db-shm ha.txt hp.txt hq.txt hw.txt
echo
echo "RESULT: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
