#!/bin/bash
# Verify the actual distributed payload; never changes a production feed.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
desktop_dir="$(cd -- "$script_dir/.." && pwd)"
release_dir="$desktop_dir/release"
version="$(node -p "require(process.argv[1]).version" "$desktop_dir/package.json")"
expected_team="${EXPECTED_TEAM_ID:?Expected signing team must be set}"
app="$release_dir/mac-arm64/DoodleNote.app"
zip="$release_dir/DoodleNote-${version}-arm64-mac.zip"
dmg="$release_dir/DoodleNote-${version}-arm64.dmg"
manifest="$release_dir/latest-mac.yml"

test -d "$app"
test -f "$zip"
test -f "$dmg"
test -f "$manifest"
test "${#expected_team}" -eq 10
case "$expected_team" in *[!A-Z0-9]*) exit 1 ;; esac

verify_app() {
  local bundle="$1"
  codesign --verify --deep --strict --verbose=2 "$bundle"
  codesign --display --verbose=4 "$bundle" 2>&1 | grep -Fx "TeamIdentifier=$expected_team"
  node "$script_dir/stapler.cjs" validate "$2" "$bundle"
  spctl --assess --type execute --verbose=2 "$bundle"
  test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$bundle/Contents/Info.plist")" = "$version"
}

verify_app "$app" build-app
codesign --verify --strict --verbose=2 "$dmg"
codesign --display --verbose=4 "$dmg" 2>&1 | grep -Fx "TeamIdentifier=$expected_team"
node "$script_dir/stapler.cjs" validate dmg "$dmg"
spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"

verify_dir="$(mktemp -d "${TMPDIR:-/tmp}/doodlenote-release-verify.XXXXXX")"
mounted=false
cleanup() {
  if "$mounted"; then hdiutil detach "$verify_dir/mount"; fi
  rm -rf "$verify_dir"
}
trap cleanup EXIT
ditto -x -k "$zip" "$verify_dir/zip"
verify_app "$verify_dir/zip/DoodleNote.app" zip-app
diff -qr "$app" "$verify_dir/zip/DoodleNote.app"
mkdir "$verify_dir/mount"
hdiutil attach "$dmg" -readonly -nobrowse -mountpoint "$verify_dir/mount"
mounted=true
verify_app "$verify_dir/mount/DoodleNote.app" dmg-app
diff -qr "$app" "$verify_dir/mount/DoodleNote.app"
hdiutil detach "$verify_dir/mount"
mounted=false
ruby "$script_dir/mac-release-manifest.rb" "$release_dir" "$version"

{
  printf 'Source commit: %s\n' "${GITHUB_SHA:-$(git -C "$desktop_dir" rev-parse HEAD)}"
  printf 'Version: %s\nSigning team: %s\n' "$version" "$expected_team"
  printf 'Verified app/ZIP/DMG payloads, signatures, tickets, Gatekeeper, version and manifest SHA-512 hashes.\n'
  shasum -a 256 "$zip" "$dmg" "$manifest"
} > "$release_dir/release-receipt.txt"
cat "$release_dir/release-receipt.txt"
