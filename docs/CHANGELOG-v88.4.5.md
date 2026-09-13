# The Care Web v88.4.5 — booking emails and visible email setup

Apply the cumulative changed-files ZIP over v88.3.4 or v88.4.0–v88.4.4. Merge into the existing repository, redeploy and refresh. Source changes do not configure a live email provider.

- Participants now receive booking request acknowledgements. Active helpers with booking permission receive participant-side booking updates. Changes, cancellation and ended repeating visits notify affected parties.
- Repeating request emails remain relevant while an included request is outstanding. Revoked helper access, changed assignments and superseded or expired messages are checked before sending. Distinct repeated edits produce distinct notices, while retries retain their existing event identity.
- Booking messages bypass routine digest and quiet-hour scheduling, preserve opt-outs and retry temporary transport failures while relevant. No blanket office copy is added.
- **Admin → Settings → Email setup** shows the configured sender and default reply address, your own receiving address, provider settings status and a test to your account. **Today → Email delivery** exposes safe subjects, recipients, bookings, attempts and provider results. Personal notification settings show your account's receiving address.
- Email tests now report queued with a specific message ID, then show provider acceptance/failure. They no longer claim all email is working merely because the message entered the queue. A test status endpoint is limited to that user's test records.
- Four additive outbox columns preserve subject, heading, event kind and booking ID after message bodies are purged. Unsent existing payloads supply their labels during migration. Earlier cleared subjects are not invented; existing financial evidence and booking records are preserved.
- The guide removes an unsupported claim that the live mailbox and SPF/DKIM were verified. It explains outgoing history versus an actual mailbox, existing-site setup and where to find participant addresses.

The accompanying verification report records automated results. Tests use synthetic identities and local mock transports; no real email, payment or live deployment is performed. Live sender credentials, inbox delivery and rendered appearance remain unverified.
