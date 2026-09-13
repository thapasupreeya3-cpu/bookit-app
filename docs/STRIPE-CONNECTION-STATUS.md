# Stripe connection evidence — historical snapshot

The earlier read-only check on 13 September 2026 saw a connected account named **The Care Web sandbox**, in test mode, with no webhook endpoints listed. No account configuration or payment was changed by that check. This describes that connector account at that time; it is not a current statement about the business's live Stripe activation or deployed server settings.

The owner subsequently reported that Stripe is active. The website still needs its matching live server key, webhook signing secret and registered callback. Check **Admin → Settings → Payment connections** and use [Payment setup and operation](PAYMENT-SETUP-v88.4.0.md) for the existing website. The source and a settings-present label cannot alone prove successful live collection or settlement.

From v88.4.3, customer invoices require the invoice link with Stripe card or optional PayTo. New ordinary-transfer receiving accounts are not offered. Existing receipt history remains for reconciliation. The source does not initiate bank payouts or wages.
