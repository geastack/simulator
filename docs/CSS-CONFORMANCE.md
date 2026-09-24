# CSS conformance: developer workflow

Use this guide to reproduce a WPT failure, locate its cause, fix the shared
renderer, and demonstrate that the fix did not invalidate other results.
The [rig README](../test/wpt/README.md) contains detailed findings and historical
results. The generated report is the authority for the run you just performed.

## What this rig establishes

The runner renders pinned upstream CSS test and reference documents through
Gea's shared C++ renderer, compiled to WebAssembly with Emscripten. It compares
the simulator's RGB565 output, exported as RGBA pixels, at an 800 × 600 CSS-pixel
viewport with DPR 1. It does not screenshot a browser's rendering of HTML.

Both sides use Gea. Two identical images can therefore share a bug. Independent
pixel and geometry probes are essential, especially when implementing a feature
that was previously ignored. A PASS establishes this comparison under this
adapter's conditions; it does not certify every property in the document.

This path does not invoke the TypeScript-to-C++ compiler, exercise the TSX app
loader, or reproduce ESP32 memory, CPU, and display-transfer constraints. Native
tests, an application build, and hardware checks cover those separate concerns.

## 1. Select the source tree and establish a baseline

Run the commands below from the **simulator repository root**. Use Node.js
20.19 or newer and an activated Emscripten SDK with `emcc` and `em++` on PATH.
`EMCC` and `EMXX` can select explicit compiler executables. Ordinary test runs
are offline after dependencies and toolchains are installed.

```sh
npm ci
emcc --version
em++ --version
```

By default, the build uses installed `@geastack/*` packages. When fixing the
renderer in a sibling `core` checkout, select **all** local framework packages:

```sh
export GEA_CORE=../core/packages/core
export GEA_ENGINE_DIR=../core/packages/engine
export GEA_HOST_DIR=../core/packages/host
export GEA_ELEMENTS_DIR=../core/packages/elements
export GEA_GEAOS_PACKAGE_DIR=../core/packages/geaos
```

The WPT builder uses `GEA_CORE`, not the device CLI's `GEA_CORE_DIR`. To return
to installed packages, unset these five overrides before rebuilding. Inspect
`dist/wpt-build.json` to verify the resolved paths, Emscripten version, and flags.
A correct fix in a local checkout has no effect on a build using node_modules.

```sh
npm run wpt:test
npm run wpt:build
npm run wpt:run
```

`npm run test:wpt` combines these three steps. The builder compiles serially and
uses dependency files for incremental rebuilds. **Rebuild after changing C++ or
switching package sources**: `wpt:run` alone executes the existing WASM artifact.
Do not overlap builds or report-writing runs against the same `dist/` directory.

The default is **all imported CSS tests**, not 100 tests or a passing subset.
Check `scope.selected`, `scope.available`, `scope.filter`, and `scope.limit` in
`dist/wpt-results.json`. A filename filter or explicit limit is for diagnosis:

```sh
npm run wpt:run -- css-transform-scale-001-manual.html
npm run wpt:run -- css/css-transforms/ --limit 20
```

Every run, including a filtered run, replaces `dist/wpt-report.html` and
`dist/wpt-results.json`. Images and geometry use stable corpus indices but are
also overwritten when their case runs; unrelated old images can remain. Follow
links from the current report rather than treating every file in `dist/` as a
current result. After a full baseline run, preserve its JSON before iterating:

```sh
cp dist/wpt-results.json dist/wpt-results.before.json
```

This preserves statuses and metrics, not old image contents. Inspect baseline
images before overwriting them. Record repository revisions, any uncommitted
changes, toolchain versions, and the exact commands in the eventual handoff;
the build report records package paths, not a Git revision or source snapshot.

## 2. Read the result before changing code

Open `dist/wpt-report.html` in a browser (`open dist/wpt-report.html` on macOS).
Each executed comparison links its actual image, reference image, magenta diff,
and actual/reference node geometry. Read the upstream test **and every reference**,
including their stylesheets, fonts, metadata, spec links, and manual instructions.
The filename identifies the intended test, not necessarily the defective layer.

