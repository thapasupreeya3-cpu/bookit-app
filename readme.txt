BookIt v86.7.1 — the tier system (illustrated badges, ladder page, animated avatar ring)

WHAT'S IN THIS ZIP:
  server.js
  public/index.html
  public/assets/tiers/tier-bronze.svg      (the badge artwork — NEW folder)
  public/assets/tiers/tier-silver.svg
  public/assets/tiers/tier-gold.svg
  public/assets/tiers/tier-platinum.svg
  package.json
  lib/version.js

TO DEPLOY: upload these over the same paths on the server, keeping the
folder layout (the four SVGs go into public/assets/tiers/ — create the
folder if it doesn't exist), then restart:  sudo systemctl restart bookit

No database work needed — the one migration runs itself at boot, and
demonstration workers spread themselves across the four levels (once) so
every badge can be seen before launch.
