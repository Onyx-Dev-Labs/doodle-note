#!/bin/bash
# Confirm a built DoodleNote Dev app is isolated from the shipping app.
# Usage: verify-dev-app.sh [path/to/DoodleNote Dev.app]
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
app="${1:-$here/../release-dev/mac-arm64/DoodleNote Dev.app}"
fail=0
check() { # description, command...
  local what="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "  ok   $what"; else echo "  FAIL $what"; fail=1; fi
}
plist() { /usr/libexec/PlistBuddy -c "Print :$1" "$app/Contents/Info.plist" 2>/dev/null; }

echo "Verifying $app"
check "app bundle exists" test -d "$app"
check "bundle id is com.doodlenote.desktop.dev" test "$(plist CFBundleIdentifier)" = "com.doodlenote.desktop.dev"
check "bundle name is DoodleNote Dev" test "$(plist CFBundleName)" = "DoodleNote Dev"
check "bundle id differs from production" test "$(plist CFBundleIdentifier)" != "com.doodlenote.desktop"
check "no update feed shipped (no app-update.yml)" test ! -e "$app/Contents/Resources/app-update.yml"
check "engine binary present" test -x "$app/Contents/Resources/engine/engine"
check "dictation helper present" test -x "$app/Contents/Resources/engine/dictation-helper"
check "microphone usage text present" test -n "$(plist NSMicrophoneUsageDescription)"
check "code signature is valid (deep, strict)" codesign --verify --deep --strict "$app"
check "not signed with a distribution (Developer ID) certificate" \
  bash -c "! codesign -dv --verbose=2 '$app' 2>&1 | grep -q 'Authority=Developer ID'"
asar="$app/Contents/Resources/app.asar"
check "app code carries the dev profile name" bash -c "strings '$asar' | grep -q 'DoodleNote Dev'"
check "no production updater URL in app resources" \
  bash -c "! grep -rqs 'doodlenote.ai/updates' '$app/Contents/Resources' --include='*.yml' --include='*.json'"
[ $fail -eq 0 ] && echo "Dev app isolation checks passed." || { echo "Some checks failed."; exit 1; }
