#!/bin/bash
# Build the isolated "DoodleNote Dev" macOS app. Local only: it never signs with
# a distribution identity, notarizes, publishes or uploads anything.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
desktop="$(cd "$here/.." && pwd)"
root="$(cd "$desktop/../.." && pwd)"

echo "== native engine and dictation helper"
swift build -c release --package-path "$root/engine"

echo "== MCP bundle (shipped inside the app; sandboxed in the dev profile)"
pnpm --dir "$root" --filter doodle-note-mcp build

echo "== app code (channel: dev)"
cd "$desktop"
DOODLENOTE_CHANNEL=dev pnpm exec electron-vite build

# Signing. The default is an ad-hoc signature, which needs no certificate and
# no Keychain access, but macOS forgets permission grants (Microphone,
# Accessibility) whenever the app is rebuilt. For grants that survive rebuilds,
# name a local development certificate explicitly, e.g.
#   DOODLENOTE_DEV_IDENTITY="Apple Development: Your Name (TEAMID)"
# The first signing may ask for Keychain access to that key. A distribution
# (Developer ID) certificate is refused: this build must never look shippable.
identity="${DOODLENOTE_DEV_IDENTITY:--}"
case "$identity" in
  *"Developer ID"*) echo "Refusing a Developer ID certificate for a development build." >&2; exit 1 ;;
esac
if [ "$identity" = "-" ]; then
  echo "== signing: ad-hoc (permission grants reset on rebuild; see DOODLENOTE_DEV_IDENTITY)"
  export CSC_IDENTITY_AUTO_DISCOVERY=false
else
  echo "== signing identity: $identity"
  export CSC_NAME="${identity#Apple Development: }"
fi
sign_args=(--config.mac.identity="$identity")

echo "== package"
pnpm exec electron-builder --mac dir --arm64 --publish never \
  --config electron-builder.dev.yml "${sign_args[@]}"

app="$desktop/release-dev/mac-arm64/DoodleNote Dev.app"
echo "Built: $app"
bash "$here/verify-dev-app.sh" "$app"
