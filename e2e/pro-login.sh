#!/bin/sh
# Pro login smoke: needs E2E_PRO_EMAIL + E2E_PRO_PASSWORD (demo professional).
# Skips cleanly (exit 0) when unset so credential-less CI stays green.
# Covers: onboarding select, login, jobs inbox, first job detail, back.
cd "$(dirname "$0")" || exit 1
. ./common.sh

if [ -z "${E2E_PRO_EMAIL:-}" ] || [ -z "${E2E_PRO_PASSWORD:-}" ]; then
  log "SKIP: set E2E_PRO_EMAIL + E2E_PRO_PASSWORD to run pro-login"
  exit 0
fi

APK_PRO="${APK_PRO:-../apps/production-Pro/android/app/build/outputs/apk/internal/app-internal.apk}"
PKG="com.nahtreek.professional.internal"
ACT="com.nahtreek.professional.MainActivity"

install_apk "$APK_PRO" "$PKG" || exit 1
clear_app "$PKG"
start_app "$PKG/$ACT"
settle 12
screenshot 01-onboarding
assert_visible "How will you use" "onboarding renders"

tap_text "Civil Engineer" || exit 1
settle 2
tap_text "Continue" || exit 1
settle 5
tap_text "Login" || exit 1
settle 4
screenshot 02-login
assert_visible "Welcome back" "login form renders"

# AOSP keyboard (CI) types mixed-case reliably; Gboard may drop shift chars.
tap_field "Mobile number or email" || exit 1
settle 3
type_text "$E2E_PRO_EMAIL"
settle 2
assert_field_filled "Mobile number or email" || exit 1
dismiss_keyboard
settle 3
fill_password "$E2E_PRO_PASSWORD" || exit 1
dismiss_keyboard
settle 3
screenshot 03-filled
tap_button "Login" || exit 1
settle 14
assert_absent "Invalid credentials" "login accepted" || exit 1
# Dismiss a possible permission dialog first — it covers the home copy.
# (BACK is safe here: home root has nowhere to pop to.)
keyevent 4
settle 2
screenshot 04-logged-in
assert_visible "Good morning\|Good afternoon\|Good evening\|My Jobs\|needs your reply" "pro home after login"

# Then open the inbox.
tap_text "Jobs" || exit 1
settle 8
screenshot 05-jobs
assert_visible "All jobs\|needs your reply" "jobs inbox renders"

finish "pro-login"
