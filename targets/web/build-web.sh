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
# Resolution is anchored at the simulator package, then at the apps root, with
# the caller's cwd as fallback. Keeping every framework package in one npm
# installation prevents the same header from entering a TU through two physical
# package trees.
# script works from any directory and from an npm-only checkout.
# `|| true` keeps a resolution miss from silently killing the script under
# `set -e` before the diagnostic below can fire.
resolve_package_dir() {
  node -e "process.stdout.write(require('path').dirname(require.resolve(process.argv[1]+'/package.json',{paths:process.argv.slice(2).concat(process.cwd())})))" \
    "$1" "$ROOT_DIR/simulator" "$PROJECT_DIR" 2>/dev/null || true
}
CORE_DIR="${GEA_CORE_DIR:-$(resolve_package_dir @geastack/core)}"
COMPILER_DIR="${GEA_COMPILER_DIR:-$(resolve_package_dir @geastack/compiler)}"
GEA_HOST_DIR="${GEA_HOST_DIR:-$(resolve_package_dir @geastack/host)}"
GEA_ENGINE_DIR="${GEA_ENGINE_DIR:-$(resolve_package_dir @geastack/engine)}"
GEA_ELEMENTS_DIR="${GEA_ELEMENTS_DIR:-$(resolve_package_dir @geastack/elements)}"
GEA_GEAOS_PACKAGE_DIR="${GEA_GEAOS_PACKAGE_DIR:-$(resolve_package_dir @geastack/geaos)}"
for required in CORE_DIR COMPILER_DIR GEA_HOST_DIR GEA_ENGINE_DIR GEA_ELEMENTS_DIR GEA_GEAOS_PACKAGE_DIR; do
  [[ -n "${!required}" && -d "${!required}" ]] || {
    echo "Cannot resolve required package for $required" >&2
    exit 1
  }
done

# Framework source set comes from the shared manifest (single source of truth;
# the package decomposition updates it in one place).
GEA_CORE="$CORE_DIR"
# shellcheck source=/dev/null
source "$CORE_DIR/gea_sources.sh"
# The build lock and the app-metadata CLI moved out of @geastack/core (it
# "retired the core package's CLI, tools and build lock; they live in
# @geastack/cli"), so a CORE_DIR pointed at a current core has neither. Both are
# optional to this script: the lock is opt-in serialization, and the CLI only
# reads the app manifest, which no framework version changes.
if [[ -f "$CORE_DIR/scripts/heavy-build-lock.sh" ]]; then
  # shellcheck source=/dev/null
  source "$CORE_DIR/scripts/heavy-build-lock.sh"
else
  gea_acquire_heavy_build_lock() { :; }
  gea_release_heavy_build_lock() { :; }
fi
# ---------------------------------------------------------------------------
# The app CLI is @geastack/cli.
GEA_CLI="${GEA_CLI_BIN:-$(resolve_package_dir @geastack/cli)/bin/gea.mjs}"
[[ -f "$GEA_CLI" ]] || { echo "Cannot resolve @geastack/cli; set GEA_CLI_BIN" >&2; exit 1; }

