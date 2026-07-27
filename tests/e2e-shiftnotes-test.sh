#!/bin/bash
# E2E: shift notes — the record that a support was actually delivered.
# No note → no completion → no invoice line → no claim. Notes are append-only:
# a correction is an addendum, never an edit, because a progress note that can be
# quietly rewritten afterwards is not evidence of anything.
# run from the repo root wherever this is checked out
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
B=http://localhost:3128
PASS=0; FAIL=0
ok(){ echo "  ✓ $1"; PASS=$((PASS+1)); }
bad(){ echo "  ✗ $1"; FAIL=$((FAIL+1)); }
has(){ if echo "$1" | grep -q "$2"; then ok "$3"; else bad "$3 (missing '$2' in: ${1:0:200})"; fi; }
hasnt(){ if echo "$1" | grep -q "$2"; then bad "$3 (found '$2')"; else ok "$3"; fi; }
J(){ curl -s -H 'Content-Type: application/json' "$@"; }

rm -f sn.db sn.db-wal sn.db-shm sna.txt snp.txt snw.txt snx.txt snz.txt
fuser -k 3128/tcp 2>/dev/null; sleep 0.4
PORT=3128 DB_PATH=./sn.db SEED_DEMO=off SMTP_USER=hello@bookit.life APP_URL=http://localhost:3128 ADMIN_EMAILS=boss@example.com node server.js > sn-server.log 2>&1 &
sleep 1.4
TODAY=$(date +%F)

echo "— set up a worker, a participant, an admin and an accepted shift —"
R=$(J -c snw.txt -X POST $B/api/register -d '{"role":"worker","name":"Nora Notes","email":"nora@example.com","password":"password99","services":["household","community"]}')
WID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
J -c snp.txt -X POST $B/api/register -d '{"role":"participant","name":"Peta Person","email":"peta@example.com","password":"password99"}' > /dev/null
J -c sna.txt -X POST $B/api/register -d '{"role":"participant","name":"Boss","email":"boss@example.com","password":"password99"}' > /dev/null
J -c snx.txt -X POST $B/api/register -d '{"role":"participant","name":"Nosy Stranger","email":"nosy@example.com","password":"password99"}' > /dev/null
J -c snz.txt -X POST $B/api/register -d '{"role":"worker","name":"Owen Otherworker","email":"owen@example.com","password":"password99","services":["household"]}' > /dev/null
J -b sna.txt -X POST $B/api/admin/workers/$WID/approve -d '{"override":true}' > /dev/null
R=$(J -b snp.txt -X POST $B/api/bookings -d "{\"worker_id\":$WID,\"service\":\"household\",\"date\":\"$TODAY\",\"start\":\"09:00\",\"hours\":2}")
BID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
J -b snw.txt -X PATCH $B/api/bookings/$BID -d '{"status":"accepted"}' > /dev/null

echo "— the shift cannot be completed without a note —"
R=$(J -b snw.txt -X PATCH $B/api/bookings/$BID -d '{"status":"completed"}')
has "$R" 'Please write a shift note' "no note is refused"
R=$(J -b snw.txt -X PATCH $B/api/bookings/$BID -d '{"status":"completed","note":"   "}')
has "$R" 'Please write a shift note' "whitespace-only note is refused"
R=$(J -b snw.txt -X PATCH $B/api/bookings/$BID -d '{"status":"completed","note":"all good"}')
has "$R" 'A few more words' "an eight-character note is refused"
R=$(J -b snw.txt $B/api/bookings)
has "$R" '"status":"accepted"' "a refused completion leaves the shift accepted"
R=$(J -b sna.txt $B/api/admin/invoices)
hasnt "$R" '"booking_id":'"$BID" "and no invoice line was created"

echo "— flagging out of scope needs to say what was asked —"
R=$(J -b snw.txt -X PATCH $B/api/bookings/$BID -d '{"status":"completed","note":"Fortnightly shop and put the groceries away together.","scope":true,"scope_detail":"eh"}')
has "$R" 'Tell us what you were asked to do' "a bare flag with no detail is refused"

