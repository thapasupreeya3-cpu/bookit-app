# The Care Web v88.2.1 — admin verification redesign

11 September 2026. Full source update based on v88.2.0.

This release makes worker and participant verification a dedicated office workspace. A searchable queue, named reviewer, due date and specific next action replace the need to move between several long boards. The selected person's checklist, evidence, screening, recruitment, training, support-plan review and recent review activity are brought together.

Documents can be previewed beside their review context, with full-size access, visible dates and previous evidence. Review forms ask for a method, note and explicit confirmation. Editable correction templates explain the replacement needed while retaining the original evidence. The next unreviewed document opens after successful verification.

Actions are checked against an opaque revision of the person's current file, and document ownership is verified before dispatch. A stale or duplicate decision cannot silently overwrite newer evidence. The existing decision handlers and eligibility rules remain in force. Worker activation remains separate from document verification; participant booking readiness remains separate from formal declarations and individual booking checks.

The interface uses the existing Care Web navy and warm neutral palette. Public artwork, photographs, scene videos, fonts and vendor assets are retained. The earlier 26 workflow improvements remain included.

Open **Admin → Verification**. `docs/ADMIN-VERIFICATION.md` explains daily use. `docs/admin-verification-preview.html` is a self-contained interactive design preview containing sample records only; its mutation actions are disabled.

The database update is additive: `verification_cases` and `verification_activity`. Default schema **88201**, **363 registered routes**, **79 tables**. The repeated upgrade check starts with the actual v88.2.0 source and preserves pre-existing records and an uploaded-file sample.

The package is not deployed. See `TEST-RESULTS.md` for executed checks and staging limits. Native browser access to the local app was blocked; API and JavaScript interface checks are not a complete browser/accessibility certification.