| Status | Interpretation and next action |
| --- | --- |
| PASS | Reference relations and applicable prerequisites passed. Check that meaningful content rendered. |
| FAIL | Images violate the expected relation/tolerance. Diagnose both sides; review attached prerequisite failures. |
| BLOCKED | Images satisfy the relation, but an applicable independent probe failed. Fix the missing foundation before trusting the match. |
| SKIP | The adapter cannot represent the document or a reference faithfully. Read `reason`; this is unfinished coverage, not a pass or proof of absent engine support. |
| ERROR | Rendering or infrastructure failed. Fix the error before interpreting CSS behavior. |

Exit 0 means the selected runnable tests and required foundations passed.
Exit 1 can mean FAIL, BLOCKED, an invalid global prerequisite, or no passing
tests. Exit 2 indicates an ERROR recorded in the result summary. Early setup,
provenance, or transport-canary failures also exit nonzero and may leave an older
report on disk. Check command completion, diagnostics, and report freshness.
Do not hide failure with `|| true` or describe a partially executed run as green.

Exact pixel comparison is the default. The adapter honors supported upstream
fuzzy metadata; both the differing-pixel count and maximum channel difference
must meet its conditions. Multiple references require any declared match and
every declared mismatch. Do not add a global tolerance to make a failure pass.

Useful inspection without reading the entire JSON:

```sh
node - <<'JS'
const r = require('./dist/wpt-results.json');
console.log(r.scope, r.summary);
for (const t of r.results.filter(t => t.status !== 'PASS'))
  console.log(t.status, t.test, t.reason || '');
JS
```

## 3. Locate the responsible layer

| Evidence | Start here |
| --- | --- |
| Declaration, text, font, or selector never reaches native code | `test/wpt/adapter.mjs`, `fonts.mjs`, `render.mjs`, `bridge.cpp` |
| Wrong parsed value, cascade, inheritance, or applicability | `core/packages/engine/ui/style.cpp`, `style.h`, `style_values.h`, `tree_style.cpp` |
| Wrong box size, wrapping, position, or containing block | `core/packages/engine/ui/layout.cpp`, node style/layout state |
| Correct boxes but wrong ink, clipping, stacking, projection, or coverage | `core/packages/engine/ui/view.cpp`, `text.cpp`, `render.cpp`, `tree_render.cpp`, `canvas.cpp` |
| First paint correct, mutation or interaction wrong | Style invalidation, retained refresh/reprojection paths, input hit testing |
| WPT path correct but a TSX application wrong | `core/packages/core/scripts/build-gea-vite-geatsc.mjs`, Gea plugin lowering, app pipeline |
| Worker hangs, exits, or returns malformed output | `render.mjs` stage diagnostics, process input/output, WASM initialization and memory |

Paths beginning with `core/` refer to the sibling repository. These are starting
points, not instructions to patch whichever consumer first exposes the problem.
Trace a declaration from transport through parsing, computed state, layout,
display-list recording, and replay until the first incorrect value appears.

Workers have a 30-second timeout and report stages such as `reading-input` and
`initializing-wasm`. A timeout before WASM initialization is not evidence of slow
CSS layout. Check contention and input transport before raising timeouts. Run
native suites serially; limit their compilation with `GEA_NATIVE_JOBS=2` when
needed. Follow workspace rules for compiler sharing and temporary files.

## 4. Make the fix and prove the expectation independently

1. Identify the specification rule and the smallest failing condition. Include
   dependencies in the reference: a transform test can expose inline formatting,
   a background test can depend on text layout, and a manual test can require hover.
2. Add a regression with explicit expected geometry or pixels derived independently
   of Gea's current output. Keep reduced developer fixtures in control/native tests;
   keep the imported WPT sources unchanged.
