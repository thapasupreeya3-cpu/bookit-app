# The Care Web — Admin navigation

Version 88.4.2 organises office work into seven sections. Each tool has a focused page and the same Admin navigation. This change reorganises screens and record lists; it does not change permissions, financial rules or automatic processing.

## Find a tool or a record

**Find an admin tool** searches the names and descriptions below. Choose a result to open that tool. Escape clears the search; Arrow Down moves focus to the first result. On smaller screens, expand **Admin menu**.

Record search is separate: use the search inside Invoices, Received payments, Email delivery or another list to filter that page’s returned records. **Previous** and **Next** page through the filtered results. Search and pagination never submit an approval, save a form or move money.

## Office sections and routes

### Today

| Tool | Use it for | Route |
|---|---|---|
| Overview | Find a task and see current office totals. | `#/admin` |
| Next actions | Office actions, waiting on people and website alerts. | `#/journey?panel=tasks` |
| Contact messages | Read enquiries sent through the website. | `#/admin/today?section=contacts` |
| Email delivery | Check delivery results and retry failed messages. | `#/journey?panel=deliveries` |
| Website alerts | Investigate operational issues and record follow-up. | `#/admin/assurance?tab=operations` |

### People

| Tool | Use it for | Route |
|---|---|---|
| People directory | Find an account and manage its visibility. | `#/admin/people` |
| Verification | Review worker and participant documents and checks. | `#/admin/verification` |
| Recruitment | Applications, interviews and worker checks. | `#/journey?panel=recruitment` |
| Add participant | Open an account with recorded consent. | `#/admin/people?section=add` |
| Worker referrals | Review qualification and record referral payments. | `#/admin/people?section=referrals` |
| Reviews | Show or hide published feedback. | `#/admin/people?section=reviews` |
| Onboarding progress | Track the steps before a first shift. | `#/admin/people?section=pipeline` |
| Additional worker checks | Legacy screening and evidence controls. | `#/admin/compliance?section=workers` |
| Participant records | Participant files and support plans. | `#/admin/compliance?section=participants` |

### Bookings

| Tool | Use it for | Route |
|---|---|---|
| Booking list | Find a recent shift and open its details. | `#/admin/bookings` |
| Find cover | Respond when a worker cannot attend. | `#/admin/bookings?section=cover` |
| Shared living rosters | Manage houses and repeating rosters. | `#/admin/bookings?section=rosters` |
| Group bookings | Link or separate shared shifts. | `#/admin/bookings?section=groups` |
| Support changes | Review changes, handovers and affected bookings. | `#/journey?panel=transitions` |
| Support arrangements | Record arrangements for excluded activities. | `#/admin/assurance?tab=handoffs` |

### Money

| Tool | Use it for | Route |
|---|---|---|
| Invoices | View balances, payment status and invoice actions. | `#/payment-tracking?tab=invoices` |
| Received payments | Match bank receipts to the correct invoices. | `#/payment-tracking?tab=receipts` |
| Payment exceptions | Resolve payment failures and unmatched events. | `#/payment-tracking?tab=exceptions` |
| NDIA claims | Download claim files and record confirmed claim payments. | `#/admin/money?section=claims` |
| Unissued charges | Review completed shifts waiting for processing. | `#/admin/money?section=unissued` |
| Invoice history & withdrawal | Withdraw an invoice, check notices and review history. | `#/admin/money?section=history` |
| Additional charges | Record eligible establishment fees or non-face-to-face work. | `#/admin/money?section=fees` |
| Worker pay | Prepare, review and track payroll batches. | `#/journey?panel=payroll` |
| Corrections & refunds | Review corrections and refund evidence. | `#/admin/assurance?tab=billing` |
| Finance evidence | Payment events, manual receipts and evidence history. | `#/journey?panel=finance` |

### Records

| Tool | Use it for | Route |
|---|---|---|
| Incidents | Record incidents and track required follow-up. | `#/admin/records?section=incidents` |
| Complaints | Log, investigate and resolve complaints. | `#/admin/records?section=complaints` |
| Scope referrals | Track out-of-scope referrals and high-intensity enquiries. | `#/admin/records?section=scope` |
| Shift notes | Read visit notes and resolve flagged concerns. | `#/admin/records?section=notes` |
| Forms register | Find required forms and recorded evidence. | `#/admin/documents?section=register` |
| Published policies | Review policy pages published on the site. | `#/admin/documents?section=pages` |
| Participant documents | Open the participant documents provided on screen. | `#/admin/documents?section=screens` |
| Audit pack | Build the evidence download. | `#/admin/documents?section=audit` |

### Reports

| Tool | Use it for | Route |
|---|---|---|
| Business performance | Review activity, retention and financial estimates. | `#/admin/reports` |
| Workflow times | See waiting times and progress through the service. | `#/journey?panel=metrics` |
| Evidence history | Read the record of checks and their reviewers. | `#/admin/reports?section=evidence` |
| Completed charges | Review completed shift amounts and estimates. | `#/admin/reports?section=charges` |

### Settings

