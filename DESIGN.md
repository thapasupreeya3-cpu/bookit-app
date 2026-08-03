# BookIt v63 — design brief ("The Fit")

## Design read
Australians with disability, their families, and support workers choosing each
other. Register: capable, warm, cinematic dignity. Premium without corporate
chill; playful without infantilising. Accessibility is not a mode, it is the
grade.

## Concept spine
**Two circles finding each other.** The whole site is the story of the "oo" in
BookIt: two rings (you, your worker) that meet, fit, and link. The scroll film
enacts it, the wordmark performs it, progress markers and checks speak ring.

## Delivery tier
cinema. Animation mode: **animated-website** (user picked Animated at intake).

## Journey
Shape: **single-shot** — one continuous ~12s macro film, scrubbed by scroll.

| # | span | chapter | headline | note |
|---|------|---------|----------|------|
| 1 | 0.00–0.27 | Two circles | Support that fits your life. | Rings apart, drifting. You choose who, when, how. |
| 2 | 0.27–0.54 | Finding each other | Six kinds of support. One team you choose. | Slow orbit, rings approach. |
| 3 | 0.54–0.80 | The fit | Booked in three easy steps. | Rings interlock; light flares at the join. |
| 4 | 0.80–1.00 | Linked | Every dollar, visible. | Linked pair rests as the "oo". CTA. |

World grammar (byte-identical preamble for film + plates):
"Macro product cinematography. Two glass-ceramic rings, one deep ultramarine
blue, one warm apricot orange, in a seamless deep indigo-navy studio void
(#0B1430). Soft volumetric key light from upper left, subtle floor reflection,
gentle film grain, locked exposure and white balance, no flicker, no on-screen
text, no logos, no watermarks."

Camera: one continuous slow push-in with a quarter orbit. No cuts, no shake,
constant speed, ease only at the extremes. First frame = establishing wide,
rings apart. Last frame = medium close, rings linked, centered. Subject held
center-safe (mobile crops the edges).

Delivery budget: desktop clip ≤ 32 MiB (expect 6–10), mobile ≤ 16 MiB
(expect 3–5). H.264 yuv420p, CRF 20 GOP 8 desktop / CRF 23 GOP 4 720p mobile,
no audio, faststart. Posters are the exact first frame of each encoded clip.

## Locked palette
| token | hex | role |
|---|---|---|
| --paper | #F7F5F0 | porcelain ground (light sections) |
| --ink | #101D33 | marine ink (text) |
| --blue | #2743E0 | ultramarine — ring 1, primary accent |
| --blue-deep | #1B2FA8 | hover / depth |
| --apricot | #FF9E4A | ring 2 — paired accent, graphic fills only, never body text on light |
| --void | #0B1430 | film ground + dark sections |
| --mist | #E7EAF6 | cool tint, cards on paper |
| --ok | #1E7A52 | success / verified |

Defense: a two-accent identity literally is the brand's two circles.
Ultramarine-led on warm porcelain keeps AAA ink contrast for this audience and
sidesteps the dark-ground-amber cliché; the indigo void exists only where copy
sits in white. Ban check: not graphite+orange (light ground, ultramarine-led);
not near-black+neon; not cream+brass/clay/oxblood; no violet; no prior-build
family in this chat.

## Locked type
- Display: **Bricolage Grotesque** — chunky round counters make the oo sing;
  used for h1/h2 and the wordmark's b/kit.
- Body: **Hanken Grotesk** — humanist, high-legibility warmth.
- Utility: **Spline Sans Mono** — NDIS line-item codes, rates, receipts.
  The codes are real content; mono is their native dress.
- The accessibility "readable font" mode (Verdana) and text-size scale are
  preserved exactly as before.

## Signature
The **oo rig**: two SVG rings that appear as (1) the wordmark, (2) the film
progress meter — rings travel toward each other as you scroll and interlock at
the end, (3) list checks (linked-ring tick), (4) the favicon. One motif,
four jobs.

## Section plan (home) — one layout family each
1. Film journey (scrub chapters over video) — Tier-1
2. Line-item marquee (ticker) — kept, restyled mono
3. Services — six generated "scene windows", 3×2 plate grid (#homeServices)
4. How it works — horizontal 3-step rail, linked-ring numerals
5. Pricing — split with mono receipt card
6. Workers — card grid (JS-fed, #homeWorkers)
7. Stories — offset editorial testimonials
8. Worker band — void-dark banner, apricot ring
9. FAQ — accordion (#homeFaq)

Eyebrow budget: 3 (services, pricing, stories). No consecutive layout repeats.

## CTA inventory (each its own garment)
- Browse support workers — ink pill; hover: inner oo dots slide together and
  link, arrow follows.
- Create a free account — ultramarine ring outline; hover: ring-wipe fill.
- Search workers — apricot circle button, arrow.
- See full pricing — mono text link, underline draws left→right.
- Apply now (worker band) — porcelain pill on void, apricot ring on hover.

## Asset plan (Higgsfield = the engine; site ships standalone)
- 1 storyboard sheet (6 panels, one continuous move, 16:9, no text)
- 1 hero film — Seedance 2.0, ~12s, 16:9, 1080p, audio off, storyboard as
  generic style reference (NOT start frame)
- 6 service plates, same world grammar, 16:9:
  employment (0102) / personal care (0107) / transport (0108) /
  daily tasks & shared living (0115) / household (0120) / community (0125)
- OG image + og posters composed in-pipeline from the film poster + wordmark
- Wordmark, favicon, icon set: hand-drawn SVG (ring geometry system)

## Accessibility floor (non-negotiable, carried from v62)
- data-motion="reduce" OR prefers-reduced-motion OR high-contrast:
  zero video fetches, poster still, all four chapters readable in DOM order.
- Text-size scale (100/115/130/150) and readable-font mode untouched.
- Chapter headings in reading order; film controls keyboard reachable;
  active states never hover-only. Skip link first. High-contrast tokens map
  to pure ink on white.

## Out of scope (unchanged)
server.js and all logged-in app pages keep their markup and IDs; they inherit
the new token system only. JS mounts preserved: #homeServices, #homeWorkers,
#homeFaq, #heroRotate (retired gracefully), #heroSearch, #heroSearchInput.
