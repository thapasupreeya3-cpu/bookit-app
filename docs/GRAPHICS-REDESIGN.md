# The Care Web — v88.0.0 visual redesign

## Base and scope

This is a changed/new-files overlay for the uploaded **v87.0.1** source, `bookit-app-main (1).zip`, archive commit metadata `68a01932a82d05ad29d5fefe9485ef30f9e5cc37`. The uploaded archive, not an assumed remote GitHub HEAD, is the base. It retains the single Node application and existing client-side router: no new framework, dependency, build pipeline, API, table or environment setting.

## The original logo, not a redraw

The user-approved navy, gold and grey logo is taken directly from the original 542 × 368 image. Exact rectangular crops preserve its complete network, person, hands and original wordmark. The original dark app tile is the source for install icons. The pixel bounds and hashes are in `public/assets/careweb/identity-source.json`.

The logo has **not** been regenerated, simplified, traced or presented as a new vector master. The source is a small raster image; large-format printing would need a higher-resolution or original vector master. Resampling the install icons does not create additional original detail. No font files are included in this release overlay.

## Visual system

- Deep navy `#203566` for navigation, primary actions, major headings and operational emphasis.
- Warm yellow `#F1BE48` for selected actions, small accents and the next-visit indicator. Yellow buttons have dark navy text, not white text.
- Cool grey `#F6F7FA`, pale blue `#EDF1F8` and white for distinct page/card surfaces; body copy uses `#52617A`.
- Existing self-hosted Fraunces for public editorial headings and Inter for body text, forms and compact operational headings. The approved logo lettering remains its original image.
- Consistent card edges, restrained shadows, labelled controls, visible keyboard focus and less decorative movement.
- Semantic error, warning and success colours remain separate from the brand colours.

## What changed

| Area | Presentation changes |
|---|---|
| Header and footer | Original logo crops, navy utility strip, clearer navigation, gold call to action, simpler footer hierarchy and responsive menu sizing. Guest headers do not show the legacy demo unread-message badge. |
| Homepage | Photo-led hero, original tagline, existing suburb search, direct support-worker and how-it-works links, funding note, responsibility/pricing strip, six photo service cards plus overnight, a care-web story section, clearer pricing comparison, retained worker directory and FAQ. |
| Service pages | Calm photo headers, consistent typography/cards, existing service information and booking destinations, preserved scene videos with deliberate play/close controls. |
| Worker directory and profiles | Consistent search fields, filters, cards, chips, photos and profile panels. Long names and profile labels wrap at small widths. Visibility/check gates and profile data still come from the original APIs. |
| Signup, login and contact | Shared field/button/dialog treatment and preserved form identifiers, validation and submit behaviour. |
| Participant screens | Compact operational page headings, clearer next-visit summary, bookings, notes, settings, documents, support plan, statements and messaging styling. No participant-data processing added. |
| Worker screens | Bookings, availability/settings, earnings, training and open shifts adopt the same visual system. The existing tier artwork remains; its header treatment is reduced to avoid mobile overflow. |
| Office screens | Existing Today workspace, navigation, compliance pipeline, tables, document tabs, counts and action queues are restyled without changing the underlying records or permissions. |
| Server-rendered pages | Policy/register/form, preview-gate, cover-confirmation and suburb-page CSS is aligned with the navy/grey system. Policy text, approvals, access control and records are not rewritten. |
| Sharing/install | Original-artwork favicon, apple-touch icon, app icons, manifest and social-sharing image. No offline cache/service worker is added. |

Existing supplied service imagery is reused; no generated worker identities or new photographic claims are added. The inherited illustrative homepage quotes are explicitly labelled **not verified customer testimonials**. Demonstration worker profiles retain the application's demo notices. The new homepage does not show a fabricated named worker as a confirmed booking.

## Motion and responsive behaviour

The old kinetic homepage/video reel, magnetic buttons, card tilt and scroll-reveal engine are not run under the new design. Busy decorative overlays are not displayed. The original media files remain in the base repository. Service-page video playback is now intentional rather than automatic, and videos are paused when leaving the page or hiding the document. The explicit play/close control is in `public/assets/careweb/visuals.js`.

The mobile navigation opens at a wider breakpoint to keep the original logo and account controls readable. It takes keyboard focus, contains Tab navigation while open and returns focus to the menu button on Escape. Existing text enlargement, readable-font, reduced-motion, high-contrast and print controls remain. Testing these behaviours is not a claim of complete WCAG conformance.

## Kept unchanged

All 304 route registrations, 54 database tables and the default schema identifier **87000** remain. The original client route map and page containers remain. Backend assignment rules, clinical-access checks, messages/pagination, strict dates, recurring bookings, approvals, billing/payroll, credentials, policy content and support definitions have not been changed by this graphics work. A normalized comparison of `server.js` outside its CSS and gate-logo markup is byte-identical to the uploaded base. Operational library/policy/form/test hashes are checked by `tests/graphics-tests.js`.

The original .nvmrc, deployment/service names, environment settings, user uploads, scenes, videos, tier assets, fonts and vendor assets stay in place. No data migration or database restoration is required just to install or undo this visual release.

## Where to maintain it

- `public/assets/careweb/design.css`: tokens, layout, responsive and accessibility styles.
- `public/assets/careweb/visuals.js`: presentation-only video and menu interaction.
- `public/assets/careweb/`: exact artwork crops, derived install/share assets and source provenance.
- `public/index.html`: homepage structure, service-card template, brand lockups and links to the presentation files.
- `server.js`: CSS for the existing server-rendered wrappers only.
- `tests/graphics-tests.js`: graphical asset/DOM/route/protected-source regression contracts.

The legacy CSS is deliberately retained underneath the isolated override layer. That minimises changes to the mature application and makes a visual rollback straightforward. It is not a claim that the stylesheet has been refactored from scratch.

## Deploy and roll back

Follow `STARTHERE.txt`. Apply to the named base, retaining all unchanged assets. Run `npm ci --ignore-scripts && npm run check`, then use the existing authorised deployment process. Confirm version 88.0.0 and perform the native staging checks in the test report. To undo only this release, revert its code commit and redeploy; do not restore an old database over newer operational records.

## Boundaries

No GitHub push, server deployment, real messages or real payments were performed. No real participant database was copied or used. This is a visual redesign, not a security certification or a review of current NDIS/legal/payroll rules. Existing email content and invoice-PDF layout were not redesigned. Previously persisted document evidence is not retroactively restyled or rewritten.