| Tool | Use it for | Route |
|---|---|---|
| Payment connections | Connect payment providers and receiving accounts. | `#/payment-tracking?tab=setup` |
| Payroll, tax & documents | Configure payroll cutover, invoice tax and document processing. | `#/journey?panel=settings` |
| Pay rates | Review award comparisons, worker tiers and rate settings. | `#/admin/settings?section=pay` |
| AI assistance | Configure optional assistance and review suggestions. | `#/admin/ai` |
| Incident & AI settings | Additional incident dates and AI provider assessments. | `#/admin/assurance?tab=configuration` |
| Website access | Review preview access and demo data. | `#/admin/launch` |
| Launch checks | Review launch evidence and outstanding checks. | `#/admin/assurance?tab=checks` |
| System checks | Run the existing diagnostic report. | `#/admin/settings?section=checks` |

## Common journeys

- **Find or pay an invoice:** Money → Invoices → invoice number. Use the status filter and invoice search to narrow the list.
- **Withdraw an invoice:** Money → Invoice history & withdrawal, or **Invoice actions** on the invoice row. Existing reasons, payment reconciliation, withdrawal notices and held-shift rules remain.
- **Match a bank receipt:** Money → Received payments → Match payment. The existing payer, reference, amount and balance checks remain.
- **Handle a failed payment:** Money → Payment exceptions. Review the named issue and retry pending jobs when appropriate.
- **Prepare worker pay:** Money → Worker pay → Prepare a batch. Open **Pay batches** to review an existing batch. Exported and office-recorded payment statuses keep their existing meanings.
- **Record a manual receipt or examine evidence:** Money → Finance evidence, then Needs review, Invoice delivery, Not yet invoiced, Record receipt or Receipt history.
- **Correct charges or record a refund:** Money → Corrections & refunds → Charge corrections or Refunds & reversals. Recording an external refund does not initiate the money movement.
- **Review a participant or worker:** People → Verification. Use the separate Additional worker checks or Participant records tools for retained specialised controls.
- **Read incident obligations:** Records → Incidents → the selected incident. Filing a reference in the website does not submit anything externally.
- **Download evidence:** Records → Audit pack.

## Focused sections within a tool

| Tool | Sections |
|---|---|
| AI assistance | Suggestions; AI settings; Participant consent |
| Pay rates | Rate comparison; Worker tiers; Rate settings; Change history |
| Recruitment | Applications; Interview times |
| Worker pay | Pay batches; Prepare a batch |
| Finance evidence | Needs review; Invoice delivery; Not yet invoiced; Record receipt; Receipt history |
| Corrections & refunds | Charge corrections; Refunds & reversals |
| Payroll, tax & documents | Payroll schedule; Private invoice tax; Document assistance |
| Incident & AI settings | Incident calendar; AI provider assessment |
| Additional worker checks | Conditions; Screening; Document controls; Training matrix |
| Participant records | Files; Support plans |
| Scope referrals | Scope referrals; High-intensity enquiries |

AI sections are available at `#/admin/ai?section=suggestions`, `#/admin/ai?section=settings` and `#/admin/ai?section=consent`. Opening AI assistance defaults to Suggestions.

## Loaded-record limits

Pagination divides the returned records; it does not fetch an omitted older record. A result count describes the current loaded list, not necessarily the complete database.

| View | Returned records and page size |
|---|---|
| People directory | Latest 100 accounts, pages of 20; search applies to those accounts. Verification has its own full queue search for document review. |
| Booking list | Recent records returned by the office overview, pages of 20; this is not a whole-history search. |
| Other general office tables | Existing returned records, generally pages of 20. |
| AI suggestions and participant consent lists | Returned records, pages of 20; this is separate from the AI settings form. |
| Invoices / Received payments | All records needing action plus up to 250 recent closed records, pages of 25. |
| Pay batches | Up to 100 batches, pages of 12. |
| Email delivery | Up to 200 returned messages, pages of 12. |
| Finance evidence | Up to 100 provider events or 200 invoice, receipt or unissued-work records, depending on the section; pages of 12. |
| Launch checks / alert / correction lists | Returned records, generally pages of 12; refund/reversal requests are limited to the latest 100 by the existing endpoint. |

Clear filters if an expected record is absent. If it is outside a view’s return window, use the relevant existing register, date filter or export. **Reports → Evidence history** includes a link to the full evidence CSV. No result is not proof that a record does not exist.

## Business settings versus account settings

**Admin → Settings** holds organisation controls: payment connections; payroll, tax and document processing; pay rates; AI assistance; incident/AI assessment settings; website access; launch checks; and system checks.

The account-menu **Settings / My profile** remains for your own account details, security, notifications and applicable participant/worker settings. Do not change a personal profile to configure a business payment provider.

## Release scope

The cumulative update applies over v88.3.4, v88.4.0 or v88.4.1 and includes prior payment and location changes. Preserve the database, uploads and protected environment settings when applying it. The guide retains the supplied corrected travel instructions.

Use the release verification report for the checks actually completed. This document makes no claim that live provider access, real email delivery or deployed browser appearance has been verified.