echo "— a real note completes the shift and prices it —"
R=$(J -b snw.txt -X PATCH $B/api/bookings/$BID -d '{"status":"completed","note":"Arrived 9am. We did the fortnightly shop and put it all away. Peta managed the trolley herself today, which is new. Home and settled by 11."}')
has "$R" '"ok":true' "the shift completes"
has "$R" '"unit_price"' "an invoice line is born at the same moment"
R=$(J -b snp.txt $B/api/bookings)
has "$R" '"note_count":1' "the bookings list carries the note count"
sleep 0.3
has "$(grep 'Shift completed' sn-server.log | tail -1)" 'peta@example.com' "participant told the shift is done"
hasnt "$(grep -c 'Out-of-scope request flagged' sn-server.log)" '^[1-9]' "no out-of-scope alert for an ordinary shift"

echo "— who may read it —"
R=$(J -b snp.txt $B/api/bookings/$BID/notes)
has "$R" 'fortnightly shop' "the participant reads what was written about them"
has "$R" '"worker_name":"Nora Notes"' "the note is attributed"
R=$(J -b snw.txt $B/api/bookings/$BID/notes)
has "$R" 'fortnightly shop' "the worker can re-read their own note"
R=$(J -b sna.txt $B/api/bookings/$BID/notes)
has "$R" 'fortnightly shop' "admin can read it"
R=$(J -b snx.txt $B/api/bookings/$BID/notes)
has "$R" "isn't your booking" "an unrelated participant cannot"
R=$(J $B/api/bookings/$BID/notes)
has "$R" 'Please log in' "logged out cannot"

echo "— append-only: corrections go underneath, never over the top —"
R=$(J -b snw.txt -X POST $B/api/bookings/$BID/notes -d '{"note":"Correction — it was 10am not 9am that I arrived."}')
has "$R" '"ok":true' "an addendum is accepted"
R=$(J -b snw.txt $B/api/bookings/$BID/notes)
has "$R" 'Arrived 9am' "the original wording is untouched"
has "$R" '"addendum":1' "the correction is marked as added later"
N=$(echo "$R" | grep -o '"body"' | wc -l)
if [ "$N" = "2" ]; then ok "two entries, in the order they were written"; else bad "expected 2 entries, got $N"; fi
R=$(J -b snp.txt -X POST $B/api/bookings/$BID/notes -d '{"note":"I would like to add something to this myself."}')
has "$R" 'Only the worker' "the participant cannot write in the worker record"
R=$(J -b snz.txt -X POST $B/api/bookings/$BID/notes -d '{"note":"Adding to a shift that is nothing to do with me."}')
has "$R" 'No such booking' "another worker cannot add to it"
R=$(J -b snw.txt -X PATCH $B/api/bookings/$BID/notes -d '{"note":"Rewriting history entirely."}')
hasnt "$R" '"ok":true' "there is no route that edits a note"
R=$(J -b snw.txt -X DELETE $B/api/bookings/$BID/notes)
hasnt "$R" '"ok":true' "there is no route that deletes a note"
R=$(J -b snp.txt $B/api/bookings)
has "$R" '"note_count":2' "the count follows the addendum"

echo "— the out-of-scope flag raises the alarm —"
R=$(J -b snp.txt -X POST $B/api/bookings -d "{\"worker_id\":$WID,\"service\":\"community\",\"date\":\"$TODAY\",\"start\":\"14:00\",\"hours\":2}")
B2=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
J -b snw.txt -X PATCH $B/api/bookings/$B2 -d '{"status":"accepted"}' > /dev/null
R=$(J -b snw.txt -X PATCH $B/api/bookings/$B2 -d '{"status":"completed","note":"Afternoon at the community garden, good couple of hours.","scope":true,"scope_detail":"Her daughter asked me to flush the catheter before we left. I said I could not and rang the office."}')
has "$R" '"ok":true' "the shift still completes — flagging is not a punishment"
sleep 0.3
has "$(grep 'Out-of-scope request flagged' sn-server.log | tail -1)" 'hello@bookit.life' "the office is emailed the same day"
R=$(J -b sna.txt $B/api/admin/overview)
has "$R" '"notes_flagged":1' "the flag is waiting on the dashboard"
has "$R" '"notes_total":3' "every note is counted"

