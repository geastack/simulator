#!/usr/bin/env bash
set -euo pipefail

# Builds an app to WASM for the browser simulator.
#
# The simulator simulates the ESP32 build: the app C++ is generated with the
# same geatsc flags the esp32-s3-touch-amoled-2.06 firmware uses (board, font
# DPR, IR/native-renderer backend) so what you see in the browser matches the
# device. Only the final compile differs — emcc/WASM + an RGB565 framebuffer
# presented to a canvas, instead of clang + the QSPI AMOLED panel.

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
APP_ID="${1:-tic-tac-toe}"
WORKSPACE_ROOT="$(cd "$ROOT_DIR/.." && pwd)"
HEAVY_BUILD_LOCK_PATH="${GEA_HEAVY_BUILD_LOCK_PATH:-$WORKSPACE_ROOT/.gea-heavy-build.lock}"
case "$HEAVY_BUILD_LOCK_PATH" in
  /*) ;;
  *) HEAVY_BUILD_LOCK_PATH="$(pwd)/$HEAVY_BUILD_LOCK_PATH" ;;
esac

# --- split-repo resolution -------------------------------------------------
# @geastack/core carries the runtime, UI, build pipeline, bin and vendored libs;
# @geastack/compiler carries geatsc; apps live in the examples repo (or any app
# project). All overridable via env for local dev across sibling checkouts.
# The project is the directory this script runs in -- run it from the app
# project you want to compile, the same way the gea CLI resolves one.
PROJECT_DIR="$(pwd -P)"
# Resolution is anchored at the apps root (where the framework is installed),
# with the caller's cwd as fallback, so the script works from any directory.
# Resolve an installed package's directory, and REPORT the reason when that
# fails instead of discarding it. A package whose exports map does not expose
# "./package.json" fails here exactly like one that was never installed, and
# the two need opposite fixes -- republish the package, or run npm install.
# Discarding node's message made the first look like the second and cost a CI
# run to tell apart. Empty output with a diagnostic on stderr lets the guard
# below decide; the guard, not this helper, ends the build.
resolve_gea_dir() {
  local name="$1" out
  shift
  if ! out="$(node -e '
    const path = require("node:path")
    try {
      process.stdout.write(path.dirname(require.resolve(process.argv[1] + "/package.json", { paths: process.argv.slice(2) })))
    } catch (error) {
      process.stderr.write(String(error.message).split("\n")[0])
      process.exit(1)
    }
  ' "$name" "$@" 2>&1)"; then
    printf 'Cannot resolve %s: %s\n' "$name" "$out" >&2
    return 0
  fi
  printf '%s' "$out"
}
# --- end resolve_gea_dir (the test sources everything above this marker) ---
CORE_DIR="${GEA_CORE_DIR:-$(resolve_gea_dir @geastack/core "$PROJECT_DIR" "$PWD")}"
[[ -n "$CORE_DIR" && -d "$CORE_DIR" ]] || { echo "Cannot resolve @geastack/core (set GEA_CORE_DIR)" >&2; exit 1; }
COMPILER_DIR="${GEA_COMPILER_DIR:-$(resolve_gea_dir @geastack/compiler "$CORE_DIR")}"
[[ -n "$COMPILER_DIR" && -d "$COMPILER_DIR" ]] || { echo "Cannot resolve @geastack/compiler (set GEA_COMPILER_DIR)" >&2; exit 1; }

# Framework source set comes from the shared manifest (single source of truth;
# the package decomposition updates it in one place).
GEA_CORE="$CORE_DIR"
# shellcheck source=/dev/null
source "$CORE_DIR/gea_sources.sh"
# shellcheck source=/dev/null
source "$CORE_DIR/scripts/heavy-build-lock.sh"
# ---------------------------------------------------------------------------
# The app CLI is @geastack/cli.
GEA_CLI="${GEA_CLI_BIN:-}"
if [[ -z "$GEA_CLI" ]]; then
  CLI_DIR="$(resolve_gea_dir @geastack/cli "$PROJECT_DIR" "$PWD")"
  if [[ -n "$CLI_DIR" ]]; then GEA_CLI="$CLI_DIR/bin/gea.mjs"; fi
fi
[[ -n "$GEA_CLI" && -f "$GEA_CLI" ]] || { echo "Cannot resolve @geastack/cli; set GEA_CLI_BIN to its bin/gea.mjs" >&2; exit 1; }

# ESP32 board profile this simulator mirrors (see
# targets/esp32-s3-touch-amoled-2.06/main/CMakeLists.txt). Override via env to
# mirror a different board, e.g. the p4 7" panel:
#   GEA_WEB_CPP_BOARD=esp32-p4-waveshare-touch-lcd-7 GEA_WEB_DEVICE_PIXEL_RATIO=1.0
CPP_BOARD="${GEA_WEB_CPP_BOARD:-esp32-s3-touch-amoled-2.06}"
DEVICE_PIXEL_RATIO="${GEA_WEB_DEVICE_PIXEL_RATIO:-1.5}"
GEA_SOURCE_ENTRY="${GEA_WEB_GEA_SOURCE_ENTRY:-}"
if [[ ! -f "$GEA_SOURCE_ENTRY" ]]; then GEA_SOURCE_ENTRY=""; fi

# Vite 8 (rolldown) needs Node >= 20.19; the geatsc generator runs it.
NODE_MAJOR=$(node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.stdout.write(String(a*1000+b))')
if (( NODE_MAJOR < 20019 )); then
  echo "Node >= 20.19 required (have $(node --version)). Try: nvm use 20.19" >&2
  exit 1
fi

if ! command -v emcc >/dev/null 2>&1; then
  echo "emcc not found on PATH. Install/activate the Emscripten SDK." >&2
  exit 1
fi

IFS=$'\t' read -r APP_ROOT APP_ENTRY APP_RUNTIME APP_NAME < <(node "$GEA_CLI" inspect "$APP_ID" --format shell)
if [[ "$APP_RUNTIME" != "gea" ]]; then
  echo "Unsupported app runtime for $APP_ID: $APP_RUNTIME" >&2
  exit 1
fi
if ! node "$GEA_CLI" list --target web | grep -qx "$APP_ID"; then
  echo "App $APP_ID has web target disabled" >&2
  exit 1
fi
# `inspect` reports an absolute app directory; nothing to join it to.
APP_DIR="$APP_ROOT"

# Normal web, macOS, and ESP32 builds may run concurrently. For controlled
# timings, GEA_SERIALIZE_HEAVY_BUILDS=1 holds the optional workspace lock from
# before the first generated-output mutation through final WASM publication.
gea_acquire_heavy_build_lock "$HEAVY_BUILD_LOCK_PATH" web "$APP_ID"
trap gea_release_heavy_build_lock EXIT

# Optional development fixtures can be mounted into Emscripten's virtual
# filesystem. This keeps simulator paths identical to hardware storage paths.
PRELOAD_ARGS=()
while IFS=$'\t' read -r preload_source preload_target; do
  [[ -n "$preload_source" && -n "$preload_target" ]] || continue
  preload_path="$APP_DIR/$preload_source"
  if [[ ! -e "$preload_path" ]]; then
    echo "Skipping missing web preload: $preload_path" >&2
    continue
  fi
  PRELOAD_ARGS+=(--preload-file "$preload_path@$preload_target")
done < <(node -e '
  try {
    const manifest = require(process.argv[1])
    const entries = manifest?.gea?.webPreload
    if (!Array.isArray(entries)) process.exit(0)
    for (const entry of entries) {
      const source = String(entry?.source || "").trim()
      const target = String(entry?.target || "").trim()
      if (source && target) console.log(`${source}\t${target}`)
    }
  } catch {}
' "$APP_DIR/package.json")

# Direct-canvas profile: mirrors the esp32 firmware (see
# targets/esp32-s3-touch-amoled-2.06/main/CMakeLists.txt), which builds
# canvas-3d with GEA_EMBEDDED_DIRECT_CANVAS_CONTEXT=1 — the app drives the
# display through Display.ctx() present batches (web Display::present()
# rasterizes them into the framebuffer) and never mounts a document tree.
# The define is applied GLOBALLY (every C++ TU): it flips ABI-visible
# declarations (gea::host::AnimationFrameTimestamp double->float) and inline
# facade bodies (host/display.h, host/window.h), so defining it on only some
# TUs breaks the link/ODR. Override per-build with GEA_WEB_DIRECT_CANVAS=0/1.
# Resident (launcher) bundles never use it — the launcher needs the tree.
DIRECT_CANVAS_PROFILE=0
if [[ "$APP_ID" == "canvas-3d" || "$APP_ID" == "gea3d-cube" ]]; then DIRECT_CANVAS_PROFILE=1; fi
DIRECT_CANVAS_PROFILE="${GEA_WEB_DIRECT_CANVAS:-$DIRECT_CANVAS_PROFILE}"
# The C++ build gets the direct-canvas present profile, but the geatsc CODEGEN is a
# separate axis: gea3d-cube drives the display natively (Display.present) and must
# use the NORMAL codegen (matches the esp32 firmware: PROFILE=1, CODEGEN=0). Without
# this split the web build mis-lowers and renders blank geometry.
DIRECT_CANVAS_CODEGEN="$DIRECT_CANVAS_PROFILE"
if [[ "$APP_ID" == "gea3d-cube" ]]; then DIRECT_CANVAS_CODEGEN=0; fi

GENERATED_DIR="$ROOT_DIR/targets/web/generated/$APP_ID"
# The simulator imports the emscripten glue via import.meta.glob over
# targets/web/dist/*/module.js and loads the wasm from public/apps/<app>/ (see
# simulator/src/app-loader.ts), so the linked module.js must land in DIST_DIR.
DIST_DIR="$ROOT_DIR/targets/web/dist/$APP_ID"
PUBLIC_DIR="$ROOT_DIR/simulator/public/apps/$APP_ID"
# (engine ui/ sources + includes now come from the shared manifest gea_sources.sh)
BUILD_DIR="$GENERATED_DIR/.obj"

echo "Building web app '$APP_ID'..."

# TSX -> JS (vite-plugin-gea) -> C++ (geatsc), mirroring the esp32 flags so the
# simulator renders what the device would. NO --pixel-panel-endian: the browser
# canvas reads the RGB565 framebuffer as native-endian u16. A non-empty prefix
# isolates an app's symbols so several can be bundled as residents.
generate_one() {
  # TEMPORARY (text-baseline investigation): reuse the already-generated
  # C++ instead of re-running geatsc. compiler/dist is being rebuilt
  # by another session and is not available.
  echo "  [noregen] reusing existing generated C++ in $3"
  [[ -f "$3/geatsc-sources.txt" ]] || { echo "no generated sources in $3" >&2; return 1; }
  return 0
}

app_root_entry() {
  node "$GEA_CLI" inspect "$1" --format shell | awk -F '\t' '{ print $1 " " $2 }'
}

read_geatsc_sources() {
  local out_dir="$1"
  local source_list="$out_dir/geatsc-sources.txt"
  if [[ ! -f "$source_list" ]]; then
    echo "Missing geatsc source list: $source_list" >&2
    return 1
  fi
  local source
  while IFS= read -r source; do
    [[ -n "$source" ]] || continue
    case "$source" in
      /*) ;;
      *) source="$out_dir/$source" ;;
    esac
    if [[ ! -f "$source" ]]; then
      echo "geatsc source listed but missing: $source" >&2
      return 1
    fi
    printf '%s\n' "$source"
  done < "$source_list"
}

launcher_catalog_ids() {
  node -e '
    const fs = require("node:fs")
    const path = require("node:path")
    const root = process.argv[1]
    const manifestPath = path.join(root, "apps", "app-launcher", "package.json")
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    const ids = manifest?.gea?.launcherCatalog?.appIds
    if (Array.isArray(ids)) {
      for (const id of ids) {
        const value = String(id).trim()
        if (value) console.log(value)
      }
    }
  ' "$PROJECT_DIR"
}

RESIDENT_MODE=0
RESIDENT_REGISTRY_CPP=""
RESIDENT_GEATSC_CPPS=()
RESIDENT_FONT_CPPS=()
RESIDENT_ASSET_CPPS=()
RESIDENT_ENTRY_CPPS=()
GENERATED_GEATSC_CPPS=()
GENERATED_FONT_CPP=""
GENERATED_ASSETS_CPP=""

if [[ "$APP_ID" == "app-launcher" ]]; then
  # The launcher bundles every web-enabled gea app as an in-process resident so
  # Apps.launch('foo') swaps the active app without a reload — same model as the
  # esp32/geaos launcher. Each app is generated with isolated symbols; a
  # generated registry dispatches Application::init/frame and the active app's
  # font lookups. By default the visible launcher catalog controls the resident
  # set; GEA_WEB_RESIDENT_APPS can override it with comma-separated ids, "auto"
  # for every web-enabled app, or "none" for only the launcher.
  RESIDENT_MODE=1
  if [[ "${GEA_WEB_RESIDENT_APPS:-}" == "auto" ]]; then
    RESIDENT_IDS=( $(node "$GEA_CLI" list --target web | grep -vx 'dialer' || true) )
  elif [[ "${GEA_WEB_RESIDENT_APPS:-}" == "none" ]]; then
    RESIDENT_IDS=()
  elif [[ -n "${GEA_WEB_RESIDENT_APPS:-}" ]]; then
    IFS=',' read -r -a RESIDENT_IDS <<< "$GEA_WEB_RESIDENT_APPS"
  else
    RESIDENT_IDS=()
    while IFS= read -r id; do
      RESIDENT_IDS+=("$id")
    done < <(launcher_catalog_ids)
    if [[ ${#RESIDENT_IDS[@]} -eq 0 ]]; then
      RESIDENT_IDS=( $(node "$GEA_CLI" list --target web | grep -vx 'dialer' || true) )
    fi
  fi
  ORDERED_RESIDENT_IDS=(app-launcher)
  for id in "${RESIDENT_IDS[@]}"; do
    id="${id//[[:space:]]/}"
    [[ -z "$id" ]] && continue
    [[ "$id" == "app-launcher" ]] && continue
    ORDERED_RESIDENT_IDS+=("$id")
  done
  RESIDENT_IDS=("${ORDERED_RESIDENT_IDS[@]}")
  ACTUAL_RESIDENTS=()
  for id in "${RESIDENT_IDS[@]}"; do
    read -r r_root r_entry < <(app_root_entry "$id")
    safe="${id//[^A-Za-z0-9_]/_}"
    prefix="gea_resident_${safe}"
    r_dir="$GENERATED_DIR/residents/$id"
    mkdir -p "$r_dir"
    echo "  resident: $id"
    generate_one "$r_root" "$r_entry" "$r_dir" "$prefix"
    while IFS= read -r __src; do RESIDENT_GEATSC_CPPS+=("$__src"); done < <(read_geatsc_sources "$r_dir")
    [[ -f "$r_dir/gea_embedded_font_generated.cpp" ]] && RESIDENT_FONT_CPPS+=("$r_dir/gea_embedded_font_generated.cpp")
    [[ -f "$r_dir/gea_embedded_assets_generated.cpp" ]] && RESIDENT_ASSET_CPPS+=("$r_dir/gea_embedded_assets_generated.cpp")
    node "$ROOT_DIR/targets/web/generate-resident-entry.mjs" "$prefix" "$r_dir/entry.cpp"
    RESIDENT_ENTRY_CPPS+=("$r_dir/entry.cpp")
    ACTUAL_RESIDENTS+=("$id")
  done
  RESIDENT_REGISTRY_CPP="$GENERATED_DIR/resident_registry.cpp"
  node "$ROOT_DIR/targets/web/generate-resident-registry.mjs" "$RESIDENT_REGISTRY_CPP" "${ACTUAL_RESIDENTS[@]}"
  echo "  bundled residents: ${ACTUAL_RESIDENTS[*]}"
else
  generate_one "$APP_ROOT" "$APP_ENTRY" "$GENERATED_DIR" ""
  while IFS= read -r __src; do GENERATED_GEATSC_CPPS+=("$__src"); done < <(read_geatsc_sources "$GENERATED_DIR")
  GENERATED_FONT_CPP="$GENERATED_DIR/gea_embedded_font_generated.cpp"
  GENERATED_ASSETS_CPP="$GENERATED_DIR/gea_embedded_assets_generated.cpp"
  if [[ ${#GENERATED_GEATSC_CPPS[@]} -eq 0 ]]; then
    echo "Missing generated geatsc sources for '$APP_ID'" >&2
    exit 1
  fi
fi

runtime_wrapper_source="#include \"$COMPILER_DIR/dist/targets/cpp/runtime/runtime.cpp\""
if [[ ! -f "$GENERATED_DIR/gea_runtime.cpp" ]] || [[ "$(cat "$GENERATED_DIR/gea_runtime.cpp")" != "$runtime_wrapper_source" ]]; then
  printf '%s\n' "$runtime_wrapper_source" > "$GENERATED_DIR/gea_runtime.cpp"
fi

# Step 2: compile the generated C++ + the gea-embedded runtime/host/UI set +
# the web platform shims to WASM. Mirrors targets/macos/build-macos.sh's source
# list (host platform impls swapped for the web shims).
mkdir -p "$BUILD_DIR" "$PUBLIC_DIR" "$DIST_DIR"

# lib headers first so the modern display.h / touch.h win; targets/web/include
# last so it only supplies web_display.h (its stale display.h/touch.h are
# superseded by lib/gea-embedded/include and must not shadow them).
INCLUDES=()
while IFS= read -r __i; do INCLUDES+=("$__i"); done < <(gea_fw_include_flags)
INCLUDES+=( -I"$ROOT_DIR/targets/web/include" )
# Generated geatsc support headers include files named string.h and number.h.
# They are C++ headers and must not precede the C standard library while the
# vendored AnimatedGIF C source includes <string.h>.
#
# These are APP-scoped: only the app's own translation units (generated modules,
# font/asset TUs, app native sources) may see the app's generated directory. The
# framework TUs never include a generated header, and keeping the per-app paths
# off their command line is what makes their objects identical across apps — the
# precondition for the shared object cache below. (Verified: compiling a
# framework TU with `-iquote <app A>`, with `-iquote <app B>`, and with no
# `-iquote` at all produces byte-identical objects.)
APP_CXX_QUOTE_INCLUDES=( -iquote "$GENERATED_DIR" )
# Trailing app `-I` roots (native-source dirs, filled in below). Kept separate so
# the app command line stays `-iquote <generated> <framework -I…> <app -I…>` —
# byte-for-byte the search order the build used before the framework/app split.
APP_CXX_INCLUDES=()

# GEA_EMBEDDED_HAS_GENERATED_FONTS gates the rasterized-TTF path in
# canvas.cpp/text.cpp/rasterized_font.cpp (they don't include the generated
# header themselves). The esp32 firmware sets it as a global compile def; the
# web build must too, or all text falls back to the built-in BitmapFont8x16.
# build-gea-vite-geatsc.mjs always emits gea_embedded_font_generated.cpp, so
# it's always available.
CXX_DEFINES=(
  -DGEA_EMBEDDED_ENABLE_VIRTUAL_KEYBOARD=0
  -DGEA_EMBEDDED_HAS_GENERATED_FONTS=1
)
if [[ "$DIRECT_CANVAS_PROFILE" == "1" ]]; then
  CXX_DEFINES+=( -DGEA_EMBEDDED_DIRECT_CANVAS_CONTEXT=1 )
fi

# The legacy web_*_shim.c files predate the gea::host layer and don't compile
# against today's C++ host headers; the host/*.cpp set replaces them. Only the
# pure-C vendored GIF decoder stays a C TU.
C_SOURCES=()
while IFS= read -r __c; do C_SOURCES+=("$__c"); done < <(gea_fw_c_sources)

# CXX_SCOPE runs parallel to CXX_SOURCES: "fw" for a framework TU (identical
# bytes for every app, so it can come from the shared object cache) and "app" for
# anything whose content or command line depends on this app. Keep them in step —
# a source appended without its scope is a build error, not a silent miss.
CXX_SOURCES=()
CXX_SCOPE=()
add_fw_cxx()  { local s; for s in "$@"; do CXX_SOURCES+=("$s"); CXX_SCOPE+=(fw);  done; }
add_app_cxx() { local s; for s in "$@"; do CXX_SOURCES+=("$s"); CXX_SCOPE+=(app); done; }

add_fw_cxx \
  "$ROOT_DIR/targets/web/main/web_main.cpp" \
  "$ROOT_DIR/targets/web/main/web_display.cpp" \
  "$ROOT_DIR/targets/web/main/web_platform.cpp" \
  "$ROOT_DIR/targets/web/main/web_power.cpp" \
  "$ROOT_DIR/targets/web/main/web_storage_service.cpp" \
  "$ROOT_DIR/targets/web/main/web_camera.cpp"
while IFS= read -r __s; do add_fw_cxx "$__s"; done < <(gea_fw_cxx_sources)

# App code: single-app mode links gea_app_entry.cpp (Application::init/frame) +
# the inert resident_apps.cpp + the generated module/font sources. Resident
# (launcher) mode instead links the generated registry — which provides
# Application::init/frame, ResidentApps, and the active app's font dispatch —
# plus every resident's module/font/entry sources.
if [[ "$RESIDENT_MODE" == "1" ]]; then
  add_app_cxx "$RESIDENT_REGISTRY_CPP"
  add_app_cxx "${RESIDENT_GEATSC_CPPS[@]+"${RESIDENT_GEATSC_CPPS[@]}"}"
  add_app_cxx "${RESIDENT_FONT_CPPS[@]+"${RESIDENT_FONT_CPPS[@]}"}"
  add_app_cxx "${RESIDENT_ASSET_CPPS[@]+"${RESIDENT_ASSET_CPPS[@]}"}"
  add_app_cxx "${RESIDENT_ENTRY_CPPS[@]+"${RESIDENT_ENTRY_CPPS[@]}"}"
else
  # gea_app_entry.cpp and resident_apps.cpp are framework files that include only
  # framework headers; they compile identically for every single-app build.
  add_fw_cxx "$CORE_DIR/gea_app_entry.cpp"
  add_fw_cxx "$CORE_DIR/../geaos/resident_apps.cpp"
  add_app_cxx "${GENERATED_GEATSC_CPPS[@]+"${GENERATED_GEATSC_CPPS[@]}"}"
  add_app_cxx "$GENERATED_FONT_CPP"
  add_app_cxx "$GENERATED_ASSETS_CPP"
fi

# App native sources (package.json gea.nativeSources, e.g. gea3d's software
# renderer): compile them and put each file's directory on the include path so the
# generated modules can include the app's native headers — same as the
# esp32/rp2350 firmware builds, which the web build otherwise omitted.
while IFS= read -r __ns; do
  [[ -z "$__ns" ]] && continue
  add_app_cxx "$APP_DIR/$__ns"
  APP_CXX_INCLUDES+=( -I"$(dirname "$APP_DIR/$__ns")" )
done < <(node -e 'try{const p=require(process.argv[1]);const n=(p.gea&&p.gea.nativeSources)||[];for(const s of n)console.log(s)}catch(e){}' "$APP_DIR/package.json" 2>/dev/null)

OPT="${GEA_WEB_OPT:--O2}"
OBJ_FILES=()

obj_name() {
  local src="$1" suffix="$2" rel
  rel="${src#"$ROOT_DIR"/}"
  rel="${rel%.cpp}"; rel="${rel%.c}"
  rel="${rel//\//__}"
  echo "${rel}${suffix}"
}

# --- shared framework object cache ----------------------------------------
# 78 of the ~87 translation units in a web build are framework code whose object
# bytes do not depend on the app (measured: 84 of 87 objects byte-identical
# between two apps). Compiling them into a per-app .obj directory threw ~91% of
# the compile CPU away and left ~106 MB of ~95% duplicate objects on disk.
#
# Framework objects now live in one store, in a directory named by a hash of
# EVERYTHING that can change their content: the emscripten toolchain identity,
# the optimisation level, every -D define (GEA_EMBEDDED_DIRECT_CANVAS_CONTEXT
# differs for canvas-3d/gea3d-cube and MUST NOT share objects with the others),
# the language standard and the full framework include list. A different flag set
# is a different directory — never a silently reused object.
#
# Within a store directory, staleness is make/ninja semantics over the depfile
# clang emits alongside each object (`-MD -MT <final obj> -MF <obj>.d`): the
# object is reused only when it exists, its depfile names it, and no listed
# prerequisite is missing or newer. That prerequisite list is the real one clang
# opened — every project header AND every emscripten sysroot header — so a
# toolchain or header change invalidates on its own.
#
# When a compile does happen it runs through ccache (if installed), which keys on
# the compiler binary, the whole command line and the preprocessed source, so a
# touched-but-unchanged header costs a cache hit rather than a codegen pass.
# Verified: object bytes are identical from a ccache miss, a ccache hit, and a
# plain (unwrapped) compile.
#
#   GEA_WEB_OBJCACHE=0        compile every TU into the per-app .obj (old behaviour)
#   GEA_WEB_OBJCACHE_DIR=…    relocate the store
#   GEA_WEB_CCACHE=0          do not wrap the compiler in ccache
#   GEA_WEB_JOBS=N            override the compile pool size
if [[ "${GEA_WEB_CCACHE:-1}" != "0" ]] && command -v ccache >/dev/null 2>&1; then
  export EM_COMPILER_WRAPPER="${EM_COMPILER_WRAPPER:-$(command -v ccache)}"
fi

hash_stdin() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256
  else openssl dgst -sha256; fi
}

SHARED_OBJ_DIR=""
if [[ "${GEA_WEB_OBJCACHE:-1}" != "0" ]]; then
  # Toolchain identity: the emcc version banner plus size+mtime of the resolved
  # emcc/em++ entry points, so an SDK swap that keeps the version string still
  # moves the store. (node, not stat(1) — `stat -f` means different things on
  # BSD and GNU.)
  __toolchain="$(emcc --version 2>/dev/null | head -1)|$(node -e '
    const fs = require("node:fs")
    process.stdout.write(process.argv.slice(1).map((p) => {
      try { const s = fs.statSync(p); return `${s.size}:${Math.trunc(s.mtimeMs)}` } catch { return "?" }
    }).join("|"))
  ' "$(command -v emcc)" "$(command -v em++)")"
  PROFILE_HASH="$(printf '%s\n' \
    'gea-web-objcache-v1' "$__toolchain" "$OPT" '-std=c++20' '-DGEA_EMBEDDED_GIF_C_API' \
    "${CXX_DEFINES[@]}" "${INCLUDES[@]}" | hash_stdin | cut -c1-32)"
  SHARED_OBJ_DIR="${GEA_WEB_OBJCACHE_DIR:-$ROOT_DIR/targets/web/generated/.objcache}/$PROFILE_HASH"
  mkdir -p "$SHARED_OBJ_DIR"
fi

# --- compile plan ----------------------------------------------------------
# Every TU is described before anything runs, so the up-to-date check can be a
# single batched pass over all the depfiles instead of ~87 shell stat storms.
PLAN_KIND=(); PLAN_SRC=(); PLAN_OBJ=(); PLAN_LINK=(); PLAN_DEP=()

plan_add() {
  local kind="$1" src="$2" scope="$3" suffix name obj link
  case "$kind" in c) suffix=.o ;; *) suffix=.cxx.o ;; esac
  name="$(obj_name "$src" "$suffix")"
  link="$BUILD_DIR/$name"
  if [[ "$scope" == "fw" && -n "$SHARED_OBJ_DIR" ]]; then obj="$SHARED_OBJ_DIR/$name"; else obj="$link"; fi
  PLAN_KIND+=("$kind"); PLAN_SRC+=("$src"); PLAN_OBJ+=("$obj"); PLAN_LINK+=("$link"); PLAN_DEP+=("$obj.d")
  # The link command line keeps the per-app object paths it always had; a shared
  # object is hard-linked into place below, so the emcc link args are unchanged.
  OBJ_FILES+=("$link")
}

for src in "${C_SOURCES[@]}"; do plan_add c "$src" fw; done
for __i in "${!CXX_SOURCES[@]}"; do plan_add cxx "${CXX_SOURCES[$__i]}" "${CXX_SCOPE[$__i]}"; done

PLAN_FRESH=()
if (( ${#PLAN_OBJ[@]} > 0 )); then
  while IFS= read -r __state; do PLAN_FRESH+=("$__state"); done < <(
    node "$ROOT_DIR/targets/web/obj-up-to-date.mjs" "${PLAN_OBJ[@]}" || true
  )
fi
if (( ${#PLAN_FRESH[@]} != ${#PLAN_OBJ[@]} )); then
  # The checker could not answer for every object: rebuild everything.
  PLAN_FRESH=(); for __i in "${!PLAN_OBJ[@]}"; do PLAN_FRESH+=(stale); done
fi

# --- compile pool ----------------------------------------------------------
# `wait "${PIDS[0]}"` blocked on the OLDEST job, so one slow TU idled the whole
# pool behind it (measured mean concurrency 6.6 of 16). Reap whichever job
# finishes first instead, and keep the pool full.
JOBS="${GEA_WEB_JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || echo 8)}"
HAVE_WAIT_N=0
if (( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 3) )); then HAVE_WAIT_N=1; fi
RUNNING=0
JOB_FAILED=0
# Space-separated, not an array: the fallback path has to run under bash 3.2,
# where `"${empty[@]}"` is an "unbound variable" error with `set -u`.
PID_LIST=""

reap_one() {
  local status=0 pid other rest
  if (( HAVE_WAIT_N )); then
    wait -n || status=$?
    # 127 means "no children left" — nothing to account for.
    if (( status == 127 )); then RUNNING=0; PID_LIST=""; return 0; fi
    (( status == 0 )) || JOB_FAILED=1
    if (( RUNNING > 0 )); then RUNNING=$(( RUNNING - 1 )); fi
    return 0
  fi
  # bash < 4.3 (macOS /bin/bash is 3.2): poll for whichever pid exits first
  # rather than serialising on the oldest one.
  while [[ -n "$PID_LIST" ]]; do
    for pid in $PID_LIST; do
      if ! kill -0 "$pid" 2>/dev/null; then
        wait "$pid" || JOB_FAILED=1
        rest=""
        for other in $PID_LIST; do
          if [[ "$other" != "$pid" ]]; then rest="$rest $other"; fi
        done
        PID_LIST="${rest# }"
        if (( RUNNING > 0 )); then RUNNING=$(( RUNNING - 1 )); fi
        return 0
      fi
    done
    sleep 0.02
  done
  RUNNING=0
  return 0
}

COMPILED=0
REUSED=0
JOB_SEQ=0

compile_one() {
  local kind="$1" src="$2" obj="$3" dep="$4" token="$5"
  local tmp_obj="$obj.tmp.$token" tmp_dep="$dep.tmp.$token"
  local rc=0
  case "$kind" in
    c)
      emcc $OPT -DGEA_EMBEDDED_GIF_C_API "${INCLUDES[@]}" \
        -MD -MT "$obj" -MF "$tmp_dep" -c "$src" -o "$tmp_obj" || rc=$?
      ;;
    cxx)
      em++ -std=c++20 $OPT "${CXX_DEFINES[@]}" \
        "${APP_CXX_QUOTE_INCLUDES[@]}" "${INCLUDES[@]}" "${APP_CXX_INCLUDES[@]+"${APP_CXX_INCLUDES[@]}"}" \
        -MD -MT "$obj" -MF "$tmp_dep" -c "$src" -o "$tmp_obj" || rc=$?
      ;;
  esac
  if (( rc != 0 )); then
    rm -f "$tmp_obj" "$tmp_dep"
    return "$rc"
  fi
  # Depfile first, object last: a reader that sees the object always sees a
  # matching depfile. Renames are atomic, so a concurrent build of the same TU
  # publishes identical bytes rather than a torn file.
  mv -f "$tmp_dep" "$dep"
  mv -f "$tmp_obj" "$obj"
  return 0
}

queue_index() {
  local i="$1"
  local kind="${PLAN_KIND[$i]}" src="${PLAN_SRC[$i]}" obj="${PLAN_OBJ[$i]}"
  local dep="${PLAN_DEP[$i]}" link="${PLAN_LINK[$i]}"
  if [[ "${PLAN_FRESH[$i]}" == "fresh" ]]; then
    REUSED=$(( REUSED + 1 ))
    publish_object "$obj" "$link"
    return 0
  fi
  COMPILED=$(( COMPILED + 1 ))
  JOB_SEQ=$(( JOB_SEQ + 1 ))
  local token="$$-$JOB_SEQ"
  while (( RUNNING >= JOBS )); do reap_one; done
  ( compile_one "$kind" "$src" "$obj" "$dep" "$token" && publish_object "$obj" "$link" ) &
  if (( HAVE_WAIT_N == 0 )); then PID_LIST="${PID_LIST:+$PID_LIST }$!"; fi
  RUNNING=$(( RUNNING + 1 ))
  return 0
}

# A shared object is hard-linked (same filesystem, free) into the per-app .obj so
# the link step sees exactly the paths it saw before this change; `cp` covers the
# case where the store has been relocated across filesystems.
publish_object() {
  local obj="$1" link="$2"
  [[ "$obj" == "$link" ]] && return 0
  ln -f "$obj" "$link" 2>/dev/null || cp -f "$obj" "$link"
  return 0
}

for __i in "${!PLAN_SRC[@]}"; do queue_index "$__i"; done
while (( RUNNING > 0 )); do reap_one; done
if (( JOB_FAILED != 0 )); then
  echo "Compile failed for '$APP_ID'" >&2
  exit 1
fi
echo "  objects: $COMPILED compiled, $REUSED reused${SHARED_OBJ_DIR:+ (framework store $SHARED_OBJ_DIR)}"

emcc $OPT \
  "${OBJ_FILES[@]}" \
  "${PRELOAD_ARGS[@]+"${PRELOAD_ARGS[@]}"}" \
  -o "$DIST_DIR/module.js" \
  -s FORCE_FILESYSTEM=1 \
  -s ENVIRONMENT=web \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s ASYNCIFY=1 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s EXPORTED_FUNCTIONS='["_app_init","_app_frame","_app_dispatch_key_down","_app_dispatch_pointer_event","_app_dispatch_pointer_event2","_app_hit_test","_app_touch_down","_app_touch_up","_app_touch_move","_get_framebuffer_ptr","_get_framebuffer_width","_get_framebuffer_height","_get_framebuffer_stride_bytes","_gea_web_media_inject_pcm","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","HEAPU8","HEAPU16"]'

cp "$DIST_DIR/module.wasm" "$PUBLIC_DIR/module.wasm"
if [[ -f "$DIST_DIR/module.data" ]]; then
  cp "$DIST_DIR/module.data" "$PUBLIC_DIR/module.data"
else
  rm -f "$PUBLIC_DIR/module.data"
fi
rm -f "$PUBLIC_DIR/module.js"

echo "Done: $APP_ID web build complete -> $PUBLIC_DIR/module.wasm"
