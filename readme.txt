BookIt v86.7.0 — the tier system (medallions, ladder page, profile badges)

WHAT'S IN THIS ZIP — the four files that changed:
  server.js
  public/index.html
  package.json
  lib/version.js

TO DEPLOY: upload these four over the same files on the server, keeping the
folder layout (lib/version.js into lib/, public/index.html into public/),
then restart:  sudo systemctl restart bookit

Nothing else changed. No database work needed — the one migration in it
runs itself at boot, and demonstration workers spread themselves across the
four levels (once) so every medal can be seen before launch.