3. Fix the responsible shared implementation. Keep test transport transparent and
   update affected runtime and static-codegen paths together. Check defaults,
   inheritance, property removal/reset, and combinations with existing features.
4. Exercise updates as well as initial paint: resize, recolor, text replacement,
   transform changes, or hit testing as relevant. A static reftest cannot establish
   that cached geometry and retained painting invalidate correctly.
5. Rebuild, run the focused case and adjacent cases, then run the complete corpus.

Independent controls live in `test/wpt/*-control.mjs` and are registered in
`run.mjs`. See [scale-z-control.mjs](../test/wpt/scale-z-control.mjs) for explicit
projected rectangles and [text-clip-control.mjs](../test/wpt/text-clip-control.mjs)
for coverage checks. Add property/unit/pseudo-element/HTML-tag scoping when a
probe protects only those dependencies; `failedPrerequisites` in `adapter.mjs`
checks both the test and its references. Test changes to the scoping logic too.

For example, text-emphasis must not pass merely because both images omit the
emphasis marks. Its control demands ink in a known region. Preserve that BLOCKED
result until the feature works; never remove the guard to improve the pass count.

Manual cases need their declared interaction, not edited CSS. The scale example
is explicitly registered in [interactions.mjs](../test/wpt/interactions.mjs) to
hover `.greenSquare` through the native input path. Extend this mechanism only
when the test's instructions can be reproduced deterministically. Do not strip
`:hover` or inject the expected post-interaction style.

Named colors are a deliberate, disclosed exception: `named-colors.mjs` converts
standard opaque names to RGB hex in color-bearing declarations on both sides.
It is a harness pre-pass, not runtime color support. Preserve strings, URLs,
custom properties, and existing color syntax; record normalizations in the report.

## 5. Validate the complete change

Run harness checks after adapter, comparison, font, or interaction changes:

```sh
npm run wpt:test
```

Run the native regression relevant to the engine change. For example, from this
repository root with a sibling core checkout:

```sh
GEA_NATIVE_JOBS=2 bash ../core/packages/core/test/run-css-block-and-flexbasis.sh
GEA_NATIVE_JOBS=2 bash ../core/packages/core/test/run-css-background-text.sh
GEA_NATIVE_JOBS=2 bash ../core/packages/core/test/run-transformed-rounded-rect.sh
```

Select tests for the touched behavior; these examples are not a mandatory batch.
For static CSS code generation, run the focused checks from `core/packages/core`:

```sh
node test/test_css_background_codegen.mjs
node test/test_static_css_codegen.mjs
```

For Gea plugin changes, build from `core/packages/geatsc-plugin-gea` and run the
relevant test file, for example `npm run build` followed by
`node --test test/cpp-template-renderer.test.mjs`. If changing the separate
compiler repository, follow its own build and emitted-set gate requirements.
Do not create a private compiler build or rebuild the shared compiler while
another developer is measuring it.

After focused validation, rebuild WPT and run **without a filter or limit**:

```sh
npm run wpt:build
npm run wpt:run
```

Compare by upstream test path, not aggregate pass count: new passes can conceal
regressions elsewhere. This snippet requires comparable full runs, prints every
status transition, and fails if an earlier PASS became something else:

```sh
node - <<'JS'
const assert = require('node:assert/strict');
const before = require('./dist/wpt-results.before.json');
const after = require('./dist/wpt-results.json');
for (const r of [before, after]) {
  assert.equal(r.scope.filter, null);
  assert.equal(r.scope.limit, 'all');
  assert.equal(r.scope.selected, r.scope.available);
}
assert.equal(before.revision, after.revision);
assert.deepEqual(before.viewport, after.viewport);
const old = new Map(before.results.map(t => [t.test, t.status]));
assert.deepEqual([...old.keys()].sort(), after.results.map(t => t.test).sort());
let regressions = 0;
for (const t of after.results) {
  const previous = old.get(t.test);
  if (previous !== t.status) console.log(`${previous} -> ${t.status}: ${t.test}`);
  if (previous === 'PASS' && t.status !== 'PASS') ++regressions;
}
assert.equal(regressions, 0, 'Previously passing tests regressed');
JS
```

