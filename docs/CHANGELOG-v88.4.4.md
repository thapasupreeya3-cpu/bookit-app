# The Care Web v88.4.4 — launch checks and overnight booking prices

Apply the cumulative changed-files ZIP over v88.3.4 or v88.4.0–v88.4.3. Merge its contents into the existing repository, then redeploy. This package does not deploy the website or mark real launch evidence as complete.

## Launch checks

- Six practical areas replace the default list of 44 identical sign-off forms.
- Separate views show **Needs your action**, **Automatic checks**, **Specialist checks** and **Later improvements**. Status words accompany colours.
- All 44 original findings and their recorded reviews remain in collapsed, searchable **Audit history**. No approval is manufactured and there is no requirement to approve every audit row before bookings or invoicing work.
- Review dates are optional for launch evidence. Evidence, an active owner and confirmation of work actually performed are retained.
- Automatic monitoring distinguishes current alerts from actual browser, inbox, recovery and specialist acceptance. Outdated runtime and manual-certificate descriptions are corrected.
- The walkthrough uses the existing prelaunch website. Restore exercises use a separate temporary restore location so they cannot overwrite it.

## Overnight support and booking prices

- The booking form clearly distinguishes **Inactive overnight — sleepover** from **Hourly support — worker awake / working**. A clock time alone never selects an inactive night.
- A sleepover displays the configured flat nightly charge, both dates/times, the two included active hours and the applicable additional-support rates. Active hourly bookings display each date/time rate and the estimated total. Repeating dates are quoted individually.
- Current standard national rates in this release: sleepover **$311.79/night**; extra active support beyond the two included hours **$103.54/hour weekdays/Saturday**, **$133.50/hour Sunday**, **$163.46/hour public holidays**. These are participant charges, not worker wages.
- Quotes come from the same server pricing rules as completion. Private location details travel in a POST body. Signed price keys bind the displayed quote to creation; a changed price requires review before any booking or series is created.
- Each request saves its calculated estimate. A matching submitted quote is labelled **Price shown at booking**. Original estimates remain clearly labelled if the booking's dates/times later change.
- Quote, creation and assignment validation now agree: sleepovers are 8–10 elapsed hours crossing midnight. The 10-hour maximum is this application's standard booking limit, not an NDIS maximum. Valid earlier evening starts are allowed; an after-midnight morning booking does not become a sleepover.
- Workers record all active hours. Where more than two active hours span different additional-rate bands, they record actual support periods. The first two active hours are included chronologically; additional lines use the date/time actually delivered, including partial holidays and daylight-saving changes. Drafts preserve incomplete time entries.
- Invoice PDFs and NDIA claim exports carry the same dated extra-support lines. Previously issued invoice snapshots and historical recorded charges are preserved.
- Historical accepted bookings that the old invalid sleepover rule permitted can still be completed and documented. Their uncertain charges are explicitly held for correcting the actual arrangement, rather than silently converting the support or issuing an unsupported charge.
- Worker payroll remains separate. The two included participant-billing hours are not two unpaid worker hours. Recorded worker-share amounts are allocation estimates; reviewed payroll components remain the wage record.

## Validation and limits

Focused suites cover launch grouping/access/evidence, quote races and changed prices, flat versus hourly nights, recurrence, location permissions, draft recovery, Sunday/holiday extras, DST, legacy completion and immutable invoices. The accompanying verification report records the final release results.

Chrome refused the local preview with `ERR_BLOCKED_BY_CLIENT`; rendered layout remains unverified. No real payment, wage transfer, real email delivery, live deployment or business/specialist sign-off was performed by this update.

## Sources

- [NDIS 2026–27 Pricing Schedule](https://www.ndis.gov.au/media/8703/download?attachment=), national support items and rates.
- [NDIS detailed pricing arrangements](https://www.ndis.gov.au/media/8096/download?attachment=), sleepover and hourly pricing definitions.
- [NDIS Commission sleepover guidance](https://www.ndiscommission.gov.au/rules-and-standards/quality-practice/sleepover-shifts), active versus inactive overnight support.
- [Fair Work SCHADS hours of work](https://www.fairwork.gov.au/find-help-for/disability-support-and-aged-care-services/understanding-schads/hours-of-work-in-the-schads-award), separate employee sleepover and active-work entitlements.
