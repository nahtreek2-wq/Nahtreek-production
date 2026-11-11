#!/bin/sh
# Home guest smoke: no credentials needed, always runs (local + CI).
# Covers: cold launch, guest entry, Find tab render, Find-from-stack
# regression (the Saved/Search crash: stack route must render, not error).
cd "$(dirname "$0")" || exit 1
. ./common.sh

APK_HOME="${APK_HOME:-../apps/production-Home/android/app/build/outputs/apk/internal/app-internal.apk}"
PKG="com.nahtreek.client.internal"
ACT="com.nahtreek.client.MainActivity"

install_apk "$APK_HOME" "$PKG" || exit 1
clear_app "$PKG"
start_app "$PKG/$ACT"
settle 12
screenshot 01-launch
# Guest entry sits below the fold on small screens.
swipe 160 500 160 200
settle 2
assert_visible "Explore without an account" "guest entry visible"

tap_text "Explore without an account" || exit 1
settle 10
screenshot 02-guest-home
assert_visible "Make yourself at home" "guest home renders"

# Find tab (tab context must keep working).
tap_text "Find" || exit 1
settle 8
screenshot 03-find-tab
assert_visible "text=\"Find\"" "Find tab header renders"

# Find-from-stack regression: Home hero button pushes the stack route, which
# used to crash on the tab-height hook (error page instead of Find).
tap_text "Home" || exit 1
settle 5
tap_text "Find professionals" || exit 1
settle 8
screenshot 04-find-stack
assert_visible "Search by skill" "Find renders from stack push (crash regression)"
assert_visible "Engineers" "Find segments render from stack push"

finish "home-guest"
