# The Care Web v88.4.13 — worker task readiness

Apply this current-update-only ZIP over the uploaded **v88.4.12** repository.

The office previously received eight tasks immediately after a worker signed
up: interview, references, employment, screening status, three register checks
and activation. These were future requirements, even when the worker had
provided no evidence.

The office badge and Next actions now count reviews that can be carried out.
Missing uploads, profile details and training stay with the worker. The full
eligibility checklist retains future office requirements with a Later label
and a short explanation.

- A blank new application shows **Waiting on worker — no office action needed**.
- Uploaded files create individual document reviews without a second setup
  task for the same review.
- Recruitment tasks become available when the relevant information or previous
  review exists. The individual forms still allow reviews in any order.
- Screening confirmation waits for evidence or a check/application number.
  Register checks wait for enough identity evidence; established workers and
  previously recorded checks remain eligible for follow-up.
- Activation is offered when the prerequisite reviews are complete. Existing
  activation and booking enforcement is unchanged; nothing is approved for you.
- Manual safety restrictions, adverse screening/register outcomes and
  follow-ups needing office help remain actionable even with missing documents.
- Verification shows available reviews, worker actions and collapsed future
  office checks separately. Blank applications do not acquire automatic review
  assignments or false overdue warnings.
- Existing premature tasks reconcile automatically. Queue refresh also reacts
  to interview bookings/cancellations and changes in established work history.
- Register monitoring uses the same readiness rules, so a blank application
  does not create a second false warning elsewhere.

The user guide and installation instructions are updated. The source version is
88.4.13; the schema identifier remains 88404. Cache invalidation triggers are
installed automatically. Existing files, review history, bookings and payment
records are retained.

All changes supplied in v88.4.9–v88.4.12 are preserved, including participant
booking availability wording, worker-only referrals and the care web beside
 the participant calendar/list. The ZIP excludes unchanged media and previous
update packages.

## Validation

See TEST-RESULTS.md and the package verification report for executed checks.
New coverage exercises the API lifecycle and verification screen interactions.
The package is checked as an exact overlay on the uploaded archive.
It has not been deployed here; live browser appearance remains unverified.