# ESP32 board profile this simulator mirrors (see
# targets/esp32-s3-touch-amoled-2.06/main/CMakeLists.txt). Override via env to
# mirror a different board, e.g. the p4 7" panel:
#   GEA_WEB_CPP_BOARD=esp32-p4-waveshare-touch-lcd-7 GEA_WEB_DEVICE_PIXEL_RATIO=1.0
CPP_BOARD="${GEA_WEB_CPP_BOARD:-esp32-s3-touch-amoled-2.06}"
DEVICE_PIXEL_RATIO="${GEA_WEB_DEVICE_PIXEL_RATIO:-1.5}"
# GEA_COMPILER_RUNTIME_SOURCE, when non-empty, aliases @geajs/core to that file.
# Only an explicit request sets it: build-gea-vite-geatsc.mjs otherwise resolves
# the package's TYPED source itself (src/index.ts, walking appDir/coreRoot/
# repoRoot), and its own comment says why that matters — from the minified dist
# every type is erased and geatsc lowers the whole reactive runtime dynamically.
# The former default named "$ROOT_DIR/node_modules/@geajs/core/dist/
# compiler-runtime.mjs" — the minified dist, and a path that did not exist while
# node_modules sat under simulator/, so this has always resolved to empty here.
# Leaving the default in place would silently start forcing the minified runtime
# the moment node_modules moved to the package root, and would in any case name
# the wrong tree once this package is installed inside someone else's app.
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
DIRECT_CANVAS_PROFILE=0
if [[ "$APP_ID" == "canvas-3d" || "$APP_ID" == "gea3d-cube" ]]; then DIRECT_CANVAS_PROFILE=1; fi
DIRECT_CANVAS_PROFILE="${GEA_WEB_DIRECT_CANVAS:-$DIRECT_CANVAS_PROFILE}"
# The C++ build gets the direct-canvas present profile, but the geatsc CODEGEN is a
# separate axis: gea3d-cube drives the display natively (Display.present) and must
# use the NORMAL codegen (matches the esp32 firmware: PROFILE=1, CODEGEN=0). Without
# this split the web build mis-lowers and renders blank geometry.
DIRECT_CANVAS_CODEGEN="$DIRECT_CANVAS_PROFILE"
if [[ "$APP_ID" == "gea3d-cube" ]]; then DIRECT_CANVAS_CODEGEN=0; fi
DIRECT_CANVAS_CODEGEN="${GEA_WEB_DIRECT_CANVAS_CODEGEN:-$DIRECT_CANVAS_CODEGEN}"

# --- output roots ----------------------------------------------------------
# Each root defaults to the exact in-checkout directory it has always used, so an
# unset environment reproduces the historical layout byte-for-byte. A driver that
# runs this package from an app's node_modules (the `gea` CLI) points them at the
# app's own build directory instead; simulator/vite.config.ts reads the same two
# GEA_WEB_DIST_ROOT / GEA_WEB_PUBLIC_ROOT names so the dev server follows.
GEA_WEB_GENERATED_ROOT="${GEA_WEB_GENERATED_ROOT:-$ROOT_DIR/targets/web/generated}"
GENERATED_DIR="$GEA_WEB_GENERATED_ROOT/$APP_ID"
# The simulator imports the emscripten glue via import.meta.glob over
# targets/web/dist/*/module.js and loads the wasm from public/apps/<app>/ (see
# simulator/src/app-loader.ts), so the linked module.js must land in DIST_DIR.
DIST_DIR="${GEA_WEB_DIST_ROOT:-$ROOT_DIR/targets/web/dist}/$APP_ID"
PUBLIC_DIR="${GEA_WEB_PUBLIC_ROOT:-$ROOT_DIR/simulator/public/apps}/$APP_ID"
# The generator takes its output-pipeline lock as a directory NEXT TO its out-dir
# (`<generated root>/.<app>.gea-pipeline.lock`) and mkdirs it non-recursively, so
# the root has to exist before generate_one runs — in-checkout it always did, a
# fresh relocated root does not. No-op when GEA_WEB_GENERATED_ROOT is unset.
mkdir -p "$GEA_WEB_GENERATED_ROOT"
# (engine ui/ sources + includes now come from the shared manifest gea_sources.sh)
BUILD_DIR="$GENERATED_DIR/.obj"

echo "Building web app '$APP_ID'..."

