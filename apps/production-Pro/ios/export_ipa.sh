#!/bin/bash
# Preview/TestFlight IPA export for NAHTREEK Pro.
# Usage: APPLE_TEAM_ID=ABC123DEF4 [METHOD=app-store|ad-hoc] ./export_ipa.sh
# Requires: Xcode, CocoaPods, certs+profiles for com.nahtreek.professional installed.
set -euo pipefail
cd "$(dirname "$0")"

if [ -z "${APPLE_TEAM_ID:-}" ]; then
  echo "APPLE_TEAM_ID is required (your 10-char Apple Developer Team ID)." >&2
  exit 1
fi
METHOD="${METHOD:-app-store}"
OUT_DIR="${OUT_DIR:-./build-ipa}"
VERSION="${NAHTREEK_VERSION_NAME:-1.0.0-preview}"
BUILD="${NAHTREEK_VERSION_CODE:-1}"

pod install --no-repo-update

cat > ExportOptions.generated.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>${METHOD}</string>
  <key>teamID</key>
  <string>${APPLE_TEAM_ID}</string>
  <key>uploadBitcode</key>
  <false/>
  <key>compileBitcode</key>
  <false/>
  <key>uploadSymbols</key>
  <true/>
</dict>
</plist>
PLIST

xcodebuild -workspace NahtreekProfessional.xcworkspace \
  -scheme NahtreekProfessional \
  -configuration Release \
  -archivePath "$OUT_DIR/NahtreekProfessional.xcarchive" \
  MARKETING_VERSION="$VERSION" \
  CURRENT_PROJECT_VERSION="$BUILD" \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
  clean archive

xcodebuild -exportArchive \
  -archivePath "$OUT_DIR/NahtreekProfessional.xcarchive" \
  -exportOptionsPlist ExportOptions.generated.plist \
  -exportPath "$OUT_DIR"

echo "IPA exported to $OUT_DIR"
