# v88.2.12 verification

The complete `npm run check` gate passed with exit code 0 on Node 24.19.0. It includes syntax, route/schema inventories, release-document consistency, payload integrity, and the existing functional suites. The 13 calendar scenarios and 42 workflow/API scenarios passed. No new functional test was needed for this stylesheet-only fix.

The calendar stylesheet and its versioned link are the only production behavior changes. Source review identified the global `table { min-width:640px }` rule as the cause of the date grid overflowing beneath the agenda. The calendar overrides it with `min-width:0`, allows its children to shrink, wraps its columns, uses a single column at 1050 CSS pixels and below, and wraps long agenda text. The example preview now includes the general table rule so it no longer omits that interaction.

The preview script passed `node --check`. Server code and calendar JavaScript are byte-identical to v88.2.11. All 147 original image, media, font and binary assets are unchanged. Schema remains 88202, with 83 tables and 369 registered routes. No database or dependency changes.

The current gate log and source review are in `validation/v88.2.12-*`. Earlier validation files describe their own releases. This report was added after the gate; packaging regenerated and verified all payload hashes afterward.

## Limits

Actual browser layout was not inspected: browser access was blocked earlier in this session and no alternate browser was used. The screenshot establishes the original overlap; the source change addresses its cause. After deployment, confirm that Sunday the 6th is visible and selectable in September 2026, and check month/week layouts on phones, desktop and enlarged browser zoom. No live site was deployed or real account data changed.

The project declares Node 22; the available test runtime was Node 24.19.0.
