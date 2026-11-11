# E2E smoke suite (adb + emulator, no new dependencies)

Why shell instead of Maestro/Detox: those need installs and emulators with
specific keyboards; `adb` + `uiautomator` already drive every assertion here
and run anywhere Android SDK exists, including GitHub Actions.

## Flows

| Script | Needs | Covers |
|---|---|---|
| `home-guest.sh` | nothing | launch → guest entry → Find tab → Find-from-stack (Saved-crash regression) |
| `pro-login.sh` | `E2E_PRO_EMAIL` + `E2E_PRO_PASSWORD` | onboarding → login → home → jobs inbox |
| `home-login.sh` | `E2E_CLIENT_EMAIL` + `E2E_CLIENT_PASSWORD` | login → Profile → Saved → Discover engineers (exact reported path) |

Login flows skip with exit 0 when their credentials are unset. Never commit
credentials — pass staging demo accounts via environment only.

## Local run

```sh
# 1. Boot any API 33+ emulator and build the internal APKs:
cd apps/production-Pro && ./android/gradlew -p android app:assembleInternal
cd ../production-Home && ./android/gradlew -p android app:assembleInternal

# 2. Run (guest always; logins need env):
cd ../../e2e
APK_HOME=../apps/production-Home/android/app/build/outputs/apk/internal/app-internal.apk \
APK_PRO=../apps/production-Pro/android/app/build/outputs/apk/internal/app-internal.apk \
E2E_PRO_EMAIL=... E2E_PRO_PASSWORD=... \
E2E_CLIENT_EMAIL=... E2E_CLIENT_PASSWORD=... \
sh ./run-all.sh
```

Screenshots land in `e2e/e2e-out/` (gitignored). Typing uses `adb input
text`, which is exact on AOSP keyboards; Gboard images may drop
shift-modified characters — prefer an AOSP (`aosp_atd`) emulator.

## CI

`.github/workflows/ci.yml` job `e2e-android` (pull requests only): builds
both internal APKs, boots API 34, runs `run-all.sh`. Guest assertions always
execute; login assertions execute only when the `E2E_*` repository secrets
exist.

## Adding a flow

Source `common.sh` and use `install_apk/clear_app/start_app`, `tap_text/
tap_button/type_text/keyevent/swipe`, `assert_visible/assert_absent`,
`screenshot`, `finish`. Prefer tapping by visible text over coordinates;
prefer assertions on user-visible copy over view counts.
