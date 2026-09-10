The Care Web v87.0.1 — source-review corrections and workflow improvements.

Read STARTHERE.txt before uploading or deploying. This is an overlay for the
uploaded v86.12.0 repository, not a replacement for its unchanged assets.
Extract the ZIP and upload its contents at the existing repository root.

Install/check: npm ci --ignore-scripts && npm run check
Refresh generated release documents: npm run release:docs
Read-only existing-data triage on the authorised host:
  node scripts/review-existing-data.js /actual/path/to/bookit.db

See docs/IMPLEMENTATION-MATRIX.md, docs/RELEASE-NOTES.md and docs/TEST-RESULTS.md.
The release has not been pushed to GitHub or deployed to the live site.
