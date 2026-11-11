#!/bin/sh
# Runs the whole E2E smoke suite. Guest flows always run; login flows skip
# unless their credentials are provided (see README). Exit nonzero on any
# assertion failure.
cd "$(dirname "$0")" || exit 1
FAILS=0
sh ./home-guest.sh || FAILS=$((FAILS + 1))
sh ./pro-login.sh || FAILS=$((FAILS + 1))
sh ./home-login.sh || FAILS=$((FAILS + 1))
if [ "$FAILS" -eq 0 ]; then echo "[e2e] SUITE GREEN"; else echo "[e2e] SUITE FAILURES: $FAILS"; fi
exit "$FAILS"
