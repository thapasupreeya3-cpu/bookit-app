# The Care Web — payment setup for your existing website

These instructions are for **https://thecareweb.com.au**, hosted on your existing **AWS Lightsail bookit instance**. They do not require a second website. They replace the earlier instruction to create an isolated test website as part of setup.

Updated for v88.4.3 on 13 September 2026. This version requires invoice-link payment through Stripe card or optional PayTo. Refer to the release verification for completed checks. The running server configuration, Stripe account activation, actual inbox delivery and live settlement have not been verified here.

**Connecting live payments and publicly launching the website are separate actions.** Your existing site password can remain while you prepare. The signed Stripe notification endpoint bypasses that password screen. Leave the production security settings enabled.

## Step 1 — Install the update on this website

Open **AWS Lightsail → bookit → Connect using SSH**, then run:

```bash
sudo bookit-update
```

The command updates the existing website from GitHub. You do not need to upload another ZIP. If it reports an error, retain the error text for diagnosis; do not assume the site updated.

## Step 2 — Open the actual payment settings

Sign in as an admin and open:

**Admin → Settings → Payment connections**

Direct link: [Open Payment connections](https://thecareweb.com.au/#/payment-tracking?tab=setup).

On a narrow screen, expand **Admin menu**, then **Settings**. You can also search **Payment connections** in **Find an admin tool**.

This is the business Settings section inside Admin. The old **Payment tracking & bank transfers** combined menu name is no longer used.

The **Card & PayTo** panel shows the configuration state. There is **no Connect Stripe button and no key-entry form** on this page. Connecting Stripe in ChatGPT does not install the payment keys on your website.

## Step 3 — Prepare the business Stripe account

Open the [Stripe Dashboard](https://dashboard.stripe.com/), select your business account and its **live** environment, and complete Stripe's account activation requirements. Supply the business information and the business bank account that should receive payouts. Resolve any outstanding account requirements shown there.

These steps configure actual payments, even while your website has not publicly launched. They do not authorise an automatic debit of future invoices. [Stripe account setup](https://docs.stripe.com/get-started/account/set-up)

## Step 4 — Register notifications for this website

Open [Stripe Workbench → Webhooks](https://dashboard.stripe.com/workbench/webhooks) in the **same live account**.

If this exact live destination already exists, inspect and update it rather than creating a duplicate. Otherwise:

1. Choose **Create an event destination**.
2. Select **Your account**, with **snapshot events**.
3. Select the event types listed under **Stripe card payments and optional PayTo** below. All 14 are used by this release.
4. Choose **Webhook endpoint** and enter:
   `https://thecareweb.com.au/api/stripe/webhook`
5. Save the destination and reveal its signing secret, beginning `whsec_`. This is the value for `STRIPE_WEBHOOK_SECRET`.

The notification endpoint is how Stripe tells your website that money was received or a payment failed. [Stripe webhook instructions](https://docs.stripe.com/webhooks)

## Step 5 — Put the connection details on the existing server

Get the live server API key from the business account's [API keys page](https://dashboard.stripe.com/apikeys).

**Release-specific compatibility:** v88.4.3 currently accepts a standard live key beginning `sk_live_`. A restricted live key beginning `rk_live_` is incorrectly treated as test mode by this release. Restricted keys are preferable when supported, but that compatibility defect needs correction before using one here.

In the existing Lightsail SSH window, open the application's protected settings:

```bash
sudo nano /etc/bookit.env
```

Edit the existing entries, or add them if absent. Use one entry for each setting:

| Setting | Value for this website |
| --- | --- |
| `APP_URL` | `https://thecareweb.com.au` |
| `STRIPE_SECRET_KEY` | The actual `sk_live_` server key from the intended business Stripe account. |
| `STRIPE_WEBHOOK_SECRET` | The actual `whsec_` signing secret from Step 4. |
| `STRIPE_PAYTO_ENABLED` | `false` for card-only setup; `true` only after PayTo is enabled and available for your live Stripe account. |

Keep the keys in the protected server configuration; do not put them in GitHub, the website's public files, chat or screenshots. Keep unrelated existing settings, including the site password and production settings.

Your documented Lightsail installation uses `/etc/bookit.env`. Vault-backed secret storage is recommended on AWS, but this release does not fetch AWS Secrets Manager values itself: creating a vault entry alone will not configure it. [Stripe key management guidance](https://docs.stripe.com/keys-best-practices)

To save in nano: **Control + O**, **Enter**, then **Control + X**.

## Step 6 — Check email and apply the settings

Keep an already working email connection. If email is not configured, the site supports either:

- **Resend:** `RESEND_API_KEY` plus a `MAIL_FROM` address on your verified sending domain.
- **SMTP:** `SMTP_USER`, `SMTP_PASS`, and the correct `SMTP_HOST`, `SMTP_PORT` and `MAIL_FROM` for the existing email service.

Then run:

```bash
sudo systemctl restart bookit
sudo systemctl is-active bookit
```

The second command should report `active`. It confirms that the service is running, not that Stripe accepted a payment.

## Step 7 — Confirm what the website shows

Return to [Payment connections](https://thecareweb.com.au/#/payment-tracking?tab=setup) and choose **Refresh**.

The Card & PayTo panel should show:

- **Stripe settings present**
- **Environment: live**
- The appropriate PayTo enabled/not-enabled label

These labels confirm that configuration was detected. They do not prove account approval, successful collection or deposit into your bank.

For the first **genuine, authorised invoice payment**, confirm that the Stripe event is delivered successfully, the correct website invoice balance changes, and the receipt reaches the intended payer. Check **Admin → Today → Email delivery** for queued or accepted messages, and check the actual inbox separately.

Do not create a fake care invoice or artificial live charge to simulate testing. Stripe provides sandbox/test tools for simulated payments; those are distinct from requiring another website. Your current production release rejects test-mode checkout and events, so do not switch off production security or put test keys into this live setup. These instructions configure the connection; they do not claim that end-to-end live validation has already passed. [Stripe testing guidance](https://docs.stripe.com/testing/overview)

## Step 8 — Enable bank payment through Stripe, if wanted

In [Stripe payment method settings](https://dashboard.stripe.com/settings/payment_methods), enable **PayTo** if available for the live business account. Complete any requirements Stripe displays.

Then set `STRIPE_PAYTO_ENABLED=true` in the same server configuration, restart `bookit`, and refresh Payment connections.

This lets an eligible Australian payer authorise an invoice payment through their bank in the checkout journey. The site's PayTo integration is payer-initiated; enabling it does not charge all future shifts automatically. [Stripe PayTo](https://docs.stripe.com/payments/payto)

## Step 9 — Use the invoice link for every customer payment

Direct self-managed/private payers and plan managers to the **View & pay invoice** link in the invoice email or PDF. After the required support review, the payer chooses **card**, or **PayTo** where enabled. The payment request already identifies the invoice, so the payer does not type an invoice reference or send a separate transfer.

This release removes the ordinary BSB/account payment option and new receiving-account assignments. Do not give out bank-transfer details as a payment alternative. Existing payment records remain available for reconciliation. NDIA-managed support retains its claim route, and worker bank details remain part of the separate payroll workflow.

Live invoice pages and newly generated PDFs follow this policy. PDFs already emailed or downloaded cannot be recalled. If an old copy contains bank details, give the payer the current invoice link. If money was already sent using an old copy, the office must reconcile the real payment before asking the payer to pay again.

## Step 10 — Track payments in these exact pages

| What you want to do | Current Admin path | Direct link |
| --- | --- | --- |
| Check provider configuration | Settings → Payment connections | [Open setup](https://thecareweb.com.au/#/payment-tracking?tab=setup) |
| View invoice balances | Money → Invoices | [Open invoices](https://thecareweb.com.au/#/payment-tracking?tab=invoices) |
| View received payments and historical allocations | Money → Received payments | [Open received payments](https://thecareweb.com.au/#/payment-tracking?tab=receipts) |
| Review payment failures or pending jobs | Money → Payment exceptions | [Open exceptions](https://thecareweb.com.au/#/payment-tracking?tab=exceptions) |
| Withdraw an invoice | Money → Invoice history & withdrawal | [Open invoice history](https://thecareweb.com.au/#/admin/money?section=history) |
| Review worker pay batches | Money → Worker pay | [Open worker pay](https://thecareweb.com.au/#/journey?panel=payroll) |
| Check invoice email delivery | Today → Email delivery | [Open email delivery](https://thecareweb.com.au/#/journey?panel=deliveries) |

Some older automatic payment tasks still open the general Invoices page. Use Received payments for matching, and Payment exceptions for failed jobs.

The website's **Paid** invoice status, Stripe's onward settlement into your business bank, and the worker's wages are separate records. This release does not automatically transfer worker wages or reconcile provider payouts into your bank.

## What runs automatically

| Event | Application behaviour |
| --- | --- |
| Worker submits a newly completed self-managed/private shift | Calculates the charge, creates one immutable invoice for that shift, and queues its PDF email. No routine office or holiday sign-off. |
| Participant or authorised reviewer opens the invoice | Shows the recorded support, amount, due date and current review/payment state. They explicitly confirm the details before online checkout is available. |
| Participant approves | Keeps the invoice number and recorded charge. Approval and payment are separate: the person can approve and pay, or approve and pay by the due date. |
| Plan-managed shift | Requests review first, then sends the invoice to the recorded plan manager. The participant is not asked to pay personally. |
| NDIA-managed shift | Requests review first, then prepares the claim records. External portal submission is still an office action. |
| Confirmed customer payment | Updates the ledger once, reduces the balance, queues a receipt, and stops further reminders when paid. Returning from checkout is insufficient evidence. |
| Confirmed card or PayTo checkout | Matches the known checkout/payment identifiers to the invoice automatically; no typed bank-transfer reference is required. |
| Question or withdrawal | Pauses collection/reminders or withdraws the invoice, preserves history, and retires checkout links with retries. In-flight money is reconciled when confirmed. |
| Temporary provider or message failure | Retains a durable job and retries. Office actions identify unresolved exceptions. |

The first boot records the immediate-invoicing cutover. Each new worker submission adds its own durable marker. Previously pending, unapproved shifts are not retrospectively invoiced merely because the software was installed; already approved, unissued work continues through recovery. One shift receives one invoice, including catch-up runs.

The existing `invoice_due_days` setting remains unchanged. Its fallback is 14 days. This release does not replace existing agreement terms with a new seven-day rule, and immediate invoice issue does not authorise an automatic debit. Saved-method charging and automatic recurring debits are not added.

## Where people work

- **Participant/reviewer:** the Actions prompt, Bookings in Calendar or List, or Statements → invoice. The invoice page is `#/invoice?invoice=INVOICE-NUMBER`.
- **Office:** **Admin → Money → Invoices**, at `#/payment-tracking?tab=invoices`, shows balances and invoice actions. **Received payments** and **Payment exceptions** have their own Money pages. Configure providers under **Admin → Settings → Payment connections**, at `#/payment-tracking?tab=setup`. Connection settings alone do not confirm live readiness or bank settlement.
- **Worker:** **Pay status**, at `#/journey?panel=payroll`, for the existing payroll batch and office-recorded expected date/status.

The compact Actions count includes actionable review/payment work. Text labels accompany colours. A person awaiting an office answer is shown as waiting, rather than being asked to approve the same disputed charge again.

## Invoice and payment links

The invoice email and PDF direct the payer to the invoice link for all customer payments; they no longer supply BSB/account transfer details. The PDF’s **View & pay invoice online** label is clickable. A signed-in reviewer can inspect and approve the invoice; a helper needs the participant’s active **bookings** scope to review care, and the separate **invoices** scope to manage payment.

The `/pay/<token>` page is an opaque, expiring payment link for the payer. Possessing this link does not give care-review authority. It excludes participant contact/address/NDIS details and care notes. It can show payment options only when the invoice’s review and collection state permit them. Keep these links private because they grant access to the limited payment page.

For plan-managed invoices, the original payer receives the payment link after the required shift review. The signed-in participant sees the plan-manager route. Account and invoice permissions are enforced again by the server.

## Stripe card payments and optional PayTo

Configure these values in the application server’s protected environment, outside the repository and public assets:

| Variable | Required configuration |
| --- | --- |
| `APP_URL` | The real public HTTPS origin for this deployment. |
| `STRIPE_SECRET_KEY` | The server API key for the intended Stripe account and mode. |
| `STRIPE_WEBHOOK_SECRET` | The signing secret for this deployment’s webhook endpoint and mode. Both this and the API key are required before checkout is offered. |
| `STRIPE_PAYTO_ENABLED` | Set to `true` only when PayTo is enabled and supported for the account. Without it, the site offers card checkout only. |

**API-key compatibility in v88.4.3:** Prefer a restricted API key with only the necessary permissions when the application supports it. Stripe distinguishes restricted keys from standard secret keys in its [API-key documentation](https://docs.stripe.com/keys). The current application has a compatibility defect: its live-mode check recognises only the `sk_live_` prefix. A valid `rk_live_` restricted key is treated as test mode and checkout is disabled in production. Restricted live keys therefore need that application check corrected before use. This documentation correction does not change that code or claim restricted live-key support.

Register the HTTPS endpoint **`/api/stripe/webhook`** in the matching provider environment. The implementation handles these checkout/payment outcomes:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.canceled`

For refund/dispute evidence and office reconciliation, also subscribe to:

- `charge.refunded`
- `refund.created`
- `refund.updated`
- `refund.failed`
- `charge.dispute.created`
- `charge.dispute.updated`
- `charge.dispute.closed`

These events record evidence for reconciliation; they do not issue refunds. This application creates its own invoices and does not implement Stripe payout reconciliation. Generic instructions to enable invoice/payout events are not a substitute for the implemented event list above.

A checkout request uses the current remaining balance and a durable request identifier. Repeated clicks reuse the appropriate existing attempt. Confirmations are matched to known invoice/checkout records and their amounts. Delayed bank methods remain **Processing** until success is confirmed. Old full-value links are retired after a partial payment; a subsequent checkout uses the new balance. An uncertain request older than the provider idempotency window is escalated for review rather than blindly recreated.

PayTo here is a payer-initiated bank payment through checkout. It is not automatic wage payment or an authorisation to debit later shifts. The application does not store card numbers or bank login credentials.

Provider references: [Stripe webhooks](https://docs.stripe.com/webhooks), [Checkout fulfilment](https://docs.stripe.com/checkout/fulfillment), [PayTo](https://docs.stripe.com/payments/payto).

## Historical payment evidence

Ordinary bank transfers are no longer offered for new customer payments. The office can still inspect and reconcile existing receipts, partial allocations and finance evidence. These controls are for real historical or exceptional money already received; they are not a new payment method for the payer.

Where a historical stored provider connection exists, signed and provider-verified late deposits remain visible for office reconciliation; they are not automatically applied to new or other invoices. Old provider environment settings alone do not enable a new receiving-account connection.

Already issued external receiving accounts or previously shared bank details are not closed by a software update. If any existed, reconcile outstanding money with the relevant provider before arranging their closure. This release does not itself transfer or return those funds.

## Received, allocated and settled are different

| Display | Meaning |
| --- | --- |
| Awaiting review | The completed support still needs explicit review before online checkout. |
| Unpaid | An active invoice has a balance owing. |
| Processing | The provider has not confirmed the final payment outcome. |
| Part-paid | A confirmed, allocated receipt has reduced the balance. |
| Paid | The invoice balance has been fully covered by recorded payment evidence. |
| Payment received — needs matching | Funds were confirmed, but all or part remains unallocated. |
| Under review | A question has paused collection for this invoice. |
| Withdrawn | The invoice is retained in history and must not be paid. |
| Bank settlement not confirmed | This integration has not verified onward deposit into the business’s bank account. |

**Paid** is an invoice-ledger status. It is not proof that the payment provider has deposited the money into the business bank, or that the worker has received wages. Provider fees, onward settlement and business-bank reconciliation still use the provider/accounting records. This release does not perform Stripe payout reconciliation or transfer wages.

## Questions, corrections and reminders

A participant can report a problem before or after approval. The question is preserved as a note, the relevant invoice is placed under review, and its automatic collection/reminders are paused. A worker’s answer adds to the original note; it does not approve the answer on the participant’s behalf or resume collection. The participant explicitly approves when satisfied.

An issued charge cannot be silently repriced through the category/item controls. For an unpaid correction, withdraw the invoice, correct its held shift, then release it. A changed charge returns to pending review and receives a fresh invoice number. Paid or unmatched money must be reconciled before withdrawal. Existing independent refund/reversal approvals remain in place; recording an external refund does not send it.

Unpaid approved invoices receive an overdue reminder on the first overdue day, then on the weekly overdue milestones, with a unique message key. Paid, withdrawn, disputed and processing invoices are excluded. Confirmation failures and checkout connection problems have durable retries. A provider outage does not undo the saved shift or participant’s review. The office receives a named exception when follow-up is needed.

Email **queued** means waiting for delivery; **sent** means accepted by the configured transport, not proof the recipient read it or that payment occurred. Real SMTP/Resend delivery must be enabled separately. A message already accepted by the provider cannot be recalled.

## Worker pay

The existing payroll workflow remains separate from customer collection: prepare a batch, record independently calculated components, obtain the required separate approval, export it, process it externally and record the actual external reference. The office may add an expected pay date.

Workers now receive status updates for pay preparation, export and the office-recorded payment result. Labels distinguish **Being prepared**, **Approved for payroll**, **Export file created** and **Payment recorded by office**. The last label means an office record exists; the website has not received bank confirmation of wages.

Automatic wage transfers, a connected payroll-provider result feed, payslip imports and automatic recurring participant debits are not part of this release. Existing booking-share figures remain allocation estimates rather than take-home pay.

## Deployment acceptance

The changes have local tests with synthetic accounts and simulated providers. Do not describe these as live bank, inbox, payroll or settlement tests. The release’s final verification report records the completed local checks and any browser checks actually performed.

For this existing website, confirm the public origin, matching live Stripe credentials and webhook registration. When a genuine authorised payment occurs, check its confirmation, invoice balance and receipt delivery, then reconcile actual onward settlement with the provider and business bank. Automated tests cover partial balances and duplicate notifications; real provider and inbox validation remains outstanding until observed. These are connection checks, not recurring office gates on each shift.