echo "— the admin queue —"
R=$(J -b snp.txt $B/api/admin/shift-notes)
has "$R" 'Admin only' "not for participants"
R=$(J -b sna.txt $B/api/admin/shift-notes)
has "$R" '"flagged_open":1' "one flag open"
has "$R" 'flush the catheter' "what was asked is quoted in full"
has "$R" '"participant_name":"Peta Person"' "the participant is named"
FIRST=$(echo "$R" | grep -o '"scope_flag":[0-9]*' | head -1 | cut -d: -f2)
if [ "$FIRST" = "1" ]; then ok "the unhandled flag sorts to the top"; else bad "flagged note is not first"; fi
NID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
R=$(J -b sna.txt -X POST $B/api/admin/shift-notes/$NID/review -d '{}')
has "$R" 'that record is the point' "closing a flag with no outcome is refused"
R=$(J -b snp.txt -X POST $B/api/admin/shift-notes/$NID/review -d '{"note":"Nothing to see here."}')
has "$R" 'Admin only' "a participant cannot close a flag"
R=$(J -b sna.txt -X POST $B/api/admin/shift-notes/999999/review -d '{"note":"Handled it."}')
has "$R" 'No such note' "unknown note refused"
R=$(J -b sna.txt -X POST $B/api/admin/shift-notes/$NID/review -d '{"note":"Rang Nora 27/07 — catheter flushing is a 0104 support and we are not registered for it. Peta being introduced to Coast Community Nursing."}')
has "$R" '"ok":true' "the outcome is recorded"
R=$(J -b sna.txt $B/api/admin/shift-notes)
has "$R" '"flagged_open":0' "the queue clears"
has "$R" 'Coast Community Nursing' "what we did about it is kept"
has "$R" '"reviewed_by":"boss@example.com"' "and who did it"
has "$R" 'flush the catheter' "closing a flag never erases what was reported"
R=$(J -b sna.txt $B/api/admin/overview)
has "$R" '"notes_flagged":0' "the dashboard tile clears too"

echo "— one participant's whole history as a file —"
PID=$(J -b snp.txt $B/api/me | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
R=$(J -b snp.txt $B/api/admin/participants/$PID/notes.csv)
has "$R" 'Admin only' "the export is admin only"
R=$(J -b sna.txt $B/api/admin/participants/999999/notes.csv)
has "$R" 'No such participant' "unknown participant refused"
R=$(J -b sna.txt $B/api/admin/participants/$PID/notes.csv)
has "$R" 'Registration group' "the export names the registration group per shift"
has "$R" '0120' "household shift exported as 0120"
has "$R" '0125' "community shift exported as 0125"
has "$R" 'fortnightly shop' "the note body is in the file"
has "$R" 'Addendum' "the correction is in the file, labelled as added later"
has "$R" 'Coast Community Nursing' "so is what the office did about the flag"
D=$(date +%d/%m/%Y)
has "$R" "$D" "dates are written the Australian way round"
N=$(echo "$R" | grep -c '^"')
if [ "$N" = "3" ]; then ok "three entries in the file — two shifts and the correction"; else bad "expected 3 CSV data rows, got $N"; fi

echo "— an ordinary worker's note count doesn't leak to the public profile —"
R=$(curl -s $B/api/workers/$WID)
hasnt "$R" 'fortnightly shop' "notes are not on the public profile"
hasnt "$R" 'flush the catheter' "and neither are the flags"

fuser -k 3128/tcp 2>/dev/null
rm -f sn.db sn.db-wal sn.db-shm sna.txt snp.txt snw.txt snx.txt snz.txt
echo
echo "RESULT: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
