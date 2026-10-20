#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/doodle-audio-import-tests.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT
sdk=${SDKROOT:-$(xcrun --sdk macosx --show-sdk-path)}
swiftc -swift-version 5 -parse-as-library -sdk "$sdk" -target arm64-apple-macosx14.0 \
  engine/Sources/engine/EngineError.swift \
  engine/Sources/engine/AudioFilePreparation.swift \
  engine/tests/AudioImportTests.swift -o "$test_dir/audio-import-tests"
"$test_dir/audio-import-tests" "$test_dir/fixtures"
