# Retired ordinary-transfer integration — v88.4.3

The Care Web now requires customer invoice payments through the invoice link, using Stripe card or optional PayTo. Zai receiving accounts and ordinary BSB/account transfers are no longer offered as payment choices. New receiving-account assignments are disabled.

Existing receipt, allocation and provider evidence records remain available for historical reconciliation. Their retention does not make ordinary transfers an offered payment method. The software update does not close external accounts, move existing funds or recall PDFs already sent. Reconcile any outstanding real money before arranging provider-side closure of a previously opened account.

Use [Payment setup and operation](PAYMENT-SETUP-v88.4.0.md) for the current Stripe connection and invoice-link workflow. Worker payroll and provider settlement remain separate from customer invoice collection.
