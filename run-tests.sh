#!/bin/bash
# The whole regression in one go.
#
#   ./run-tests.sh          everything
#   ./run-tests.sh e2e      just the API suites
#   ./run-tests.sh ui       just the browser suites
#   ./run-tests.sh shiftnotes   anything whose name contains "shiftnotes"
#
# The e2e suites start and stop their own server. The browser suites don't, so
# this script gives each one a clean database on its own port and takes it away
# again afterwards — that's the only reason this file exists.
#
# The suites themselves live in tests/. Everything runs with the repo root as the
# working directory, so server.js, public/ and the databases are always found in
# the same place no matter where the repo is checked out.
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
WHICH="${1:-all}"
SUITES=0; GREEN=0; CHECKS=0; RED=""

run_e2e(){
  local f=$1
  case "$WHICH" in all|e2e) ;; *) [[ "$f" == *"$WHICH"* ]] || return 0 ;; esac
  SUITES=$((SUITES+1))
  echo; echo "════ $f"
  if bash "tests/$f" > "/tmp/out-$f.log" 2>&1; then
    GREEN=$((GREEN+1)); CHECKS=$((CHECKS+$(grep -c '✓' "/tmp/out-$f.log"))); echo "     $(grep -E '^(UI )?RESULT' "/tmp/out-$f.log" | tail -1)"
  else
    RED="$RED $f"; echo "     FAILED — $(grep -E '^(UI )?RESULT' "/tmp/out-$f.log" | tail -1)"
    grep '✗' "/tmp/out-$f.log" | head -12
  fi
}

# ui <file> <port> <seed-demo> [extra env]
run_ui(){
  local f=$1 port=$2 seed=$3 extra=$4
  case "$WHICH" in all|ui) ;; *) [[ "$f" == *"$WHICH"* ]] || return 0 ;; esac
  SUITES=$((SUITES+1))
  echo; echo "════ $f"
  local db="./t$port.db"
  rm -f "$db" "$db-wal" "$db-shm"
  fuser -k "$port/tcp" 2>/dev/null; sleep 0.3
  env PORT=$port DB_PATH="$db" SEED_DEMO=$seed SMTP_USER=hello@bookit.life \
      APP_URL="http://localhost:$port" ADMIN_EMAILS=boss@test.com $extra \
      node server.js > "/tmp/srv-$port.log" 2>&1 &
  disown 2>/dev/null
  sleep 1.6
  if node "tests/$f" > "/tmp/out-$f.log" 2>&1; then
    GREEN=$((GREEN+1)); CHECKS=$((CHECKS+$(grep -c '✓' "/tmp/out-$f.log"))); echo "     $(grep -E '^(UI )?RESULT' "/tmp/out-$f.log" | tail -1)"
  else
    RED="$RED $f"; echo "     FAILED — $(grep -E '^(UI )?RESULT|^CRASH' "/tmp/out-$f.log" | tail -1)"
    grep '✗' "/tmp/out-$f.log" | head -12
  fi
  fuser -k "$port/tcp" 2>/dev/null; sleep 0.2
  rm -f "$db" "$db-wal" "$db-shm"
}

# ui-upload-fix-test.js needs three large files that aren't shipped in the zip.
if [ ! -f big-photo.jpg ] || [ ! -f big-scan.png ] || [ ! -f fake-big.pdf ]; then
  echo "Building test fixtures (first run only)…"
  tests/make-fixtures.sh || echo "  …skipping — ui-upload-fix-test.js will fail without them."
fi

echo "BookIt regression — $(date '+%d/%m/%Y %H:%M')"

run_e2e e2e-admin-test.sh
run_e2e e2e-catalog-test.sh
run_e2e e2e-claims-test.sh
run_e2e e2e-compliance-test.sh
run_e2e e2e-email-test.sh
run_e2e e2e-highintensity-test.sh
run_e2e e2e-invoice-test.sh
run_e2e e2e-launch-test.sh
run_e2e e2e-profile-test.sh
run_e2e e2e-reviews-test.sh
run_e2e e2e-shiftnotes-test.sh
run_e2e e2e-sil-test.sh
run_e2e e2e-stripe-test.sh

run_ui ui-email-test.js        3100 on
run_ui ui-acct-menu-test.js    3111 on
run_ui ui-upload-fix-test.js   3112 on
run_ui ui-profile-test.js      3114 on
run_ui ui-catalog-test.js      3116 on
run_ui ui-reviews-test.js      3120 off
run_ui ui-admin-smoke-test.js  3123 on
run_ui ui-highintensity-test.js 3127 off
run_ui ui-shiftnotes-test.js   3129 off
run_ui ui-cover-test.js        3131 off

echo
echo "═══════════════════════════════════════════"
if [ -z "$RED" ]; then
  echo "  $GREEN/$SUITES suites green — $CHECKS checks passed."
else
  echo "  $GREEN/$SUITES suites green ($CHECKS checks). FAILED:$RED"
  echo "  logs in /tmp/out-*.log"
fi
[ -z "$RED" ]
