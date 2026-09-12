# Data, processors and retention decisions

Source-derived inventory; not a legal retention schedule. Exact tables/columns: database-table-inventory.txt. All 91 migrated tables are enumerated there. Assign a privacy owner and approve a retention basis, duration, trigger, legal-hold handling and deletion test for every group before launch; do not silently choose a period from a generic template.

| Group | Data / locations | Access and flow | Retention decision needed |
|---|---|---|---|
| Account and authentication | users, sessions, MFA, verification/reset links, preferences | Own account; limited office administration; hashed credentials and session evidence | Active account, closure, fraud/security need, recovery history |
| Worker evidence and recruitment | worker_docs, profiles/photos, screening, training/completions, recruitment/interviews, verification cases/history, document suggestions | Worker; authorised office; published subset only | Worker record obligations, expiry, superseded evidence, review history |
| Participant care and consent | participant_docs, support_plans, agreements, account_links, delegate_log, care web | Owner, explicitly granted helper, relevant worker brief, office | Care/consent records, minor/nominee rules where applicable, revoked access |
| Visits and communication | bookings/series, drafts, shift_notes/addenda, routines, messages/attachments, transitions | Participant/assigned worker and scoped helper; office | Care record, unsent drafts, message/attachment need, closure |
| Incidents and complaints | incidents, incident_obligation_events, complaints, compliance records, scope_requests/handoffs | Restricted office roles and scoped reporting paths | Reportable-incident/complaint obligations, legal holds, safeguarding evidence |
| Money | invoice_snapshots/payment_evidence, payroll_batches/lines, referrals, finance_provider_events, adjustment approvals | Own statement; authorised office; external payroll/payment references | Accounting/employment/tax requirements, dispute holds, immutable ledger |
| Automation and operations | delivery_outbox, journey tasks/events, job_runs, assurance_reviews, operational_followups, calendar_tokens/feed events | Scoped office; calendar token recipient; workers/participants own tasks | Queue payload minimisation, failed mail evidence, expired tokens, audit history |
| Public/content assets | policy_pages, templates, forms, public content/media, compiled/vendor assets | Approved public material; stored originals may be private | Version/acceptance proof, withdrawn policy retention |
| Backups and logs | SQLite copies, documents/photos archives, provider/system/application logs | Operators with approved access; off-instance destination | Rotation, immutable hold, restore access and post-restore re-deletion |

## Actual external processor register — complete with real contracts
For hosting/storage/backups, DNS/TLS, SMTP/email, Stripe/payments, maps/travel and optional AI, record: legal entity and service, exact endpoint/account, controller/processor role, data fields, purpose, region(s) and subprocessors, retention/deletion and model-training terms, breach contact, transfer controls, review date and contract evidence. A region flag alone is insufficient. AI requires exact operator allowlist plus current in-app assessment; manual processing remains available.

## Closure / correction drill
1. Identify active legal holds and records that must remain; authorise the scope with the privacy owner.
2. Revoke sessions, helper grants and private calendar links. Cancel pending notifications and remove unnecessary payloads.
3. Exercise supported closure/de-identification in a synthetic account. Inspect all referencing tables and originals, including new review/ledger/scope records. Retained audit references can legitimately outlive the login but require a recorded basis.
4. Test exports and object access after closure/revocation, then a restoration of an earlier backup; reapply the deletion/hold ledger before reopening access.
5. Record owner, exact count/category outcome, exceptions, actual deletion date and next review. Do not manually delete a live database or evidence folder as a shortcut.