This status check supplements inspection: compare prerequisite results, reasons,
normalizations, pixel metrics, build provenance, and any ERRORs too. A FAIL becoming
SKIP/BLOCKED is not a fix. An intentional correction of a false PASS must have
independent evidence and be explained, not silently accepted or hidden.

Build a representative TSX application when runtime or codegen behavior changes.
For embedded work, compile with the actual board toolchain and test on hardware;
native/WASM builds can miss integer typedef differences and platform-header macros.
Verify boot and drawing after flashing, not just a successful flash hash. The
device CLI provides `gea devctl state`, `gea logs`, and `gea screenshot` with a
configured `--board <alias>`; use `--transport usb` when the app has no network.
Record actual package/compiler paths so an old installed package cannot masquerade
as the code under test. A necessary reboot should be reported with the observation.

## 6. Check performance separately from correctness

The WPT builder currently uses `-O1` and a fresh process/WASM instance per document.
Its total run time includes startup, fonts, and reporting. It is not a board frame
benchmark. Likewise, approximately 60 FPS can conceal lost CPU headroom behind
display pacing. Do not claim performance parity from either number alone.

For a before/after comparison, hold the application, compiler, toolchain, flags,
viewport, fonts, device clocks, display settings, and workload constant; change
only the renderer revision. Coordinate use of the shared tree/build rather than
mixing revisions or inventing private compiler builds. Warm up, repeat runs, and
record sample counts, median, p95/p99, missed frames, and memory/allocations.
Measure style resolution, layout, paint/replay, and display transfer separately
when instrumentation is available. State missing measurements explicitly.

Include ordinary scenes that do not use the new feature, plus transforms, text,
layout updates, and scrolling. Inspect hot paths for new tree/display-list scans,
allocations, cache invalidations, or unconditional full repaints. Keep diagnostics
equivalent between versions and avoid contended parallel benchmarks. If feature
correctness requires a slower path, document its trigger and cost. For example,
text-clipped background mutations currently require a full repaint; that is not
a reason to send all ordinary scenes through the same path.

## 7. Extend the corpus deliberately

`test/wpt/selection.json` owns the case list; `manifest.json` records revisions,
dependencies, and SHA-256 hashes. Files in `upstream/` retain their upstream
contents, references, metadata, and license. Every run verifies the pinned files.

`npm run wpt:import` is a networked maintenance operation to fetch the existing
selection. `npm run wpt:expand -- 1000` **adds** 1,000 cases; it is not a command
for running 1,000 tests. Review selection changes, resources, and provenance, then
take a new full baseline. Do not select cases by whether they pass. Compare fixes
with a constant corpus before mixing in an expansion. Adapter extensions need
transport tests and independent controls before newly runnable comparisons can
be trusted. Other renderers can reuse the corpus and comparison/reporting logic
through a new render backend, with their own provenance and prerequisites.

## Handoff and completion criteria

Leave the default report showing the full corpus. In the commit or handoff, state
the source revisions/dirty state, exact commands, affected rules and files,
independent regression evidence, full status totals, per-test changes, and remaining
failures/limitations. Report performance observations separately from guarantees.
Keep generated binaries, reports, screenshots, and baseline JSON in ignored build
output; commit the implementation, tests, fixtures/provenance, and useful findings.

As a **historical checkpoint**, the last full run recorded on 2026-09-25 was
1,100 selected: **434 PASS, 62 FAIL, 603 SKIP, 1 BLOCKED, 0 ERROR**. It included
20 passing harness checks and 93 passing rendering prerequisites, with the
text-emphasis prerequisite failing. Float/nowrap line continuity and several
text-clipped background combinations remained unfinished. The AMOLED cube later
ran around 59–63 rendered FPS, but no controlled hardware before/after comparison
was completed. Reproduce a baseline before continuing; none of these counts are
hardcoded success criteria.
