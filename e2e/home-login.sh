#!/bin/sh
# Home login smoke: needs E2E_CLIENT_EMAIL + E2E_CLIENT_PASSWORD (demo client).
# Skips cleanly (exit 0) when unset so credential-less CI stays green.
# Covers: login, Profile -> Saved professionals, Discover engineers
# (the exact reported crash path: stack-pushed Find must render, not error).
cd "$(dirname "$0")" || exit 1
. ./common.sh

if [ -z "${E2E_CLIENT_EMAIL:-}" ] || [ -z "${E2E_CLIENT_PASSWORD:-}" ]; then
  log "SKIP: set E2E_CLIENT_EMAIL + E2E_CLIENT_PASSWORD to run home-login"
  exit 0
fi

APK_HOME="${APK_HOME:-../apps/production-Home/android/app/build/outputs/apk/internal/app-internal.apk}"
PKG="com.nahtreek.client.internal"
ACT="com.nahtreek.client.MainActivity"

install_apk "$APK_HOME" "$PKG" || exit 1
clear_app "$PKG"
start_app "$PKG/$ACT"
settle 12
screenshot 01-login
assert_visible "Welcome back" "login renders"

tap_field "Mobile number or email" || exit 1
settle 3
type_text "$E2E_CLIENT_EMAIL"
settle 2
assert_field_filled "Mobile number or email" || exit 1
dismiss_keyboard
settle 3
fill_password "$E2E_CLIENT_PASSWORD" || exit 1
dismiss_keyboard
settle 3
screenshot 02-filled
tap_button "Login" || exit 1
settle 14
assert_absent "Invalid credentials" "login accepted" || exit 1
# Dismiss a possible permission dialog first — it covers the home copy.
# (BACK is safe here: home root has nowhere to pop to.)
keyevent 4
settle 2
screenshot 03-logged-in
assert_visible "Hello," "client home after login"
assert_visible "Search services" "client home search renders"

tap_text "Profile" || exit 1
settle 6
swipe 160 500 160 200
settle 2
tap_text "Saved professionals" || exit 1
settle 6
screenshot 04-saved
assert_visible "Saved\|Nothing saved yet" "saved screen renders"

tap_text "Discover engineers" || exit 1
settle 8
screenshot 05-discover
assert_visible "Search by skill" "Find renders from Saved (crash regression)"
assert_visible "Engineers" "Find segments render from Saved"

finish "home-login"
