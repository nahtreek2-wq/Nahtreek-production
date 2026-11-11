#!/bin/sh
# Shared helpers for the adb-driven E2E smoke suite. POSIX sh + adb only —
# no new dependencies, runs locally and in CI (android-emulator-runner).
# Usage: . ./common.sh   (from the e2e/ directory)
E2E_OUT="${E2E_OUT:-./e2e-out}"
E2E_FAILS=0
ADB="${ADB:-adb}"

mkdir -p "$E2E_OUT"

log() { printf '[e2e] %s\n' "$*"; }
fail() { printf '[e2e] FAIL: %s\n' "$*"; E2E_FAILS=$((E2E_FAILS + 1)); return 1; }
pass() { printf '[e2e] PASS: %s\n' "$*"; }

wait_for_boot() {
  $ADB wait-for-device
  i=0
  while [ "$i" -lt 60 ]; do
    if [ "$($ADB shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
      log "emulator booted"; return 0
    fi
    sleep 5; i=$((i + 1))
  done
  fail "emulator never booted"; return 1
}

dump_ui() {
  # Refresh /sdcard/e2e-ui.xml; prints nothing on success.
  $ADB shell uiautomator dump /sdcard/e2e-ui.xml > /dev/null 2>&1
  $ADB shell cat /sdcard/e2e-ui.xml 2>/dev/null | tr '><' '\n' > "$E2E_OUT/ui.xml"
}

# assert_visible <grep-pattern> <label>
assert_visible() {
  dump_ui
  if grep -qi "$1" "$E2E_OUT/ui.xml"; then pass "$2"; else fail "$2 (missing: $1)"; fi
}

# assert_absent <grep-pattern> <label>
assert_absent() {
  dump_ui
  if grep -qi "$1" "$E2E_OUT/ui.xml"; then fail "$2 (unexpected: $1)"; else pass "$2"; fi
}

# tap_node <grep-pattern>: taps the center of the first matching node.
tap_node() {
  dump_ui
  bounds=$(grep "$1" "$E2E_OUT/ui.xml" | grep -o 'bounds="[^"]*"' | head -n 1 | sed 's/bounds="//;s/"//')
  if [ -z "$bounds" ]; then fail "tap target missing: $1"; return 1; fi
  x1=$(echo "$bounds" | sed 's/\[//;s/\].*//;s/,.*//'); y1=$(echo "$bounds" | sed 's/\[//;s/\].*//;s/.*,//')
  x2=$(echo "$bounds" | sed 's/.*\[//;s/\].*//;s/,.*//'); y2=$(echo "$bounds" | sed 's/.*\[//;s/\].*//;s/.*,//')
  $ADB shell input tap $(((x1 + x2) / 2)) $(((y1 + y2) / 2))
}

# tap_text <visible-text>: taps the first node whose text or content-desc
# contains the string. Returns nonzero if missing.
tap_text() {
  tap_node "text=\"[^\"]*$1[^\"]*\"\|content-desc=\"[^\"]*$1[^\"]*\""
}

# tap_button <text>: same, but prefers android.widget.Button nodes (submit
# buttons often share their label with tabs or headings).
tap_button() {
  tap_node "class=\"android.widget.Button\".*$1\|$1.*class=\"android.widget.Button\""
}

# tap_field <label>: taps the EditText for a labeled field. Plain tap_text
# would hit the static label TextView (same text, earlier in the dump) and
# focus would never move — the classic empty-credentials failure.
tap_field() {
  tap_node "class=\"android.widget.EditText\".*$1\|$1.*class=\"android.widget.EditText\""
}

# assert_field_filled <label>: fails unless the EditText holds user input
# (placeholder text means the tap or the typing missed — fail fast here
# instead of submitting empty credentials and debugging "invalid login").
assert_field_filled() {
  dump_ui
  line=$(grep "class=\"android.widget.EditText\".*$1\|$1.*class=\"android.widget.EditText\"" "$E2E_OUT/ui.xml" | head -n 1)
  content=$(echo "$line" | grep -o 'text="[^"]*"' | head -n 1)
  case "$content" in
    'text=""'|'text="Mobile number or email"'|'text="Enter password"'|'text="At least 8 characters"')
      fail "field empty, tap or typing missed: $1"; return 1;;
    *) pass "field filled: $1";;
  esac
}