# TSX -> JS (vite-plugin-gea) -> C++ (geatsc), mirroring the esp32 flags so the
# simulator renders what the device would. NO --pixel-panel-endian: the browser
# canvas reads the RGB565 framebuffer as native-endian u16. A non-empty prefix
# compiles the selected application as one native program.
generate_one() {
  local root="$1" entry="$2" out_dir="$3"
  local extra=()
  # gea.compilerPlugins: the app's own geatsc plugins, e.g. one declaring its
  # native host-function boundary. The esp32 firmware forwards them (see
  # targets/esp32/gea_framework.cmake); without them here the same app's host
  # calls are unknown globals and only the device build compiles.
  local plugin
  while IFS= read -r plugin; do
    [[ -n "$plugin" ]] || continue
    extra+=(--extra-geatsc-plugin "$root/$plugin")
  done < <(node -e 'try{const p=require(process.argv[1]);const n=(p.gea&&p.gea.compilerPlugins)||[];for(const s of n)console.log(s)}catch(e){}' "$root/package.json" 2>/dev/null)
  # Compile with a different geatsc build when asked. `build-gea-vite-geatsc.mjs`
  # already resolves its compiler through `--geatsc-bin`, so this only forwards
  # the choice; unset, everything behaves exactly as before.
  if [[ -n "${GEA_GEATSC_BIN:-}" ]]; then
    extra+=(--geatsc-bin "$GEA_GEATSC_BIN")
  fi
  GEA_EMBEDDED_DIRECT_CANVAS_CONTEXT="$DIRECT_CANVAS_CODEGEN" \
  GEA_COMPILER_RUNTIME_SOURCE="$GEA_SOURCE_ENTRY" \
  node "$CORE_DIR/scripts/build-gea-vite-geatsc.mjs" \
    --app-dir "$root" \
    --entry "$entry" \
    --out-dir "$out_dir" \
    --cpp-board "$CPP_BOARD" \
    --font-device-pixel-ratio "$DEVICE_PIXEL_RATIO" \
    --gea-ir-backend \
    "${extra[@]+"${extra[@]}"}"
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

GENERATED_GEATSC_CPPS=()
generate_one "$APP_ROOT" "$APP_ENTRY" "$GENERATED_DIR"
while IFS= read -r __src; do GENERATED_GEATSC_CPPS+=("$__src"); done < <(read_geatsc_sources "$GENERATED_DIR")
GENERATED_FONT_CPP="$GENERATED_DIR/gea_embedded_font_generated.cpp"
GENERATED_ASSETS_CPP="$GENERATED_DIR/gea_embedded_assets_generated.cpp"
if [[ ${#GENERATED_GEATSC_CPPS[@]} -eq 0 ]]; then
  echo "Missing generated geatsc sources for '$APP_ID'" >&2
  exit 1
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

# The application entry is framework code and compiles identically for every app.
add_fw_cxx "$CORE_DIR/gea_app_entry.cpp"
add_app_cxx "${GENERATED_GEATSC_CPPS[@]+"${GENERATED_GEATSC_CPPS[@]}"}"
add_app_cxx "$GENERATED_FONT_CPP"
add_app_cxx "$GENERATED_ASSETS_CPP"

# App native sources (package.json gea.nativeSources, e.g. gea3d's software
# renderer): compile them and put each file's directory on the include path so the
# generated modules can include the app's native headers — same as the
# esp32/rp2350 firmware builds, which the web build otherwise omitted.
#
# A `.c` source is compiled as C, the way the esp32 and rp2350 builds compile it.
# It used to join the C++ list with everything else, which is a defect a header
# hides: every extern "C" declaration still matched, so the file built and linked
# until it called something declared in the .c file itself -- and then wanted a
# C++-mangled symbol that the C definition elsewhere in the app never provided.
APP_C_SOURCES=()
while IFS= read -r __ns; do
  [[ -z "$__ns" ]] && continue
  if [[ "$__ns" == *.c ]]; then
    APP_C_SOURCES+=("$APP_DIR/$__ns")
  else
    add_app_cxx "$APP_DIR/$__ns"
  fi
  APP_CXX_INCLUDES+=( -I"$(dirname "$APP_DIR/$__ns")" )
done < <(node -e 'try{const p=require(process.argv[1]);const n=(p.gea&&p.gea.nativeSources)||[];for(const s of n)console.log(s)}catch(e){}' "$APP_DIR/package.json" 2>/dev/null)

OPT="${GEA_WEB_OPT:--O2}"
OBJ_FILES=()

# --- app web build options -------------------------------------------------
# gea.web.{compileOptions,linkOptions,exportedFunctions}: what an app needs the
# final program to be, which no other setting can express. The esp32 target has
# had gea.targets.esp32.linkOptions for exactly this; web had nothing, so an app
# whose program is more than a UI -- one that runs its own DSP on an audio
# worklet, say -- could not be built at all.
#
# compileOptions are GLOBAL, and deliberately: -matomics/-mbulk-memory are the
# case that needs them, and wasm-ld refuses shared memory unless EVERY object in
# the link carries those features. They go into the object-cache profile below,
# so a build with them never reuses an object compiled without them.
#
# exportedFunctions are SPLICED into this script's own list rather than
# replacing it: a second -sEXPORTED_FUNCTIONS would overwrite the app entry
# points the simulator itself calls.
#
# includeDirs join the roots each nativeSources directory already contributes,
# app-scoped, for a source tree whose headers are not reachable from the
# directory the source file happens to sit in.
APP_COMPILE_OPTIONS=(); APP_LINK_OPTIONS=(); APP_EXPORTED_FUNCTIONS=()
while IFS=$'\t' read -r __kind __value; do
  [[ -n "$__value" ]] || continue
  case "$__kind" in
    compile) APP_COMPILE_OPTIONS+=("$__value") ;;
    include) APP_CXX_INCLUDES+=( -I"$APP_DIR/$__value" ) ;;
    link) APP_LINK_OPTIONS+=("$__value") ;;
    export) APP_EXPORTED_FUNCTIONS+=("$__value") ;;
  esac
