#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BUILD_DIR="$ROOT/targets/web/test/.build"
CXX_BIN="${CXX:-clang++}"

mkdir -p "$BUILD_DIR"

"$CXX_BIN" -std=c++20 \
  -I "$ROOT/lib/gea-embedded" \
  -I "$ROOT/lib/gea-embedded/include" \
  "$ROOT/targets/web/main/web_platform.cpp" \
  "$ROOT/targets/web/test/test_web_touch_state.cpp" \
  -o "$BUILD_DIR/test_web_touch_state"

"$BUILD_DIR/test_web_touch_state"
