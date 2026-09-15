# v88.4.7 — Profile address, person tabs and referral progress

Current-update-only package for v88.4.6. Merge into the existing repository and redeploy. This work has not deployed the live website.

## Home address under profile

- My profile → Your details now contains Home address. The separate address tab is removed.
- Old address links redirect to the new section, including linked participant context. Booking and task links point directly to the profile section.
- Existing revision checks, private address permissions, helper access and booking location snapshots are preserved. Editing the saved address does not relocate existing visits.
- Workers retain their existing service-area settings. The participant address form is not added to worker profiles.

## Next actions by person

- Within Office actions, Waiting on people and Website checks, select a person to see their tasks in compact categories.
- Tabs include the role, account ID and task count, so two people with the same name remain separate.
- Twelve people appear per page. Within a person, Training, Documents & checks, Invoices & pay and other categories show up to eight tasks per page.
- Grouping happens before pagination, so a selected person's full checklist remains accessible beyond the previous 100-row limit.
- Search opens the category and page containing a match. Due dates, urgency labels, next steps, direct action links and office assignment controls remain available.
- Keyboard navigation and late-response checks protect the selected view and person.

## Referral attribution and hours

- Fixed the worker application: it now captures the referral link's code, shows an editable optional field and sends the code with signup. Previously the registration backend supported referrals but the application did not send the code.
- A successful signup validates the code and records the referring account and new worker together. Invalid supplied codes receive a clear correction message. A blank code is optional.
- The same browser session remembers the code for up to seven days. Another device or browser needs the link or code again. Link clicks alone do not record a referral; historical signups with missing codes are not automatically attributed.
- Refer a friend and My earnings show recorded referrals, completed qualifying hours, the target, remaining hours and payroll/payment status. Office referrals show the same current progress.
- Existing qualification rules are preserved: completed ordinary shifts count. Sleepovers, meet-and-greets, cancelled/unfinished work, voided entries and non-shift lines do not. Participant approval and customer payment are not required for these hours.
- The default target is 50 hours and bonus is $150, controlled by existing settings. Eligibility is separate from actual payroll payment. Corrections below the target show a review state and retain recorded payment evidence.
- Referrers see their own referrals with abbreviated names and aggregate progress. The office retains its authorised detailed view.

## Installation and checks

The only supported base for this small ZIP is v88.4.6. Schema 88404, the existing tables, invoice snapshots and payment records are retained; there are no new tables. The full source manifest describes the installed tree, while the ZIP contains only changed files. Unchanged media and earlier audit appendices are excluded.

The guide is updated for all three changes. Automated results and exact ZIP-overlay verification are recorded in the accompanying report. UI checks use local markup and interaction harnesses; rendered browser appearance remains unverified. No real emails, payments or wage transfers were performed.
