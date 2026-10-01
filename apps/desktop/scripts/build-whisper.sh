#!/bin/bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
build_root="${DOODLE_WHISPER_BUILD_ROOT:-$repo_root/engine/.build/whisper}"
source_dir="$build_root/source"
revision=927cfce34f31707e17f2bff35c349632fb9e2c3a
mkdir -p "$build_root"
if [ ! -d "$source_dir/.git" ]; then
  git clone --no-checkout https://github.com/ggml-org/whisper.cpp.git "$source_dir"
fi
git -C "$source_dir" fetch origin "$revision"
git -C "$source_dir" checkout --detach "$revision"
cmake -S "$source_dir" -B "$build_root/build" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_DEPLOYMENT_TARGET=14.0 \
  -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_CPU_ARM_ARCH=armv8.4-a \
  -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON \
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON
cmake --build "$build_root/build" --target whisper-cli -j 6
cp "$build_root/build/bin/whisper-cli" "$build_root/whisper-cli"
cp "$source_dir/LICENSE" "$build_root/whisper-LICENSE.txt"
echo "Whisper native backend: $build_root/whisper-cli"
