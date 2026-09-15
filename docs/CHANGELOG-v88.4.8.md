# v88.4.8 — Simpler Money navigation and stable page position

This small ZIP applies over v88.4.7 and includes only changed files. Merge it into the existing repository and redeploy. The live website has not been changed by this work.

## Money menu

The Money sidebar has five main destinations instead of ten:

| Destination | Tools inside |
| --- | --- |
| Invoices & payments | Invoices; Received payments; Invoice history & withdrawal |
| Charges | Unissued charges; Additional charges |
| Needs attention | Payment exceptions; Corrections & refunds; Finance evidence |
| NDIA claims | Existing claim controls |
| Worker pay | Existing pay-batch controls |

Only the selected subsection loads and displays its own controls. Payment connections remains under Settings. Search finds both the new groups and familiar individual tool names. Old direct URLs remain valid, and the selected tool retains its invoice-specific context.

## Navigation position

The router previously scrolled to the website header after every navigation, including a change of person or tab. It now coordinates position with the completion of the selected view. The page retains its height while loading, avoiding a collapse that can move the viewport.

- Selecting a person in Verification reveals that person's record panel.
- Related tab changes and pagination keep the relevant workspace in view.
- Money subsection links reveal the local navigation and selected content.
- Stale render completions cannot scroll a different route or account.
- User interaction during loading takes priority over a delayed position adjustment.
- Local document/file tabs use focus without an extra browser scroll.

## Data and installation

Financial behaviour, rates, payment processing, document decisions and permissions are unchanged. There is no database schema change; the schema remains 88404. Existing records, saved invoice links and the prior profile/referral improvements remain available.

The updated user guide and Money navigation map are included. Source checks, focused interaction checks and exact ZIP-overlay verification are recorded in the accompanying report. The browser refused the local preview with ERR_BLOCKED_BY_CLIENT; visual browser layout remains unverified. No live website deployment, real email or financial transaction was performed.