# fill_password <password>: types into the Password field and verifies the
# exact content via the reveal toggle, retrying once after clearing.
# Gboard silently drops, doubles, or decases shift-modified characters, so
# unverified typing is the #1 source of flaky "invalid credentials"
# failures. (AOSP keyboards type cleanly.) The password value itself is
# never printed — only match/mismatch.
fill_password() {
  _type_password_once "$1" || return 1
  if _password_text_matches "$1"; then return 0; fi
  log "retyping password (content mismatch)"
  _clear_password_field || return 1
  _type_password_once "$1" || return 1
  if _password_text_matches "$1"; then return 0; fi
  fail "password typing unreliable after retry (wanted ${#1} chars)"
  return 1
}

_type_password_once() {
  tap_field "Password" || return 1
  settle 3
  type_text "$1"
  settle 2
}

_password_text_matches() {
  dump_ui
  if ! grep -q "content-desc=\"Show password\"" "$E2E_OUT/ui.xml"; then
    # No reveal toggle on this screen: fall back to dot-count verification.
    dots=$(grep "content-desc=\"Password\"" "$E2E_OUT/ui.xml" | head -n 1 \
      | grep -o 'text="[^"]*"' | head -n 1 | grep -o "•" | wc -l | tr -d ' ')
    [ "$dots" = "${#1}" ]
    return
  fi
  tap_node "content-desc=\"Show password\"" > /dev/null 2>&1 || return 1
  settle 2
  dump_ui
  actual=$(grep "content-desc=\"Password\"" "$E2E_OUT/ui.xml" | head -n 1 \
    | grep -o 'text="[^"]*"' | head -n 1 | sed 's/^text="//;s/"$//')
  dump_ui
  if grep -q 'content-desc="Hide password"' "$E2E_OUT/ui.xml"; then
    tap_node 'content-desc="Hide password"' > /dev/null 2>&1 || true
  fi
  [ "$actual" = "$1" ]
}

_clear_password_field() {
  tap_field "Password" || return 1
  settle 2
  $ADB shell input keyevent 123
  sleep 1
  i=0
  while [ "$i" -lt 45 ]; do $ADB shell input keyevent 67; i=$((i + 1)); done
  settle 1
}

tap() { $ADB shell input tap "$1" "$2"; }
swipe() { $ADB shell input swipe "$1" "$2" "$3" "$4"; }
type_text() { $ADB shell input text "$1"; }
keyevent() { $ADB shell input keyevent "$1"; }

# dismiss_keyboard: BACK only while the IME is actually showing. A blind
# BACK with the keyboard down pops navigation (we lost a login screen that
# way); ESC is unreliable on Gboard. Queries mInputShown, retries 3x.
dismiss_keyboard() {
  i=0
  while [ "$i" -lt 3 ]; do
    shown=$($ADB shell dumpsys input_method 2>/dev/null | grep -c "mInputShown=true")
    if [ "${shown:-0}" -eq 0 ]; then return 0; fi
    $ADB shell input keyevent 4
    sleep 2
    i=$((i + 1))
  done
  return 0
}
screenshot() { $ADB exec-out screencap -p > "$E2E_OUT/$1.png"; }
settle() { sleep "${1:-3}"; }

install_apk() {
  # Uninstall first: a CI-fresh build may carry a lower versionCode than
  # whatever a previous run left on the device (downgrades are rejected).
  $ADB uninstall "$2" > /dev/null 2>&1
  if $ADB install "$1" 2>&1 | grep -q Success; then pass "installed $(basename "$1")";
  else fail "install failed: $1"; return 1; fi
}

start_app() { $ADB shell am start -n "$1" > /dev/null 2>&1; }
clear_app() { $ADB shell pm clear "$1" > /dev/null 2>&1; }

finish() {
  if [ "$E2E_FAILS" -eq 0 ]; then log "ALL GREEN ($1)"; else log "$E2E_FAILS FAILURES ($1)"; fi
  return "$E2E_FAILS"
}
