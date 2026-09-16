# v88.4.17 — Ongoing care routines

New weekly and fortnightly routines offer **Ongoing** or **On a specific date**. The previous 26-visit limit is removed for these routines.

- The first request covers up to eight weeks. A background job requests further dates as they approach, until the routine is ended or its end date is reached.
- Prices and availability are checked for each generated visit. Requests still need worker acceptance. Preview totals cover only the displayed dates.
- Repeated job runs and application restarts cannot recreate an already generated, skipped, cancelled or moved occurrence.
- Continuation issues appear inside the selected routine. Ended routines stop generating future requests. Existing finite routines keep their original behaviour.
- Future out-of-area visits can request fresh travel confirmation from Recheck these dates. The dialog names the exact dates, and approval applies only to those dates.
- Completed date-ended routines show Finished rather than Running.
- The booking form, routine view and full user guide explain the ongoing and end-date choices.

This is a changed-files update over the complete repaired v88.4.16. The source baseline was verified against GitHub commit `dfcd3e4c949766cd882e271c09711991d89808d1` before editing. The archive is checked against that exact baseline so prerequisite files are accounted for.

Merge the extracted files into the repository root, commit, confirm the GitHub check passes, then run `sudo bookit-update` on the existing Lightsail instance. Preserve runtime data and protected configuration.

The full automated suite passed, including 28 new ongoing-routine API/review scenarios and 10 upgrade checks. Source syntax, route/table inventories, guide links and archive overlay checks passed. Browser preview was blocked, so rendered appearance remains unverified. Detailed results are recorded in the package verification file. This package does not deploy itself or establish real email delivery.