done < <(node -e '
  try {
    const web = (require(process.argv[1]).gea || {}).web || {}
    const emit = (kind, list) => { for (const v of Array.isArray(list) ? list : []) console.log(`${kind}\t${String(v)}`) }
    emit("compile", web.compileOptions)
    emit("include", web.includeDirs)
    emit("link", web.linkOptions)
    emit("export", web.exportedFunctions)
  } catch {}
' "$APP_DIR/package.json")

# --- object filenames ------------------------------------------------------
# An object's name is its source path with the separators mangled, so one flat
# store directory can hold every translation unit. Stripping only $ROOT_DIR was
# enough while every framework package lived inside this checkout; once this
# package is installed as @geastack/simulator BESIDE @geastack/core in someone
# else's node_modules, $ROOT_DIR is no longer a prefix of a framework source and
# the name becomes the whole mangled absolute path — length growing with the
# user's home-directory depth, against the 255-byte filename limit, and silently:
# a too-long name fails at open(), not at anything that reads like a path bug.
#
# So strip a SET of roots instead. Each resolved package root gets a short stable
# tag, which also keeps two packages from colliding on a shared relative path
# (every one of them has a `ui/` or a `runtime.cpp`). $ROOT_DIR keeps the empty
# tag, so a source inside this checkout — targets/web/main/*, the generated app
# TUs — produces exactly the name it always did. Longest match wins, so a package
# that happens to sit inside the checkout beats $ROOT_DIR. A source under none of
# them keeps today's fallback: the mangled absolute path.
OBJ_PREFIX_PATHS=(); OBJ_PREFIX_TAGS=()
obj_prefix_add() {
  local dir="${1%/}" tag="$2" i
  [[ -n "$dir" ]] || return 0
  for i in "${!OBJ_PREFIX_PATHS[@]}"; do
    [[ "${OBJ_PREFIX_PATHS[$i]}" == "$dir" ]] && return 0
  done
  OBJ_PREFIX_PATHS+=("$dir"); OBJ_PREFIX_TAGS+=("$tag")
}
obj_prefix_add "$CORE_DIR" core
obj_prefix_add "$COMPILER_DIR" compiler
obj_prefix_add "$GEA_HOST_DIR" host
obj_prefix_add "$GEA_ENGINE_DIR" engine
obj_prefix_add "$GEA_ELEMENTS_DIR" elements
obj_prefix_add "$GEA_GEAOS_PACKAGE_DIR" geaos
obj_prefix_add "$APP_DIR" app
obj_prefix_add "$ROOT_DIR" ""

obj_name() {
  # `rel` is assigned on its own line: the words of a `local` are expanded in the
  # CALLER's scope, so `local src="$1" rel="$src"` reads an unset `src` and dies
  # under `set -u`.
  local src="$1" suffix="$2" rel i p best=-1 besti=-1
  rel="$src"
  for i in "${!OBJ_PREFIX_PATHS[@]}"; do
    p="${OBJ_PREFIX_PATHS[$i]}"
    case "$src" in
      "$p"/*) if (( ${#p} > best )); then best=${#p}; besti=$i; fi ;;
    esac
  done
  if (( besti >= 0 )); then
    rel="${OBJ_PREFIX_TAGS[$besti]}${OBJ_PREFIX_TAGS[$besti]:+/}${src:${#OBJ_PREFIX_PATHS[$besti]}+1}"
  fi
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
    "${CXX_DEFINES[@]}" ${APP_COMPILE_OPTIONS[@]+"${APP_COMPILE_OPTIONS[@]}"} \
    "${INCLUDES[@]}" | hash_stdin | cut -c1-32)"
  # Default derives from the generated root so the store follows a relocated
  # build; unset, GEA_WEB_GENERATED_ROOT is the in-checkout targets/web/generated
  # and this is the same `.objcache` directory it has always been.
  SHARED_OBJ_DIR="${GEA_WEB_OBJCACHE_DIR:-$GEA_WEB_GENERATED_ROOT/.objcache}/$PROFILE_HASH"
  mkdir -p "$SHARED_OBJ_DIR"
fi

# --- precompiled headers ---------------------------------------------------
# One PCH pair per generated directory -- the same chain `build-macos.sh`
# builds, for the same reason. Under the compiler's per-file layout each
# generated unit is small, and without a PCH every one of them re-parses the
# whole prelude (`gea_runtime.h`, the hosts' preambles and headers) before it
# reaches its own few hundred lines; the compiler's docs/TRANSLATION-UNITS.md
# measures that at most of a small unit's compile. em++ is clang, so both
# `-include-pch` and chaining one PCH on another work here.
#
# Two layers: `<stem>.runtime.hpp` is the prelude and is stable across program
# edits; `<stem>.hpp` is the program's own declarations, chained on it. A unit
# takes the program PCH, which loads both, so an edit that changes a
# declaration rebuilds only the small top layer.
#
# The compiler writes `geatsc-header.txt` naming both, and only for the
# per-file layout: a single-unit build finds no manifest and this does nothing,
# because that unit carries its own prelude and there is no preamble-exact
# header to precompile. Turn the layout on with `GEA_PER_FILE_UNITS=1`.
#
# Only the units named in `geatsc-sources.txt` take the PCH. The other
# generated files in the same directory (fonts, assets) are not the compiler's
# translation units and have no reason to load its declarations.
WEB_PCH_DIRS=(); WEB_PCH_FILES=(); WEB_PCH_REBUILT=0; WEB_PCH_SOURCE_KEYS=$'\n'

web_pch_named_header() {
  local manifest="$1/geatsc-header.txt" key="$2" line named result=""
  [[ -f "$manifest" ]] || return 0
  while IFS= read -r line; do
    case "$line" in
      "$key"=*) named="${line#*=}"; [[ -f "$named" ]] && result="$named" ;;
    esac
  done < "$manifest"
  printf '%s' "$result"
}

# Build one PCH, optionally chained on another. A precompiled header is an
# optimization and nothing else -- every unit compiles correctly without one --
# so a header that will not compile warns and yields no PCH rather than failing
# a build that would otherwise succeed.
web_pch_compile() {
  local src="$1" out="$2" chained="$3" label="$4"
  local sigFile="$out.sig" tmp="$out.tmp.$$" sig rc=0
  local chainArgs=()
  [[ -n "$chained" ]] && chainArgs=(-include-pch "$chained")
  sig="$(printf '%s\n' 'gea-web-pch-v1' "$OPT" '-std=c++20' "${CXX_DEFINES[@]}" \
    ${APP_COMPILE_OPTIONS[@]+"${APP_COMPILE_OPTIONS[@]}"} \
    "${APP_CXX_QUOTE_INCLUDES[@]}" "${INCLUDES[@]}" ${APP_CXX_INCLUDES[@]+"${APP_CXX_INCLUDES[@]}"} \
    "source=$src" "chained=$chained" | hash_stdin | cut -c1-32)"
  if [[ -f "$out" && -f "$sigFile" && "$(cat "$sigFile")" == "$sig" && ! "$src" -nt "$out" ]]; then
    if [[ -z "$chained" || ! "$chained" -nt "$out" ]]; then return 0; fi
  fi
  rm -f "$out" "$sigFile" "$tmp"
  em++ -std=c++20 $OPT "${CXX_DEFINES[@]}" ${APP_COMPILE_OPTIONS[@]+"${APP_COMPILE_OPTIONS[@]}"} \
    "${APP_CXX_QUOTE_INCLUDES[@]}" "${INCLUDES[@]}" ${APP_CXX_INCLUDES[@]+"${APP_CXX_INCLUDES[@]}"} \
    ${chainArgs[@]+"${chainArgs[@]}"} -x c++-header "$src" -o "$tmp" || rc=$?
  if (( rc != 0 )); then
    rm -f "$tmp"
    echo "warning: $label PCH failed to build from $src; continuing without it -- every unit in ${src%/*} will re-parse the runtime instead." >&2
    return 1
  fi
  mv -f "$tmp" "$out"
  printf '%s\n' "$sig" > "$sigFile"
  WEB_PCH_REBUILT=1
  return 0
}

web_build_pch_for_dir() {
  local dir="$1" runtimeSrc programSrc stem runtimePch programPch
  runtimeSrc="$(web_pch_named_header "$dir" runtime)"
  [[ -n "$runtimeSrc" ]] || return 0
  programSrc="$(web_pch_named_header "$dir" program)"
  stem="$(printf '%s' "$dir" | tr '/' '_')"
  runtimePch="$BUILD_DIR/pch${stem}.runtime.pch"
  # No runtime layer means no chain to hang the program layer on, so the whole
  # directory compiles bare; a program layer that fails on its own still leaves
  # the runtime layer usable, which is most of the win.
  web_pch_compile "$runtimeSrc" "$runtimePch" "" runtime || return 0
  local unitPch="$runtimePch"
  if [[ -n "$programSrc" ]]; then
    programPch="$BUILD_DIR/pch${stem}.program.pch"
    if web_pch_compile "$programSrc" "$programPch" "$runtimePch" program; then unitPch="$programPch"; fi
  fi
  WEB_PCH_DIRS+=("$dir"); WEB_PCH_FILES+=("$unitPch")
}

web_pch_for_source() {
  local src="$1" dir i
  WEB_PCH_FOR_SOURCE=""
  [[ "$WEB_PCH_SOURCE_KEYS" == *$'\n'"$src"$'\n'* ]] || return 0
  dir="${src%/*}"
  for i in ${WEB_PCH_DIRS[@]+"${!WEB_PCH_DIRS[@]}"}; do
    if [[ "${WEB_PCH_DIRS[$i]}" == "$dir" ]]; then WEB_PCH_FOR_SOURCE="${WEB_PCH_FILES[$i]}"; return 0; fi
  done
}

if [[ "${GEA_WEB_PCH:-1}" != "0" ]]; then
  mkdir -p "$BUILD_DIR"
  __pch_dirs=$'\n'
  for __src in ${GENERATED_GEATSC_CPPS[@]+"${GENERATED_GEATSC_CPPS[@]}"}; do
    WEB_PCH_SOURCE_KEYS="$WEB_PCH_SOURCE_KEYS$__src"$'\n'
    __d="${__src%/*}"
    case "$__pch_dirs" in
      *$'\n'"$__d"$'\n'*) ;;
      *) __pch_dirs="$__pch_dirs$__d"$'\n'; web_build_pch_for_dir "$__d" ;;
    esac
  done
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
for src in ${APP_C_SOURCES[@]+"${APP_C_SOURCES[@]}"}; do plan_add c "$src" app; done
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

# A PCH that was just rebuilt invalidates every unit compiled against it: clang
# validates the chain by identity, and the depfile of a `-include-pch` compile
# does not name the headers folded into the PCH, so nothing else would notice.
if (( WEB_PCH_REBUILT )); then
  for __i in "${!PLAN_SRC[@]}"; do
    web_pch_for_source "${PLAN_SRC[$__i]}"
    [[ -n "$WEB_PCH_FOR_SOURCE" ]] && PLAN_FRESH[$__i]=stale
  done
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
      # The app's own include roots go to a C source as well as a C++ one: an
      # app's .c file reaches the same headers its .cpp files do.
      emcc $OPT -DGEA_EMBEDDED_GIF_C_API ${APP_COMPILE_OPTIONS[@]+"${APP_COMPILE_OPTIONS[@]}"} \
        "${INCLUDES[@]}" ${APP_CXX_INCLUDES[@]+"${APP_CXX_INCLUDES[@]}"} \
        -MD -MT "$obj" -MF "$tmp_dep" -c "$src" -o "$tmp_obj" || rc=$?
      ;;
    cxx)
      # `-include-pch` loads the whole chain and the unit's own `#include` of
      # the shared header is skipped, because the PCH recorded its guard.
      local pchArgs=()
      web_pch_for_source "$src"
      [[ -n "$WEB_PCH_FOR_SOURCE" ]] && pchArgs=(-include-pch "$WEB_PCH_FOR_SOURCE")
      em++ -std=c++20 $OPT "${CXX_DEFINES[@]}" ${APP_COMPILE_OPTIONS[@]+"${APP_COMPILE_OPTIONS[@]}"} \
        "${APP_CXX_QUOTE_INCLUDES[@]}" "${INCLUDES[@]}" "${APP_CXX_INCLUDES[@]+"${APP_CXX_INCLUDES[@]}"}" \
        ${pchArgs[@]+"${pchArgs[@]}"} \
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

# The app's own entry points join this list rather than replacing it; an app
# link option can still override any -s above it, because emcc takes the last
# spelling of a setting.
EXPORTED_FUNCTIONS='["_app_init","_app_frame","_app_dispatch_key_down","_app_dispatch_pointer_event","_app_dispatch_pointer_event2","_app_hit_test","_app_touch_down","_app_touch_up","_app_touch_move","_get_framebuffer_ptr","_get_framebuffer_width","_get_framebuffer_height","_get_framebuffer_stride_bytes","_gea_web_media_inject_pcm","_malloc","_free"]'
if (( ${#APP_EXPORTED_FUNCTIONS[@]} > 0 )); then
  EXPORTED_FUNCTIONS="$(node -e '
    const base = JSON.parse(process.argv[1])
    process.stdout.write(JSON.stringify([...new Set([...base, ...process.argv.slice(2)])]))
  ' "$EXPORTED_FUNCTIONS" "${APP_EXPORTED_FUNCTIONS[@]}")"
fi

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
  -s EXPORTED_FUNCTIONS="$EXPORTED_FUNCTIONS" \
  -s EXPORTED_RUNTIME_METHODS='["ccall","HEAPU8","HEAPU16"]' \
  ${APP_LINK_OPTIONS[@]+"${APP_LINK_OPTIONS[@]}"}

cp "$DIST_DIR/module.wasm" "$PUBLIC_DIR/module.wasm"
# -sAUDIO_WORKLET emits a second script beside the module; the worklet loads it
# by name from the module's own directory, so it has to travel with it.
if [[ -f "$DIST_DIR/module.aw.js" ]]; then
  cp "$DIST_DIR/module.aw.js" "$PUBLIC_DIR/module.aw.js"
else
  rm -f "$PUBLIC_DIR/module.aw.js"
fi
if [[ -f "$DIST_DIR/module.data" ]]; then
  cp "$DIST_DIR/module.data" "$PUBLIC_DIR/module.data"
else
  rm -f "$PUBLIC_DIR/module.data"
fi
rm -f "$PUBLIC_DIR/module.js"

echo "Done: $APP_ID web build complete -> $PUBLIC_DIR/module.wasm"
