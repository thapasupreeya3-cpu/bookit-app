# The Care Web v88.3.1 — billing flow fix

The reported test shift was held because v88.3.0 required a recorded price/agreement review and holiday coverage but gave the office no direct way to resolve them from Claims. The page also read obsolete response field names after Run claims & invoices, which could throw an error after the server had already processed the run.

## Changes

- Added **Admin → Money → Complete billing setup**: current stored prices, jurisdiction, holiday coverage, actual review/agreement reference, confirmation and next review date in one compact expandable panel.
- Supplied NSW state-wide public holidays for 2026–27, including additional ANZAC and substitute Christmas/Boxing Day dates. Existing custom calendars are preserved. Local holidays and other jurisdictions must be checked by the operator.
- Save records A09 review and configuration atomically. Stale browser submissions cannot overwrite a newer review. Installing the update does not create an approval or run an invoice.
- Clear **Ready to process** and **Waiting / needs attention** counts and totals; totals include applicable extras. Unapproved timesheets remain waiting.
- Setup holds have a short label and direct setup action. A valid support item is no longer outlined red for unrelated setup holds.
- Exceptional charges link to the particular visit’s review, with a return link to Claims. Holidays, midnight/time-band changes, travel, sleepovers, shared support and cancellations retain review requirements.
- Corrected the claims result handler to use the server’s actual `ndiaClaimed`, `invoices` and `needs` results. It reports **invoice created; email queued**, never an unverified “emailed” success.
- Disabled the run button when no shifts are ready. Claims fetch failures show Retry instead of pretending the queue is empty.
- Changed holiday/rule configuration invalidates previous unissued calculations; old line reviews cannot bypass expired global approval. Issued invoice snapshots remain unchanged.
- Updated the complete HTML user guide and generated handover/route inventory. Existing branding, files and vendor assets are unchanged.

## Apply and resolve the test shift

1. Extract **The-Care-Web-v88.3.1-billing-flow-fix-only.zip** and merge its contents into the existing **v88.3.0** repository root. Replace matching files; retain existing folders and runtime data. Redeploy and refresh. No source deletion is required.
2. Open **Admin → Money → Complete billing setup**. Check the actual finance review, prices/service agreements and applicable holiday coverage, enter its reference, and save the confirmation. This replaces the former two-screen setup process.
3. The reported ordinary approved Saturday shift should then appear under **Ready to process** if its other checks are clear. Use **Run claims & invoices** or the existing nightly invoice process.
4. Follow **Check email delivery** for transport state. Invoice creation, email delivery and payment are distinct. This ZIP does not configure your email provider or verify delivery to a real recipient.

The reported $310.62 is three hours at the stored Saturday personal-care rate of $103.54, item `01_013_0107_1_1`, consistent with the published 2026–27 schedule. This calculation does not certify the actual support entitlement or service agreement. [NDIS schedule](https://www.ndis.gov.au/media/8703/download?attachment=)

Calendar source: [NSW Government public holidays](https://www.nsw.gov.au/about-nsw/public-holidays), checked 12 September 2026. The August bank-only holiday is excluded. Applicable local holidays still require service-area review. Price source and future updates: [NDIS pricing arrangements](https://www.ndis.gov.au/providers/pricing-and-payments/pricing/pricing-arrangements).

## Validation

- Full automated regression suite passed, including **12 new billing scenarios**.
- The screenshot’s three-hour Saturday fixture produced one $310.62 invoice snapshot and one queued email. Repeated/concurrent runs did not duplicate either.
- Executed the shipped setup form and actual claims button handler against real local API responses. Covered unauthorised access, missing confirmation, invalid dates, stale submissions, pending timesheets, holidays/boundaries, expired reviews, changed calendars and retained invoice snapshots.
- Two boots upgrading a synthetic v88.3.0 database preserved account, document, review and setting records plus uploaded bytes; integrity and foreign-key checks passed. Schema remains **88300**, with 91 tables and 383 routes.
- Tests ran on Node **24.19.0**; the declared Node 22 production runtime remains a staging check. Chrome returned **ERR_BLOCKED_BY_CLIENT** for the local site, so rendered layout and deployed email/payment integrations remain unverified. No live database, real invoice or message recipient was used.

The ZIP includes the full guide at `docs/USER-GUIDE.html`, validation receipts and this changelog. Earlier launch-acceptance tasks remain documented in `docs/LAUNCH-ACCEPTANCE.md`.
