# BookIt v63 — "The Fit"

Your v62 app, rebranded and re-graphic'd end to end. Same `server.js`, same 47
pages, same logged-in product — new identity, new cinema.

## What changed
- **The film.** The hero is now a 12-second generated macro film — two
  glass-ceramic rings (ultramarine + apricot) that find each other and link —
  and **your scroll plays it**, forward and backward, any frame holdable.
  Four story chapters ride on top: fit / six supports / three steps / pricing.
- **The brand.** New identity built on the "oo": interlinked ring wordmark and
  favicon, ring progress meter that links at scroll's end, ring step numerals,
  ring-pair kickers and testimonial marks. Palette: porcelain `#F7F5F0`,
  marine ink `#101D33`, ultramarine `#2743E0`, apricot `#FF9E4A`,
  void `#0B1430`. Type: Bricolage Grotesque / Hanken Grotesk / Spline Sans
  Mono (NDIS codes and rates in mono, as they deserve).
- **The plates.** All six service pages (and the home services grid) carry
  generated 2K "scene window" stills in one shared world — miniature ceramic
  dioramas of each support, the two rings always present.
- **Removed.** three.js and the care-* runtime (2.4 MB of vendor JS gone).
  Replaced by `vendor/oo-scrub.js` (~9 KB).
- **Kept, exactly.** Every accessibility system: text size scale, readable
  font, reduce motion, high contrast — reduce-motion and high-contrast users
  get the poster and all chapter copy with **zero video fetched**. All app
  mounts (`#homeServices`, `#homeWorkers`, `#homeFaq`, `#heroSearch`,
  `#heroRotate`) preserved; the logged-in app inherits the new tokens only.
  OG/twitter meta added (v62 had none).

## Run it
```
node server.js        # exactly as before
```

## Assets (public/assets/world/) — three routes, use the first that works
The site expects 11 files in `public/assets/world/`:
`fit.mp4  fit-mobile.mp4  fit-poster.jpg  fit-mobile-poster.jpg  og.jpg`
and `plate-{employment,personal-care,transport,daily-tasks,household,community}.jpg`

**Route 1 — the bundle (fastest).** Download and unzip into place:
https://upload.higgsfield.ai/user_3HOYboDggMh2zJCtNQ6rs6E2iqP/1e66746b-9a4c-440f-914d-c53ca6eaddfb.zip
→ merge its `world/` folder into `public/assets/world/`.

**Route 2 — build them yourself (bulletproof).** Needs ffmpeg on PATH:
```
node get-assets.mjs
```
Downloads the generated sources from their public CDN URLs and produces every
derived file (desktop CRF 20/GOP 8, mobile 720p CRF 23/GOP 4, posters cut from
the encoded clips, 2048-wide plates, OG card). ~30 seconds on any connection.

**Route 3 — raw sources.** Every generated original is a plain public URL
listed inside `get-assets.mjs` — grab them with a browser if all else fails.

## Files
- `public/index.html` — the whole site (v63)
- `public/vendor/oo-scrub.js` — the film engine
- `get-assets.mjs` — asset builder (route 2)
- `DESIGN.md` — the design contract: concept, palette defense, journey map,
  encode budgets, accessibility floor
