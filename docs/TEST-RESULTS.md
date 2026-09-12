# Validation — v88.3.2

All automated suites passed on Node 24.19.0. The full log is validation/v88.3.2-full-test-output.txt. The 26 focused billing scenarios comprise 11 unit/transport/queue checks and 15 real local API journeys. They cover holiday fallback, actual worker completion and participant approval, invoice/outbox creation, duplicate protection, disputes, missing payer recovery, and immutable issued snapshots. Mail and external payment acceptance were not tested against live services.

Two synthetic v88.3.1 → v88.3.2 upgrades passed, preserving existing records and uploaded bytes; integrity and foreign-key checks passed. New schema: 88302, 92 tables, 386 registered routes. No production database was accessed.

The block scanner completed without parse errors. Exact source scope, hashes, entries and the complete control-flow census are in docs/block-register/. A census entry is not necessarily an active or unique business block.

Guide anchors, links and inline script syntax were checked. Chrome returned ERR_BLOCKED_BY_CLIENT for the current local site; native browser layout, assistive technology, the declared Node 22 runtime and deployed provider integrations remain unverified. The authoritative NSW HTML pages were retrieved to create and validate the shipped calendar snapshot; daily production refresh behavior still depends on the actual host's internet access, with a tested saved fallback.
