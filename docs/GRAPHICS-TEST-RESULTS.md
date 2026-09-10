# Graphics redesign — verification record

**Release:** 88.0.0. **Base:** uploaded 87.0.1, commit metadata `68a01932a82d05ad29d5fefe9485ef30f9e5cc37`.

## Commands and results

The original uploaded source passed its own `npm ci` / `npm run check` before visual changes. The redesigned source was checked with:

```sh
npm ci --ignore-scripts
npm run check
```

The same commands are also run against a fresh extraction of the named base with the distributed overlay applied. The final handover includes the resulting command log.

| Check | Result |
|---|---:|
| JavaScript syntax | 35 script units compiled; 0 failed; includes 3 inline application scripts |
| Generated inventory | 304 registered routes; 54 tables; matching the source |
| Release metadata | Package, lockfile, handover and version agree |
| Original booking-clash assertions | 21 / 21 |
| Original server smoke assertions | 224 / 224 |
| Original review unit assertions | 42 / 42 |
| Original review integration scenario groups | 25 / 25 |
| Added deterministic graphics checks | 56 / 56 |
| Main browser-render checks | 117 / 117 |
| Additional boundary, menu and server-page checks | 60 / 60 |
| New graphic asset HTTP responses | 14 / 14 returned 200 and matched the files on disk |

Local Node runtime: **22.16.0**. The repository's existing `.nvmrc` pin is retained unchanged. Default schema identifier remains **87000**. No new schema/data migration was introduced.

## Browser work actually performed

The main audit renders **50 routes at both 1440px and 390px**, covering the public site, six service detail pages and overnight, worker profile/directory, participant bookings/messages/documents/support plan, worker earnings/training/open shifts, and the office's existing boards. Additional checks cover selected layouts at **320, 768, 1024 and 1280px**. Published policies, an individual privacy policy and a real generated suburb route were requested from the local server and inspected for mobile reflow.

The audit checks one active app page, absence of uncaught browser script errors, and document-level horizontal overflow. Oversized data tables may scroll inside their intended wrappers. Menu open/Escape/focus, accessibility controls, 150% text on mobile home, suburb search routing, synthetic conversation display and opening an existing shift note were exercised. Service-media play/close UI was exercised, with media play stubbed for that UI-state test only.

Early render checks found overflow in a mobile worker profile, a long nominee selection and the worker header's tier artwork. Those layouts were corrected, and the final route/boundary runs passed. The original API/business tests were not weakened or replaced.

## Important test boundary

Managed browser policy blocked normal navigation even to localhost. Chromium was therefore given the site's real HTML/CSS/JavaScript with `set_content`; an isolated local HTTP bridge supplied the real API responses. Local images/styles/scripts were embedded into the render harness, and only synthetic accounts/visits/messages were used. These substitutions are test-harness-only, not shipping site code.

This proves the inspected rendering and interaction paths under the stated harness. It **does not** establish native deployed cookies/navigation, browser enforcement of the deployed CSP, real email links, actual video playback, real Stripe payments, native install prompts, screen-reader behaviour or complete WCAG conformance. No external penetration test or Lighthouse score is claimed.

## Protected original logic and artwork

`tests/graphics-tests.js` checks the unchanged route map/page containers, original cropped artwork hashes, asset/manifest/DOM contracts and hashes of the original operational libraries, policy/form content, data files and existing tests. `graphics-server-presentation-audit.json` records equality of server.js outside its CSS/template logo markup. This release is not a new audit of the legal accuracy of inherited pricing/payroll/retention rules.

## Native staging checklist

Before production deployment, check native login/logout, password reset/email links, mobile navigation, directory and booking dialogs, messages, document uploads and forms, a worker's completion flow, an office register, a policy/print view, all six scene videos, text-size/contrast/motion controls and keyboard focus. Check media on an actual phone. Use only authorised staging data, and follow the existing backup/deployment procedure.

Nothing was pushed to GitHub or deployed. No production data, payment or email was sent by the redesign work.
