#!/bin/bash
# Test fixtures for ui-upload-fix-test.js — a phone-sized photo, a scanned
# certificate and an oversized PDF. They're generated rather than shipped because
# together they're ~20 MB of noise; run-tests.sh calls this when they're missing.
#
#   ./make-fixtures.sh          make anything that isn't there
#   ./make-fixtures.sh --force  make them again from scratch
cd "$(dirname "$0")/.." || exit 1   # fixtures belong in the repo root, where the tests look for them
[ "$1" = "--force" ] && rm -f big-photo.jpg big-scan.png fake-big.pdf

if ! command -v convert > /dev/null; then
  echo "make-fixtures: ImageMagick ('convert') isn't installed — ui-upload-fix-test.js needs it."
  echo "  Debian/Ubuntu:  sudo apt-get install -y imagemagick"
  exit 1
fi

# A 4032×3024 phone photo, ~12 MB. Fractal plasma plus noise so JPEG can't quietly
# compress it away — the whole point of the test is that the browser shrinks a
# genuinely huge file before it ever reaches the server.
if [ ! -f big-photo.jpg ]; then
  convert -size 4032x3024 plasma:fractal -attenuate 0.5 +noise Gaussian -quality 95 big-photo.jpg
  echo "big-photo.jpg  $(du -h big-photo.jpg | cut -f1)  $(identify -format '%wx%h' big-photo.jpg)"
fi

# An A4-at-300dpi scanned certificate, ~2 MB PNG.
if [ ! -f big-scan.png ]; then
  convert -size 2480x3508 plasma:fractal -blur 0x8 -colors 24 big-scan.png
  echo "big-scan.png   $(du -h big-scan.png | cut -f1)  $(identify -format '%wx%h' big-scan.png)"
fi

# A 5 MB PDF. Not an image, so the browser can't shrink it — it has to be refused
# with a message a person can understand, which is what the test checks.
if [ ! -f fake-big.pdf ]; then
  { printf '%%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
    printf '2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n%% '
    head -c 4000000 /dev/urandom | base64 | tr -d '\n' | head -c 5000000
    printf '\ntrailer<</Root 1 0 R>>\n%%%%EOF\n'; } > fake-big.pdf
  echo "fake-big.pdf   $(du -h fake-big.pdf | cut -f1)"
fi
