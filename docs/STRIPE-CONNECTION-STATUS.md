# Stripe connection check — 13 September 2026

The connected account is **The Care Web sandbox**, in test mode. A read-only request to list webhook endpoints returned an empty list. No account configuration or payment was changed.

The source package includes the protected invoice checkout and signed-confirmation handlers. The connected sandbox currently has no registered callback to the website, so it cannot yet report payment events to that deployed integration. Deployment must provide the matching protected key and signing secret and register the actual website callback described in `PAYMENT-SETUP-v88.4.0.md`. No live Stripe account was available in the connector account list.

The sandbox connection does not supply an ordinary AUD transfer receiving account or a bank transaction feed. The optional receiving-account adapter included in the payment release needs its own configured provider account and assignments. Until then, ordinary bank transfers require recorded payment evidence and reconciliation. The source does not initiate bank payouts or wages.
