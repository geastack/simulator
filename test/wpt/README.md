# WPT CSS reftests on Gea's simulator renderer

For the end-to-end development process, start with the
[CSS conformance developer workflow](../../docs/CSS-CONFORMANCE.md). It covers
baseline selection, failure diagnosis, independent controls, runtime and hardware
validation, performance comparisons, and handoff. This README also retains the
chronological findings below; earlier counts and limitations describe those runs.

This runner feeds upstream HTML/CSS into Gea's C++ tree and stylesheet APIs,
then compares the test and reference RGB565 framebuffers. It uses the shared
framework source manifest and the simulator's `web_display.cpp` and platform
implementations, compiled to WASM with Emscripten. Node hosts the WASM module;
no browser window, screenshot timing, device frame, or display scaling is involved.

## Run

Install dependencies (`npm ci`) and put Emscripten's `emcc` and `em++` on PATH:

```sh
npm run test:wpt
```

The default build uses the installed `@geastack/*` packages. To test workspace
sources instead, from the simulator repository:

```sh
export GEA_CORE=../core/packages/core
export GEA_HOST_DIR=../core/packages/host
export GEA_ENGINE_DIR=../core/packages/engine
export GEA_ELEMENTS_DIR=../core/packages/elements
export GEA_GEAOS_PACKAGE_DIR=../core/packages/geaos
npm run test:wpt
```

The build records the actual package paths, compiler and flags in the report.
It builds serially and uses compiler dependency files for incremental rebuilds.
It does not invoke geatsc or change `compiler/dist`.

Open `dist/wpt-report.html` for actual/reference/diff PNGs and node geometry.
`dist/wpt-results.json` provides machine-readable results and build provenance.
All generated files live in the simulator's existing ignored `dist/` output.

The default run selects **all imported CSS tests**, currently **1,100**.
Failures and skips remain visible in the report. Both reports record the
selected count and total available count. Run the complete corpus with:

```sh
npm run wpt:run
```

Use `--limit N` only when explicitly requesting a smaller run. A filename filter
is applied before any explicit limit. As the imported corpus grows, the default
automatically includes every CSS test.

The first 100 cases in the latest complete run report
**90 PASS, 8 FAIL, 2 SKIP, 0 BLOCKED, 0 ERROR**. The skips cover unsupported
inline formatting and a quirks-mode document. The complete 1,100-case run reports
**434 PASS, 62 FAIL, 603 SKIP, 1 BLOCKED, 0 ERROR**. Earlier worker input stalls
and the asynchronous pipe-read correction are described below.
All twenty harness checks and ninety-three independent rendering prerequisites
pass. One scoped text-emphasis probe fails and blocks a shared false match;
first-line background painting remains verified. See the latest results below.

After a build, run a case by upstream filename substring:

```sh
npm run wpt:run -- flex-item-position-relative
```

Exit codes: **0** means all runnable selected tests and prerequisites pass,
**1** means a reftest failed, prerequisites blocked interpretation, or no tests ran,
and **2** means a rendering/infrastructure error in the
results. Early setup errors also exit nonzero. Skips remain visible and do not
count as passes. A passing run says nothing about skipped or unimported tests.

## Current selection: 1,100 CSS cases

A further 1,000 cases have been added to the original 100. The existing cases
remain in their original order and at the original pinned upstream revision.
`selection.json` records the exact list and `expectedCount`; `manifest.json`
records the imported documents and dependency hashes.

`node test/wpt/expand.mjs 1000` is the explicit networked selection operation.
It selects additional standards-mode static HTML reftests and static HTML
references in round-robin batches across ten CSS areas. It excludes script-driven
readiness, embedded browsing contexts and print fixtures. It does **not** filter
text, fonts, assets, CSS properties or selectors by renderer support, and never
consults pass/fail results. This operation adds to the existing selection; do not
repeat it merely to re-import the current corpus. Use `npm run wpt:import` for that.

The importer follows reference and stylesheet links, image sources and CSS URLs,
with bounded network concurrency. Pinned existing files are verified before
reuse. Missing optional upstream resources are recorded with their HTTP status
in `missingResources`; they are never replaced with invented images or fonts.
Required test/reference documents and stylesheets must exist.

Many of the added tests currently require adapter or engine work. Skips remain
unfinished coverage; the objective is not met by importing files or by matching
only the subset the current adapter can run. Normal test runs remain offline.

## Initial expansion: 100 CSS cases

The first expansion listed 100 unique test documents at the same pinned
upstream revision as the original 14-case corpus:

| CSS area | Tests |
| --- | ---: |
| Flexbox | 60 |
| Backgrounds, borders and shadows | 20 |
| Overflow | 10 |
| Transforms | 10 |

Reference documents and support files are dependencies, not additional tests.
The original 14 cases remain in their original order, preserving their artifact
names. The 86 additions were selected by static adapter compatibility of both
test and reference, before rendering either side; pass/fail results did not
influence selection. The original two adapter skips remain visible. This is a
convenience sample, not a random sample or an exhaustive property matrix.

These areas include dependencies beyond the engine's implemented CSS subset
(e.g. writing-mode variants, collapsed flex items, background clipping and 3D
rendering). Such properties are passed through unchanged. A failure may expose
an unsupported dependency, and a matching pair may still share an engine defect;
this corpus does not certify every property appearing in a passing document.
The text-free adapter restrictions remain unchanged.

## Upstream provenance

`manifest.json` pins an upstream WPT commit and SHA-256 for every vendored file.
The runner checks these before execution. Files under `upstream/` are unchanged
upstream sources, including original author/spec/reference metadata and license.
Do not edit them to get a green result. `npm run wpt:import` is an explicit,
networked maintenance operation that fetches the reviewed `selection.json` list;
ordinary runs are offline. Updating the revision/selection and reviewing the
resulting source changes is intentional work, not automatic baseline approval.

References are rendered through Gea, as with ordinary WPT reftests. Multiple
references use WPT's any-match/all-mismatch rules. Exact pixel equality is the
default. Simple upstream fuzzy ranges are honored; unsupported fuzzy metadata
is skipped rather than replaced by a global tolerance. A hardcoded geometry
and color canary runs first, detecting blank or broken rendering paths.

The transport control uses explicit dimensions and hexadecimal red. Separate
CSS prerequisite probes check named red after the adapter's color pre-pass and
author rules on the HTML body.
If an applicable prerequisite fails, matching WPT images are **BLOCKED**, not PASS: both
sides can share the same rendering defect. Unequal images still report FAIL,
with the prerequisite warning attached. The process exits nonzero either way.
Unit-specific prerequisites inspect declarations on both the test and all its
references, including nested expressions and custom-property fallbacks. An
unrelated failed unit probe does not block that comparison.

## Current adapter scope

* Standards-mode HTML, `html`/`body`/`div`/`span`/`section`, IDs/classes, inline
  declarations, embedded and linked stylesheets. ASCII/degree text and all
  source whitespace are transported to the native layout engine. Comments do
  not interrupt a contiguous CSS text sequence.
* 800 × 600 CSS pixels, DPR 1: the WPT viewport, not the physical board viewport.
  Pixel storage and rasterization use the simulator's embedded RGB565 path.
* HTML body margins and root text color are installed at Gea's default-style
  priority, below author styles. The display list paints onto a white viewport.
  Paragraph display and `1em` block margins are registered as UA element rules
  by the test bridge. The shared cascade keeps them below author rules,
  including universal selectors; the engine does not install HTML defaults.
  Selector lists are split for the native one-selector-per-rule API. Simple
  element/class selectors use their corresponding native registration APIs.
  CSS values go through Gea's existing resolver; browser-computed styles are
  never injected.
* `named-colors.mjs` is a test-only pre-pass mapping all 148 standard opaque
  [CSS named colors](https://www.w3.org/TR/css-color-4/#named-colors) to RGB hex.
  It normalizes color-bearing stylesheet and inline declaration values on both
  sides of each comparison, leaving upstream files and runtime code unchanged.
  Selectors, strings, URLs, custom properties, existing RGB values, `transparent`
  and `currentColor` are preserved. It does not resolve `var()` or its fallbacks.
  Every changed declaration is recorded in the JSON report. These results do
  not test the runtime's ability to parse color names.
* Each document gets a separate process/WASM instance, a 30-second timeout,
  a fresh tree and an initial layout/paint. This first version has no animation
  or mutation lifecycle and does not exercise the TSX compiler/app loader.
* Scripts, further HTML defaults and display modes, text outside
  the native ASCII/degree repertoire, XHTML, image assets,
  at-rules other than basic TrueType/WOFF1 `@font-face`, `!important`, quirks mode, compound HTML/body selectors and unsupported
  HTML are explicit skips.
  These are adapter limitations, not evidence that the engine cannot support them.
* `display` declarations are transported for `block`, `flex`, `grid`, `none`,
  `flow-root`, `list-item`, `inline-flex` and `inline-grid`; any other value is
  a skip. Whatever the engine does not implement for these values (such as
  list markers) shows up as a failure, not a skip.
* Apart from that disclosed color normalization, CSS properties and values are
  sent unchanged to the engine. The imported corpus includes
  interactions with features such as floats, flex-flow and order. A failure
  can come from those prerequisites or from the reference's rendering; the test
  filename alone does not identify the defect. This is not a property support
  certification matrix.

Two renderings can share a bug. Reftests reduce this risk through independent
reference constructions, but do not eliminate it. The canary detects a broken
transport; it is not a proof that every reference is correct. Future coverage
should include numeric WPT assertions and independent browser checks.

## Extension points

Keep the upstream documents as the common corpus. Add controlled fonts/assets
and whitespace transport, then scripted `testharness.js` and readiness support.
Other platforms can replace the rendering subprocess while keeping import,
reference semantics, image comparison, provenance and reports. Add real-board
captures separately; WASM does not test ESP32 memory limits or panel transport.

Harness checks: `npm run wpt:test`. Renderer conformance: `npm run test:wpt`.
These are separate results: a correct harness can—and should—report engine failures.

## Findings (2026-09-24)

Against the local engine sources, the WASM build and five harness checks passed.
The framebuffer transport control and author body-margin probe passed. The
named-color probe failed: `background:red` left a white pixel where
`background:#ff0000` painted red. Inspection of `ui/style.cpp` confirmed that
`parseCssColor` handles hexadecimal, RGB functions and transparent, but no named
color lookup. This describes the runtime declaration path exercised here; this
rig does not establish what the app build-time CSS pipeline accepts.

The initial 14 imported tests therefore yielded **12 BLOCKED, 2 SKIP, 0 PASS**.
The raw pixel comparisons all matched, demonstrating why the independent
prerequisite matters.

With the test-only named-color pre-pass, all eight harness checks and both CSS
prerequisite probes pass. The same corpus and existing WASM build yield
**7 PASS, 5 FAIL, 0 BLOCKED, 2 SKIP**. The failing cases cover order, gaps and
horizontal/vertical wrapping; their images and geometry need investigation to
identify the underlying defects. No upstream fixture or runtime implementation
was changed.

The first shared-engine fixes add stable `order` handling for layout, painting
and hit testing, and implement `align-content` for wrapping flex lines. Explicit
`flex-start` is now distinct from stretch in both runtime parsing and app CSS
code generation. Rebuilding the same local engine gives **8 PASS, 4 FAIL,
0 BLOCKED, 2 SKIP**: `flex-order.html` now matches its reference exactly.
Native regressions cover order changes, stable ties, block/grid applicability,
overlap painting/hit testing, and row/column line alignment. The native CSS and
viewport-metrics checks, five focused code-generation checks, and eight adapter
checks pass.

At that stage, four failures remained; no fixtures or comparison tolerances were
changed. Investigation identified these additional dependencies:

* Both wrapping fixtures use content-box border sizing and floated reference
  boxes. The engine sized explicit boxes including padding and ignored
  borders during layout, and did not implement floats.
* The gap fixtures also use `flex-flow`, separate `row-gap`/`column-gap` values,
  percentage gaps, and either auto margins or `writing-mode: vertical-lr`.
  These needed implementation before the fixtures could establish gap
  conformance.

Upstream documentation: <https://web-platform-tests.org/writing-tests/reftests.html>

## Shared-engine corrections

The subsequent fixes implement content-box/border-box sizing with border insets,
text-free float/clear placement, flex-flow and reverse directions, separate and
percentage gaps, flex auto margins, and vertical flex axes. Grid also uses the
separate gap axes. Mixed percentage width/height expressions resolve during
layout and track changes to their containing block; ordinary CSS variables and
viewport expressions keep their existing invalidation behavior.

Universal selectors now match every element. This exposed an earlier false
positive in the minimum-size fixtures: both sides had omitted the universal
width/height rules. The automatic flex minimum now floors the flex basis before
line packing and distinguishes an explicit zero minimum from the initial auto
minimum. Numeric native assertions independently cover these behaviors rather
than relying solely on equality between two engine-rendered images.

The CSS default is now `content-box`, including for text, input and image box
measurement. Applications that require fixed outer dimensions should explicitly
set `box-sizing: border-box`, as required by CSS; this is a visible behavior
change for existing applications that relied on the old implicit border-box
sizing. Native viewport fixtures with fixed outer dimensions declare it explicitly.

This work exercises the shared renderer through WASM and native host tests. It
is not full CSS conformance: the corpus remains small, the adapter still skips
text and quirks-mode documents, float placement does not establish mixed inline
text wrapping, and physical ESP32 rendering and memory use have not been tested.
Named colors remain entirely in the test adapter's pre-pass.

Result for the original 14-case selection after rebuilding these corrections: **12 PASS, 0 FAIL,
0 BLOCKED, 2 SKIP, 0 ERROR**, with zero differing pixels in every runnable case.
The skips are `flex-container-margin.html` (inline formatting outside the adapter)
and `flexbox-definite-cross-size-constrained-percentage.html` (quirks mode).
All eight adapter tests, six focused app code-generation tests, and the native
CSS, viewport-metrics, percentage-sizing and inline-text regression programs pass. The minimum-size screenshots were also
inspected to confirm that their content is actually rendered.

## Expanded-corpus baseline

The 100-case run yields **56 PASS, 42 FAIL, 0 BLOCKED, 2 SKIP, 0 ERROR**.
All 86 added cases execute; the two skips are retained from the original corpus.
All original 12 runnable cases still pass. The eight adapter checks pass, and
all 189 imported upstream files pass their pinned SHA-256 checks.

| Area | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| css-flexbox | 39 | 19 | 2 |
| css-backgrounds | 10 | 10 | 0 |
| css-overflow | 3 | 7 | 0 |
| css-transforms | 4 | 6 | 0 |

This run intentionally exits 1 because the 42 visual comparisons fail.
No renderer implementation, upstream fixture, or comparison tolerance was
changed for this expansion. Inspect the generated actual/reference/diff PNGs
and geometry in `dist/wpt-report.html` before attributing failures to specific
properties. Matching images remain subject to the shared-renderer limitations
described above.

## RTL and sideways flex axes

The shared renderer now resolves inherited `direction` for flex axes and maps
`sideways-lr` and `sideways-rl` consistently with row/column reversal and
wrap-reverse. All 13 selected `flexbox-writing-mode-*` cases pass, fixing seven
failures from the original 100. Native assertions cover parent inheritance,
child overrides/removal, direction mutation and sideways axis positions; the
focused application code-generation checks pass as well. This tests box layout,
not Unicode bidirectional text shaping.

## 1,100-case working baseline

The expanded corpus currently reports **99 PASS, 88 FAIL, 0 BLOCKED, 913 SKIP,
0 ERROR**. All 1,812 vendored upstream files pass their pinned hashes. This is
an incomplete baseline, not completion of the conformance work. Adding grid
transport enabled 44 additional comparisons; the writing-mode correction fixed
seven failures and grid static-position alignment fixed another thirteen.

Grid absolute children now align within the grid content box, accounting for
border and padding, and `align-self` affects the block axis rather than both
axes. Numeric native assertions cover the content origin, centering, end
alignment and separate `justify-items` behavior. Native CSS, viewport and
percentage-sizing checks pass, as do six focused code-generation checks and ten
adapter checks.

Linked stylesheets are read from the hash-verified resource set in document
order. They still use the native stylesheet parser and named-color pre-pass.
Font-face declarations, text/HTML transport, images/SVG, additional display modes,
and the remaining engine failures need further work. Skips are retained as
unfinished coverage, including the two original skipped cases. The next broad
adapter dependency is controlled font loading and text transport through the
existing native font and text APIs; omitting instruction text or substituting
browser-computed geometry would weaken the tests and is not an acceptable fix.

## Auto grid tracks and font loading

The full 1,100-case run now reports **105 PASS, 82 FAIL, 913 SKIP, 0 BLOCKED,
0 ERROR**. Six grid comparisons were fixed by stretching auto tracks under
`align-content`/`justify-content: normal` or `stretch`, then aligning children
inside those tracks. Previously an implicit row used the child's intrinsic
height and incorrectly used `align-items` to position the whole row. This follows
[CSS Grid's auto-track stretch step](https://www.w3.org/TR/css-grid-2/#algo-stretch).
Native numeric checks cover implicit and explicit tracks, multiple rows and
columns, gaps, intrinsic height, minimum height, fixed tracks and non-stretch
content alignment. The CSS, viewport and percentage-sizing native checks pass.

The test bridge now registers hash-verified TrueType bytes with the engine's
existing font API. The build enables the existing runtime TTF rasterizer; no
font parser or glyph rasterizer was added to the production engine. Basic
`@font-face` declarations resolve URLs relative to their declaring stylesheet.
Font variants, multiple source alternatives and other formats remain explicit
adapter skips. Font sources are recorded for runnable comparisons.

An independent pinned-Ahem prerequisite paints `X X` at 20px: the full image
must contain exactly two 20px black squares separated by a 20px white space,
and the native text geometry must measure 60 × 20px. This passes with zero
differing pixels and detects fallback-font metrics or missing glyph painting.
All twelve harness checks pass. General HTML text remains skipped pending
anonymous text semantics and UA defaults; loading a font alone does not finish
that coverage. The full run still exits 1 for the 82 visual failures.

## Text transport and font shorthand

The next run enables **61 additional cases** and reports **121 PASS, 127 FAIL,
852 SKIP, 0 BLOCKED, 0 ERROR**. The original 100 remain at 63 pass, 35 fail and
two skips. The higher failure count includes newly executable coverage; the
full goal remains unfinished.

HTML text uses native text nodes marked `#text`. These inherit font and color
properties, are excluded from element-selector matching, and do not affect
`:first-child`/`:last-child`. Existing styleable Gea TextElements keep their
behavior. Collapsible whitespace does not create flex/grid items or empty
lines between block elements. A regression covers consecutive whitespace nodes
separated by comments, which initially displaced ten previously passing cases.

The default serif font is pinned upstream Gentium Plus. Its WOFF1 wrapper is
decoded losslessly into SFNT tables, with bounds and checksums validated.
Independent tests compare every decoded table with its source and verify the
complete SFNT checksum. Pinned Ahem is also available as an installed test font.
Documents that name the generic `monospace` family also load DejaVu Sans Mono
2.35 from `test/wpt/fonts`, the rig's own font directory (upstream WPT pins no
monospace font). It is unmodified, pinned by SHA-256 in `fonts.mjs`, and
distributed under the Bitstream Vera license in `fonts/LICENSE-DejaVu.txt`.
Font variants, general font matching/shaping, paragraph defaults, additional
display modes and other character repertoires still need work.

The shared native parser and application code generator now handle the basic
`font` shorthand, including supported size/line-height units, weight, family
lists and resets of omitted weight/line-height. Percentage font sizes use the
parent's font size rather than the containing box height. Unsupported face
variants and system-font shorthand values are not implemented. An independent
HTML control exercises `font:20px/1 "Missing font", Ahem`, inheritance and font
fallback inside a declared 100px line box. Its pixels must exactly match the
two 20px Ahem squares; the separate direct control checks intrinsic 60px width.

All four rendering prerequisites, fifteen harness checks, six focused app
code-generation checks, and native CSS, viewport, percentage-sizing and inline
text regressions pass. Native builds emit an existing warning about the test
host's unhandled `FillTrianglesRgb565` command. The visual run exits 1 for its
127 failures; passing controls do not certify every feature in a reftest.

Visual inspection confirms glyph painting in the anonymous-inline inheritance
case, but also exposes remaining inline/whitespace defects shared by its test
and reference. Normal whitespace still needs consistent collapsing across
measurement, line breaking and drawing; `pre`/`nowrap` currently share a native
value and need separate behavior. A font control without a declared containing
width also exposed incorrect shrink-to-fit sizing of an absolute container in
an otherwise empty document. Its final font probe declares a 100px line box to
isolate font behavior; it does not validate that unresolved sizing behavior.
These are outstanding engine defects, not reasons to discard upstream cases
or treat the current matches as complete CSS text conformance.

## Whitespace and detection of false matches

The native renderer now collapses normal/nowrap whitespace consistently during
measurement and painting, separates `pre` from `nowrap`, and handles preserved
line breaks with collapsed spaces for `pre-line`. Authored text remains intact
so changing white-space recomputes from the source. Projected text uses the same
preparation during measurement and replay. Native and generated application
styles preserve distinct values for all six white-space keywords.

Six new independent Ahem probes validate normal/nowrap collapse, preserved
spaces and line breaks, overflowing preformatted lines, pre-line, and wrapping.
All six pass exact pixels and geometry. Native CSS, inline-text, viewport and
percentage-sizing checks pass, together with seven focused code-generation
checks and sixteen harness tests. This does not complete CSS text layout:
cross-run collapsing, tab stops, pre-wrap/break-spaces wrapping details, nowrap
overflow, float/text interaction and font-relative box units still need work.

The full run reports **119 PASS, 125 FAIL, 4 BLOCKED, 852 SKIP, 0 ERROR**.
The default 100-case selection remains **63 PASS, 35 FAIL, 2 SKIP**. The run
exits 1. The original color, margin and font prerequisites and all six new
whitespace probes pass; the new `font-relative-ch` prerequisite fails:
`width:5ch` with 20px Ahem measures 5px instead of 100px (1,900 wrong pixels).

Investigating three new screenshot matches exposed that unit defect: the
32ch line-clamp fixtures become only 32px wide, pushing differing text below
the 600px viewport. These matches are not fixes. The scoped prerequisite now
blocks those three plus the previously matching `float-nowrap-1` comparison.
`float-nowrap-2` now fails visibly because normalizing its text reveals that
the float layout stacks separate nowrap runs on different lines. Its former
match was not evidence of correct float/text layout. No upstream fixture or
pixel tolerance was changed to obtain these results.

## Font-relative character dimensions

Following the [CSS font-relative unit definition](https://www.w3.org/TR/css-values-4/#font-relative-lengths),
the `ch` dimension correction resolves the zero glyph through the native text
measurement path, including the active font family and size. Width and height
retain expressions until layout, including calc/percentage/custom-property
combinations; they are no longer frozen to the font available when the
declaration was first applied. Font-dependent expressions bypass the cache
whose key only describes containing-block dimensions.

Stylesheet font metrics are cascaded before other properties consume them,
including inline font overrides. Changing an element's font now recomputes its
own class-derived lengths as well as descendants. Numeric regressions cover
declaration ordering, class padding, different font sizes sharing an expression,
font mutation, custom properties, percentage/ch calculations, inline dimension
overrides/removal, and parent metrics for `font-size:2ch`.

The independent Ahem prerequisite now measures and paints **100 × 20px** for
`width:5ch; font:20px/1 Ahem`, with zero differing pixels even though width is
declared first. All eleven rendering prerequisites pass. The full corpus is
**120 PASS, 128 FAIL, 0 BLOCKED, 852 SKIP, 0 ERROR**; the default 100 remain
**63 PASS, 35 FAIL, 2 SKIP**. The three previously blocked line-clamp matches now
fail visibly at the corrected width; the fourth blocked comparison passes.
No formerly passing comparison regressed. Native CSS, viewport,
percentage-sizing and inline-text programs and sixteen harness checks pass.

This is still incomplete CSS unit support. Other font-relative box units,
retaining expressions for non-dimension inline overrides, font animation
invalidation, generic monospace font matching, and remaining text/float/line-clamp
behavior need work. In particular, an inline `padding:1ch` is currently stored
as resolved numbers and will not track a later font change; stylesheet padding
and deferred inline width/height do track it. The full conformance run continues
to exit 1 for the 128 failures, and the skipped cases remain unfinished coverage.

## Paragraph defaults, margin collapsing and intrinsic block sizes

The adapter now transports `<p>`. Its default display and margins live in the
test bridge and use the shared cascade's UA origin. The engine resolves `em`
and `rem` alongside `ch`, preserving dimension expressions until layout.
Font-size expressions use the inherited font as their percentage/`em` basis;
root `rem` font-size uses the initial font size. Author declarations, including
`* { margin: 0 }`, outrank the paragraph defaults.

Normal horizontal block layout now collapses adjoining vertical margins,
including positive/negative groups across empty blocks and unpadded
parent/child edges. Padding and new block formatting contexts contain child
margins. These rules follow [CSS margin collapsing](https://www.w3.org/TR/CSS22/box.html#collapsing-margins).
Mixed inline/block flow, float clearance interactions and vertical block flow
still need further work; this is not a claim of complete block formatting.

Intrinsic block widths are measured before normal-flow stretching, so nested
auto-sized flex items and scrollable descendants can contribute their content
width. Single flex lines clamp that measured cross size to the container's
min/max cross size. Horizontal parents preserve the intrinsic width of
orthogonal children, whose width is their block size.

Five independent paragraph prerequisites check exact Ahem pixels and box
geometry: defaults, author reset, sibling collapse, parent collapse, and a
positive/negative margin group through an empty paragraph. A failed paragraph
probe gates matching reftests only when their test or a reference contains
`<p>`. Native checks separately cover escaped margins, padding/BFC boundaries,
intrinsic flex widths, scrollable descendants, flex-line max sizing and
orthogonal flex/grid children. The absolute-containing-block regression also
checks both the collapsed and padded-parent cases.

The complete 1,100-case run reports **175 PASS, 263 FAIL, 662 SKIP,
0 BLOCKED, 0 ERROR**. Compared with the pre-paragraph baseline, 190 more cases
execute and the total pass count rises from 120 to 175. All sixteen harness
checks, sixteen independent rendering prerequisites, and native CSS,
viewport/positioning, percentage-sizing and inline-text checks pass.
The full visual run still exits 1 for its 263 mismatches.

At that stage, intrinsic sizing exposed five regressions relative to the first
paragraph-enabled run: `abspos-auto-sizing-fit-content-percentage-001` through
`004` and `float-root`. Percentage margins in cyclic shrink-to-fit sizing and
floating the root needed further engine work; the follow-up below fixes them.
A flex reftest timed out once during an intermediate full run, passed when
rerun alone, and passes in the final full run. No fixture, fuzzy tolerance or
expected image was changed. The overall goal remains unfinished.

## Deferred box edges and intrinsic heights

Percentage and font-relative margins/padding retain their authored expressions
through layout. Cyclic percentage edges contribute zero during intrinsic width
measurement, then resolve against the final containing width without expanding
that containing box. Vertical percentage margins and padding also use the
containing inline size. Mixed fixed/percentage calculations retain the fixed
term during intrinsic measurement. Inline custom properties survive cascade
recomputation, outrank class declarations, and reveal the class value when
removed; changed variable values trigger layout for deferred box expressions.

Three additional independent probes check percentage edges and cyclic margin/
padding geometry and exact pixels. There are now nineteen rendering probes.
The root float regression is also fixed: the initial containing block places
the floated root, and removing the float restores normal root placement.

The shared renderer preserves `height: min-content`, `max-content`, and
`fit-content` as intrinsic sizes. In horizontal block sizing, percentage-height
descendants (including mixed `calc()` values) behave as auto when their basis
depends on that intrinsic height. A fixed-height ancestor supplies a definite
basis. Absolute opposing insets and flex/grid stretch alignment preserve an
authored intrinsic height. These rules follow
[CSS intrinsic percentage sizing](https://www.w3.org/TR/css-sizing-3/#cyclic-percentage-contribution).
Numeric native regressions cover block/flex containers, auto wrappers, definite
ancestors, opposing insets, flex/grid alignment, and inline/class mutations.
This is not complete intrinsic sizing: vertical inline-axis intrinsic heights,
intrinsic widths, and general flex/grid percentage definiteness still need work.

The intrinsic-height checkpoint reports **184 PASS, 254 FAIL, 662 SKIP, 0 BLOCKED,
0 ERROR** across all 1,100 cases. All eight
`abspos-auto-sizing-fit-content-percentage` cases now pass; the four intrinsic
height cases changed from FAIL to PASS, with no other status changes versus
the full run immediately before the height fix. The original 100-case subset
remains **61 PASS, 37 FAIL, 2 SKIP**. All sixteen harness checks, nineteen
rendering prerequisites, and native CSS, percentage-sizing, viewport and
inline-text checks pass. One flexbox case timed out in an intermediate full
run, passed in isolation, and passed in the final complete rerun with native
builds finished. The full run exits 1 for the 254 visual failures. Skips are
unfinished coverage; the overall 1,000-additional-tests goal remains active.

## Overflow alignment and inline grid track persistence

The shared alignment parser retains `safe` and `unsafe` for supported positional
keywords. Safe alignment falls back to logical start when the margin box
overflows; with sufficient space it retains the requested alignment. Unsafe
alignment permits negative offsets. Logical start/end remain distinct from
flex-start/flex-end in reversed flex directions. This behavior follows
[CSS overflow alignment](https://www.w3.org/TR/css-align-3/#overflow-values).
The existing `flex-flow` implementation was retained.

Flex line distribution, flex item alignment, grid track/item alignment and
absolute static positions use the shared overflow-position decoding. Full and
retained absolute layout now share the same offset calculation. Native numeric
checks cover row/column/reversed flex directions, grid alignment, negative free
space, invalid modifiers, and absolute position updates versus fresh layout.

Inline grid template declarations now survive cascade recomputation. Their
authored values are reapplied after ordinary inline properties, so variable
changes update the tracks and removal restores class definitions. A native
regression checks those operations and their resulting child coordinates.

At this checkpoint, grid area sizing/placement, justify-self, and full writing-mode alignment remain
unfinished. In particular, `grid-abspos-staticpos-align-self-safe-001` changes
from PASS to FAIL: both sides previously ignored grid areas and the test also
ignored safe alignment. Recognizing safe alignment exposes the missing grid
area geometry. The fixtures and comparison tolerances remain unchanged.

The final full run at this checkpoint reports **187 PASS, 250 FAIL, 662 SKIP,
0 BLOCKED, 1 ERROR**, exiting 2. Three safe-alignment reftests change from FAIL
to PASS; two multicol comparisons also match, which does not establish multicol
or line-clamp support. The grid-area case above changes from PASS to FAIL.
All nineteen rendering prerequisites and sixteen harness checks pass, as do
the native CSS, viewport, percentage-sizing, inline-text and retained-absolute
programs.

Intermittent renderer timeouts remain unresolved. The first complete run timed
out in `flex-container-multiple-items-with-scrollable-descendant`, which ran
successfully in isolation and reported its existing visual mismatch. A full
rerun with native builds finished timed out in `flex-order`. A separate direct
check rendered its test and reference in 49 ms each and matched exactly. That
check did not replace or edit the full report: its ERROR remains visible.
The overall goal remains active, including the 662 skipped cases.

## Grid self-alignment, auto margins, and worker input

The engine now transports `justify-self` through compiled and textual rules,
cached style application, inline overrides, removal, and layout invalidation.
The supported values are `auto`, `normal`, `stretch`, `center`, `start`, `end`,
`flex-start`, `flex-end`, and `safe`/`unsafe` modifiers on those positional values.
Unsupported keywords are ignored without overwriting an earlier valid value.
The value lives in rare style storage; the hot computed-style record is unchanged.

Normal-flow grid items and the existing grid absolute static-position path
honor the child's override of `justify-items`. Auto-width grid children can
retain their content width when centered, or stretch when requested. Grid auto
margins suppress stretching and self-alignment, consuming positive free space
before alignment, as specified by
[CSS Grid auto margins](https://www.w3.org/TR/css-grid-1/#auto-margins).
The scoped refresh path uses the same stretch eligibility conditions.

Native numeric checks cover class/inline precedence, removal, inherited default
alignment through `auto`, invalid declarations, safe/unsafe overflow, auto width,
stretch, one and two auto margins on both axes, overflowing auto margins, and
refresh versus full layout. A flex item check confirms `justify-self` has no
effect on its main-axis position. Four auto-margin assertions failed before the
correction and pass afterwards. CSS, percentage-sizing and retained-absolute
native programs pass; all sixteen harness checks and nineteen rendering
prerequisites pass.

Worker diagnostics captured a 30-second timeout in the synchronous stdin read,
before WASM initialization, while rendering a transform reference. The worker
now drains its input using Node's asynchronous stream API. The existing timeout,
stage diagnostics, process isolation and failure reporting remain in place;
there are no retries or forced successful exits. Two subsequent complete runs
reported zero execution errors. This is evidence for the input-read correction,
not a guarantee that infrastructure errors cannot recur.

The complete run after the final engine rebuild reports **187 PASS, 251 FAIL,
662 SKIP, 0 BLOCKED, 0 ERROR**, exiting 1 for visual failures. No previously
failing upstream comparison changes to PASS in this step. The previously
matching `discard-multicol-004` now fails with 173 differing pixels: the extra
"Line 7" is visible. Its column, `lh`, and line-clamp behavior remain
unimplemented; an earlier matching comparison did not establish support.
Grid-area geometry, additional self-alignment keywords and full writing-mode
alignment also remain unfinished. Fixtures and tolerances were not changed,
and the full 1,000-additional-tests goal remains active.

## Numeric grid placement and explicit track shorthands

The shared engine now applies the explicit-track form of `grid` and
`grid-template`, including `none` and integer `repeat()` lists. Textual and
compiled longhands use one track-list parser. Inline shorthands retain their
authored values across cascade recomputation, including whole-shorthand
variables; later longhands replace only their own axis. Invalid shorthand
values do not partially overwrite existing tracks. Removal restores class
rules, and node cloning preserves the authored inline templates.

Numeric `grid-row`, `grid-column`, `grid-area`, and their start/end longhands
support positive and negative line numbers and spans. Normal-flow placement
reserves explicit areas before row-wise auto placement and creates implicit
tracks within the existing layout capacity. Auto-track contributions are
processed by increasing span length, with equal-span growth applied together
to avoid source-order-dependent sizing. Native regressions reproduced and
fixed both a 130px total for a 100px spanning contribution and overlapping-span
growth bias.

Grid layout stores its resolved track edges in optional rare data. Normal-flow
and absolute children use those edges, gaps, padding, borders, writing modes,
and direction to determine their physical areas. Absolute percentage sizes
and inset offsets use the area dimensions. Missing absolute line references
become auto without creating tracks, including spans anchored to missing
lines. Explicit tracks still size an otherwise empty grid. These changes
follow [CSS Grid placement and absolute positioning](https://www.w3.org/TR/css-grid-1/#abspos).
Grid absolute updates conservatively use the full layout path rather than the
retained-leaf shortcut, whose containing-block assumptions do not cover areas.

The final rebuilt 1,100-case run reports **221 PASS, 217 FAIL, 662 SKIP,
0 BLOCKED, 0 ERROR**, exiting 1 for visual failures. Relative to the preceding
187/251 baseline, **39 grid cases change from FAIL to PASS**: the safe-overflow
case, all seventeen orthogonal-positioning cases, twenty numbered positioning
cases, and one negative-index case. Five grid cases change from PASS to FAIL:
four last-baseline cases and the fixed-position static-position case. They
expose missing baseline/fixed-position behavior after grid geometry is applied.
The two unsupported multicol comparisons swap statuses; these matches do not
establish multicol support.

All nineteen rendering prerequisites, sixteen harness checks, and native CSS,
percentage-sizing, viewport and retained-absolute programs pass. The default
100-case selection remains **62 PASS, 36 FAIL, 2 SKIP**. No fixtures, adapter
skip rules, or comparison tolerances changed. Named lines/areas, full intrinsic
track sizing, additional baseline alignment, fixed positioning, and the
remaining failures and skips are unfinished; the overall goal stays active.


## Fixed positioning and viewport refresh

The shared renderer recognizes `position: fixed` as out of flow. Viewport-fixed
boxes use the viewport for their offsets and percentage sizes, remain stationary
through ancestor scrolling, and escape ordinary ancestor overflow clips in both
paint and hit testing. Recording still visits fixed descendants of offscreen
ancestors while preserving the clip for ordinary descendants. Paint-only updates
use the same clip boundary. Scroll-blit and horizontal-pan shortcuts fall back
when viewport-fixed descendants would otherwise move with the copied pixels.

Transforms, perspective, and supported blur filters establish fixed containing
blocks. Authored identity transforms and zero-radius blur retain their presence
separately from numeric values, so `translateX(0px)`, `rotate: 0deg`, `scale: 1`,
and `blur(0px)` differ from `none`. Class and inline application, cached rules,
and removal preserve that distinction. Transformed grids supply their areas to
fixed children even with `position: static`. Changes to a live transform force
layout in trees that use fixed positioning; retained reprojection alone cannot
update a child's percentage basis after its containing block changes.
These rules follow [CSS positioned layout](https://www.w3.org/TR/css-position-3/)
and [CSS transforms](https://www.w3.org/TR/css-transforms-1/#transform-rendering).

`left/top/right/bottom: auto` now clears the inset instead of becoming zero.
Viewport changes also invalidate refresh layout even when node styles are clean.
Native regressions cover viewport offsets and percentages, resize, ancestor
scrolling, offscreen overflow ancestors, paint-only updates, hit testing,
normal-flow exclusion, identity effects, live transforms, class/inline overrides,
and grid static positions. This is targeted coverage, not a claim of complete
fixed-position, transform, clipping, or stacking-context conformance.

The final rebuilt 1,100-case run reports **223 PASS, 215 FAIL, 662 SKIP,
0 BLOCKED, 0 ERROR**, exiting 1 for visual failures. Compared with the preceding
221/217 run, these three cases change from FAIL to PASS:

- `css/css-flexbox/abspos/position-absolute-containing-block-001.html`
- `css/css-grid/abspos/grid-fixedpos-static-position-not-containing-block.html`
- `css/CSS2/linebox/line-height-oof-descendants-001.html`

`css/css-overflow/line-clamp/discard/discard-multicol-004.html` changes from PASS
to FAIL (173 differing pixels). Its `columns`, `lh`, and line-clamping behavior
remain unimplemented; the earlier image match does not establish support. This
failure stays visible. The final count is stable across the follow-up full runs.

All nineteen rendering prerequisites and sixteen harness checks pass. The native
CSS, percentage-sizing, viewport-metrics, and retained-absolute programs pass,
including the new fixed-position regressions. The original 100-case selection
remains **62 PASS, 36 FAIL, 2 SKIP**. No fixtures, skip rules, or comparison
tolerances changed. The remaining failures and skips are unfinished coverage,
and the overall 1,000-additional-test objective remains active.

## First and last baseline alignment

The parser distinguishes `baseline` / `first baseline` from `last baseline`,
including either permitted keyword order, through class and inline declarations.
Absolute static positions use the baseline fallback edge in the subject's
writing mode, without clamping negative free space. In-flow grid fallback
retains overflow safety. This follows
[CSS Alignment's baseline fallback](https://www.w3.org/TR/css-align-3/#baseline-values)
and [automatic inset resolution](https://www.w3.org/TR/css-position-3/#resolving-insets).

Horizontal flex baseline groups now account for both ascent and descent in line
sizing. Last-baseline alignment measures the last text line rather than aligning
box bottoms. Reversed wrapping preserves the physical baseline within each
line; empty flex items synthesize a baseline from their border edge, excluding
the bottom margin. Native tests use two deliberately different font metrics,
multiline text, explicit and intrinsic container heights, reversed wrapping,
empty items with margins, and absolute grid children in LTR, RTL and vertical
writing modes, including oversized children and different child writing modes.

The rebuilt full run reports **239 PASS, 199 FAIL, 662 SKIP, 0 BLOCKED, 0 ERROR**,
exiting 1 for the remaining visual failures. Sixteen grid static-position
last-baseline cases change from FAIL to PASS; no passing case regresses.
The original 100 remain **62 PASS, 36 FAIL, 2 SKIP**. All nineteen rendering
prerequisites and sixteen harness checks pass, as do the native CSS,
inline-text-runs and percentage-sizing programs. Fixtures, skip rules and
pixel tolerances are unchanged.

Four related failures remain: `align-self-vertWM-last-baseline-002/004` and
`justify-self-rtl-last-baseline-002/004` in the grid static-position family.
Their references use the container's end edge when the child has a different
writing mode or direction. The current spec requires `self-end`, and
[CSSWG issue 13539](https://github.com/w3c/csswg-drafts/issues/13539) tracks that
spec/browser discrepancy. These tests remain FAIL, not waived or rewritten.
Grid baseline-sharing groups, full vertical text baseline metrics, the other
failures, and skipped coverage remain unfinished. The overall goal is active.

## Preferred aspect ratio and flex sizing order

`aspect-ratio` now participates in shared style resolution and layout. Class
and inline values retain a preferred numeric ratio, including an optional
`auto` keyword; degenerate ratios behave as auto and invalid negative ratios
preserve the preceding declaration. Inline removal restores the class value.
Ratio changes invalidate layout instead of taking a paint-only shortcut.

Automatic dimensions transfer through the ratio using the selected content or
border sizing box. A definite ratio-derived dimension is available before
percentage descendants are measured. Non-scrollable content can contribute an
automatic minimum, while explicit min/max constraints still apply. Flex items
include a size transferred from a definite cross size in their automatic main
minimum; an explicit zero minimum permits shrinking. Flex growth recalculates
ratio-derived cross sizes, and line placement follows that calculation. These
rules are covered by native geometry and live-update regressions and follow
[CSS Sizing's aspect-ratio rules](https://www.w3.org/TR/css-sizing-4/#aspect-ratio)
and [Flexbox's automatic minimum](https://www.w3.org/TR/css-flexbox-1/#min-size-auto).

The final rebuilt run reports **246 PASS, 192 FAIL, 662 SKIP, 0 BLOCKED,
0 ERROR**, exiting 1 for visual failures. Nine cases change from FAIL to PASS:
the content-box padding flex test, ratio-derived percentage height, flex ratio
cases 045–048 and 053–054, and `aspect-ratio-transferred-max-size.html`.

Two cases change from PASS to FAIL: `balance-percentage-size-001.html` and
`balance-percentage-size-002.html`, with 14,400 and 7,200 differing pixels.
Their square items now have nonzero dimensions, exposing the unsupported
`flex-wrap: balance` and `flex-line-count: 2` arrangement. The measured actual
layout has one column/row; the reference has two. These failures remain visible.
No fixtures, selection, skip rules or pixel tolerances changed.

All nineteen rendering prerequisites, sixteen harness checks, and the native
CSS and percentage-sizing programs pass. The original 100-case view is now
**63 PASS, 35 FAIL, 2 SKIP**. The imported corpus remains 1,100 unique CSS tests.
Full intrinsic sizing (including the two failing `width: fit-content` ratio
cases), grid ratio/constraint interactions, replaced-element coverage and the
remaining failures and skips are unfinished. The full goal remains active.


## Balanced flex lines

The shared engine now parses `flex-wrap: balance`, including either ordering
with `wrap` / `wrap-reverse` and combinations in `flex-flow`. Invalid
combinations preserve the previous declaration. `flex-line-count` is retained
by compiled class rules and inline styles, invalidates layout, and supports
inline removal and inheritance.

Line formation follows the [Flexbox 2 draft balancing algorithm](https://drafts.csswg.org/css-flexbox-2/#algo-balance):
ordered, nonempty partitions minimize squared unused main space; equal costs
favor more items on earlier lines. Oversized items remain alone, negative outer
sizes are floored for partitioning, and gaps participate in the fit calculation.
Suffix dynamic programming with monotone divide-and-conquer searches avoids a
quadratic candidate scan for each line. The implementation uses O(L N log N)
time and O(L N) working storage for N items and L lines. Only balancing
containers incur that work.

The minimum line count is capped by the item count for partitioning. Available
cross space uses the specified count, including for ordinary wrapping, while
percentage cross dimensions retain the full container as their basis. An
automatic unconstrained block main size does not wrap at the viewport height.
Wrapping containers with more than 32 children can allocate additional line
storage instead of dropping later lines.

Native tests compare 600 deterministic small cases against exhaustive partition
search, then check row/column reversal, class and inline parsing, mutations,
percentage aspect-ratio items, available-space text measurement, and a 40-line
container. The CSS/block/flexbasis and percentage-sizing native programs pass;
all 16 adapter/font tests pass. The two available-size WPTs remain skipped for
unsupported `inline-block` transport, which these native checks do not replace.

The final full 1,100-case run reports **261 PASS, 177 FAIL, 662 SKIP,
0 BLOCKED, 0 ERROR** (exit 1 for remaining visual failures). Fifteen balance
cases change from FAIL to PASS; no case regresses. All eighteen runnable balance
cases pass, including both percentage-sizing cases exposed by aspect-ratio
support. All nineteen rendering prerequisites pass. The original 100-case
selection stays at **63 PASS, 35 FAIL, 2 SKIP**. Pinned fixtures, selection,
skip rules and pixel tolerances are unchanged. Remaining failures and skips
still prevent completion of the full goal.


## Forced inline line breaks

The adapter now transports `<br>` as a real element, retaining its attributes,
styles and position among the original text nodes. It does not replace it with
a newline or calculate layout. The shared engine closes the current inline
line at a BR, including under `white-space: nowrap` and preserved whitespace.
Its inherited font/line-height supplies metrics for leading or consecutive
empty lines; a trailing break does not add a phantom final line. A hidden BR
contributes neither a box nor a break, and a sole text run before a BR retains
its full line box for text alignment.

Seven independent Ahem controls specify exact geometry and glyph rectangles
for ordinary, consecutive, leading, trailing, nowrap, centered and hidden
breaks. Failed BR prerequisites block matching images only when a test or
reference uses BR. Native regressions cover all four supported whitespace
modes and live display changes; the existing inline-text-runs program also
passes. The 17 adapter/font checks include preservation of the BR element and
its adjacent text, plus prerequisite dependency handling.

The first full run with BR transport reports **274 PASS, 223 FAIL, 603 SKIP,
0 BLOCKED, 0 ERROR**. Of 59 newly runnable tests, thirteen pass and forty-six
fail; no previously runnable test changes status. All 26 rendering prerequisites
pass. Remaining skips include other unsupported characters, elements and display
modes. These newly visible failures are additional work, not accepted baselines.

## Self-relative alignment checkpoint

The shared parser and layout now preserve `self-start` / `self-end` and resolve
them against the alignment subject's writing mode. `justify-self: left/right`
uses physical edges in horizontal text and line-relative edges in vertical text.
Native assertions cover grid items, absolutely positioned children, flex cross
alignment, opposite writing directions, safe overflow, and live style changes.
This checkpoint reports **291 PASS, 206 FAIL, 603 SKIP, 0 BLOCKED, 0 ERROR**:
seventeen grid static-position failures become passes, with no other status changes
relative to the BR checkpoint. The first 100 remain at 63 pass, 35 fail, 2 skip.

Eight remaining orthogonal first/last-baseline cases use pinned references with
container-relative fallback edges. The current [CSS alignment baseline
rules](https://www.w3.org/TR/css-align-3/#baseline-values) specify subject-relative
fallback edges. These comparisons remain failures; neither fixtures nor engine
fallbacks were changed merely to force a match.

## Overflow clipping and scroll ranges

`overflow: clip` now has its own native value, separate from visible and hidden.
The shared parser accepts one- and two-value overflow shorthands and resolves the
[CSS cross-axis conversion rules](https://www.w3.org/TR/css-overflow-3/#overflow-properties)
without destroying the specified values: visible becomes auto, and clip becomes
hidden, beside a scrollable axis. Changing the other axis can therefore restore
clip/visible behavior. Named-color conversion remains entirely in the adapter.

Recorded clips, retained replay, culling, and hit testing use the padding edge of
each clipping axis. The box's own painting stays outside its content clip, and an
open axis remains open when a retained subtree moves. Clip does not create a block
formatting context, disable a content-based automatic minimum, or permit scrolling.
Visible descendant overflow now contributes to ancestor scroll ranges per axis;
clipped descendant overflow is trapped at the child.

Native assertions exercise class and inline declarations, custom properties,
two-value shorthands, axis mutations, borders, pixel output across refreshes,
clipped hit targets, offscreen parents with visible descendants, margin collapsing,
flex minimum sizes, and nested scroll extents. The CSS/layout, retained absolute
subtree, and scroll-into-view native programs pass. No WPT fixture, selection,
skip rule, or pixel tolerance was changed.

The seven `clip-001` through `clip-007` comparisons match. This does not establish
support for every declaration in them: for example, outline painting is still
unimplemented on both sides of `clip-005`. Native border and pixel assertions
independently verify the clip edge. Rounded clipping, transforms, and
`overflow-clip-margin` require further work.

The final full run after rebuilding reports **301 PASS, 196 FAIL, 603 SKIP,
0 BLOCKED, 0 ERROR** and exits 1 for the remaining visual failures. All 26
rendering prerequisites pass. Compared with the 291/206 checkpoint, ten cases
change from FAIL to PASS and no case regresses: `clip-001` through `clip-005`,
`flexbox-min-width-auto-004`, and the four flex-container tests with scrollable
descendants. The original 100-case selection now reports **69 PASS, 29 FAIL,
2 SKIP**. The manifest still contains all 1,100 pinned CSS tests; remaining
failures and skips are unfinished work.

## Intrinsic preferred widths

The parser now preserves `width: min-content`, `max-content`, and `fit-content`
instead of treating the keyword as zero. Layout measures the minimum and maximum
through its existing formatting algorithms, then selects the fit-content width
between those limits using the available space. The final pass resolves percentage
children and box edges at the selected width. Authored styles remain unchanged;
probe results cannot enter the ordinary layout memo cache. Nested intrinsic boxes
inherit the current measurement constraint rather than recursively launching
another pair of probes.

Cyclic percentage widths act as auto during intrinsic measurement. Percentage
padding and margins resolve before final size selection, and min/max constraints
apply after measurement. Parent block/flex/grid stretching and opposing absolute
insets preserve an authored intrinsic preferred width. Text minimums use whole
words, including words split across adjacent transparent spans.

Native assertions cover the three keywords below, inside, and above the intrinsic
range; padding/borders; box-sizing; class and inline mutations; percentage edges
with min/max bounds; inline word boundaries; nested intrinsic boxes; cyclic
percentage children; aspect-ratio content minimums; and stretch/absolute positioning.
The CSS/layout and existing percentage-size native programs pass. The two WPT
aspect-ratio cases `block-aspect-ratio-056.html` and
`block-aspect-ratio-057.tentative.html` now match their references. Fixtures,
selection, skip rules, and comparison tolerances are unchanged.

The final rebuilt 1,100-case run reports **303 PASS, 194 FAIL, 603 SKIP,
0 BLOCKED, 0 ERROR**, exiting 1 for the remaining visual failures. The two cases
above are the only status changes against the overflow checkpoint; no passing
case regresses. All 26 rendering prerequisites pass. The first 100 remain at
**69 PASS, 29 FAIL, 2 SKIP**. The remaining failures and skips are unfinished work.


## Border-width snapping and asymmetric shorthands

The shared engine now follows the [CSS Values border-width snapping rule](https://www.w3.org/TR/css-values-4/#snap-a-length-as-a-border-width):
positive strokes below one device pixel become one pixel, and larger fractional
strokes round down. CSS px values scale by the device pixel ratio before snapping;
the native numeric style API continues to take device pixels. Compiled numeric
border styles preserve their fraction, and compiled dynamic px strings retain
their unit through a numeric application path.

Length expressions retain fractions through arithmetic and custom-property
caches. Ordinary lengths round at the final integer storage boundary; border
widths use their own snapping rule. Both the inline and stylesheet expression
paths use this evaluator. The resolved-length cache retains its existing float-sized
payload rather than adding a second precision field.

The border-width shorthand expands one to four values, snaps each side, and
clears obsolete side widths when returning to a uniform border. Border shorthands
also accept reordered tokens and omitted widths. Asymmetric edges use the common
border color unless a side color is supplied; translucent corners paint once.
Border-width changes trigger layout, including changes restored after removing
an inline override. Native tests check geometry and pixels, cache reuse,
class/inline mutations, numeric and px APIs, fractional expressions, negative
literals, transparent borders, and device ratios 1, 1.5, and 2.

An intermediate run incorrectly gained two matches when both test and reference
lost a multi-value border. Those matches were rejected during inspection. The
shorthand implementation and an independent `asymmetric-border-widths` control
now address that failure mode. The control checks its entire framebuffer against
an explicitly constructed expected image, including a 26×24 outer box and four
different snapped border widths. Upstream fixtures and diff tolerances are unchanged.


Correct transparent borders also expose earlier false matches. In
`box-shadow-radius-002.html`, the inset shadow now remains visible, while its
reference currently renders entirely white (0 nonwhite pixels): an uncolored
border still lacks the CSS currentColor fallback. In
`background-clip-padding-box-with-border-radius-003.html`, the test now paints
21,216 nonwhite pixels versus the reference's 10,000 because background-clip is
still missing. These failures remain visible. Border styles such as dashed and
ridge, curved asymmetric edges, and smaller side-width overrides of a uniform
border also remain unfinished; this change does not claim complete border support.


The rebuilt 1,100-case run reports **299 PASS, 198 FAIL, 603 SKIP,
0 BLOCKED, 0 ERROR**, with all **27** prerequisites passing. The first 100
remain **69 PASS, 29 FAIL, 2 SKIP**. CSS/block/flex-basis, viewport metrics,
percentage layout, and retained absolute-subtree native programs pass; all 17
harness tests and 16 compiler-plugin style tests pass.

Against the intrinsic-width checkpoint, border snapping and horizontal flex
item overflow now pass. `background-clip_padding-box.html` also matches, but its
dotted border still renders solid on both sides, so this match is **not evidence
that background-clip or dotted borders are implemented**.

Seven earlier matches are now failures: the two transparent-border cases above,
and `individual-transform-2a.html` through `individual-transform-2e.html`.
Previously the transform cases' uniform-border fallback had no transformed
square-stroke paint path, hiding both images. Asymmetric border strips now render
as transformed quads, exposing missing individual-transform behavior. These
failures are retained, not waived or excluded. The 603 skips and 198 failures
remain unfinished work toward the full corpus goal.

## Border currentColor and retained color updates

Borders now resolve an omitted color or explicit `currentColor` from the element's
used text color, including inherited alpha. Literal RGB colors retain a separate
binding so later text-color changes do not recolor them. The shared engine keeps
this distinction for the common color and each side; no native color-name table
or reserved pixel-value sentinel is involved. This follows the initial border
color and shorthand reset behavior in
[CSS Backgrounds §3](https://www.w3.org/TR/css-backgrounds-3/#border-color).

The native CSS regression covers both inline and cached declarations, inherited
class changes, literal/currentColor transitions, per-side overrides, shorthand
resets, removal, and geometry preservation. It also catches two related retained
paint defects: alpha-only updates must invalidate paint, and inline color/alpha
must survive cascade replay even if the supplied value already matches the
computed value. Inheritance snapshots retain the native pixel type and alpha.
The retained absolute-subtree regression passes as well.

The `border-current-color` prerequisite checks the entire framebuffer against
independently specified red and green border rectangles. One color is omitted
and inherited; the other replaces a literal with explicit `currentColor` in a
cached rule. It does not compare two renderings that might share the same defect.

The inset-shadow radius case still fails: its reference now paints the expected
visible border, but the test paints the shadow against the outer border box and
leaves a square hole. The required shadow uses the padding-box contour and a
rounded inner hole. Making its reference visible is not a conformance pass.

Three fragmentation reftests (`box-shadow/slice-block-fragmentation-001.html`
through `003.html`) previously passed because their missing outer shadows and
missing default-colored reference borders both produced blank output. With
currentColor resolved, their test images remain entirely white while their
references contain 1,000, 1,000, and 4,400 nonwhite pixels respectively. These
failures expose missing shadow/fragmentation behavior and are retained.

Verified full-run result after this change: **297 PASS, 200 FAIL, 603 SKIP,
0 BLOCKED, 0 ERROR**, with all 28 rendering prerequisites and all 17 harness
checks passing. The original 100 cases now report **66 PASS, 32 FAIL, 2 SKIP**.
The pinned 1,100-case selection, fixture hashes, fuzzy ranges, and skip rules are
unchanged.

### Float clearance, collapsed margins, and normal block widths

The float layout path now collapses adjoining block margins before determining
the hypothetical border-edge position for `clear`. Clearance moves that border
edge to the relevant float's bottom instead of adding the top margin again.
Floats retain their separate outer-edge clearance rule. Empty cleared blocks
preserve forward margin collapsing without letting that margin group escape
through the parent's bottom. This follows
[CSS 2.2 clearance](https://www.w3.org/TR/CSS22/visuren.html#flow-control).

Ordinary blocks beside floats now receive their containing block's available
width, including nested children. Previously, their measured intrinsic width
could remain zero. Intrinsic measurement remains separate from the assigned
fill width. Existing clearing-BR behavior is preserved.

Native coverage checks positive and negative margins, negative clearance,
unnecessary clearance, margins across intervening floats, empty cleared boxes,
descendant margin collapse, automatic widths, and style mutation. The new
`float-clearance-margins` prerequisite checks eighteen literal boxes and every
framebuffer pixel independently of CSS reference rendering.

The complete default **1,100**-test run reports **360 PASS, 137 FAIL, 603 SKIP,
0 BLOCKED, 0 ERROR**. These former failures now match with zero differing pixels:

- `CSS2/floats-clear/clear-on-parent-with-margins-no-clearance.html` (previously 2,500).
- `CSS2/floats-clear/clear-with-top-margin-after-cleared-empty-block.html` (previously 2,000).

Eight other failing float tests have smaller visual differences; all other
statuses and pixel counts are unchanged. There are no regressions. All **67**
rendering prerequisites, **17** harness checks, and native CSS and retained
absolute-subtree suites pass. The first 100 remain 86 PASS, 12 FAIL, 2 SKIP.
The full command exits 1 because 137 failures remain. Nested wrappers still
need shared float-exclusion state for their formatting context. Upstream
fixtures, skip rules, tolerances, and the all-tests default are unchanged.

`background-clip/clip-text-text-align.html` changed from FAIL to PASS after
transparent text correctly inherited alpha. Its five Ahem glyphs exactly fill
each 250px-wide line; the image is a solid 250×150 green rectangle (37,500 pixels).
This fixture therefore matches even without clipping the background to glyphs.
The result verifies this image, not general `background-clip:text` support.

## Sharp inset-shadow contours

Zero-blur inset shadows now use the padding-box contour and subtract an offset,
spread-adjusted hole. Border thickness is removed independently on each axis;
percentage radii produce elliptical contours. Positive spread contracts the
hole, negative spread expands it (including the CSS corner-radius adjustment),
and a collapsed hole fills the clipped padding area. This follows
[CSS Backgrounds §6.1.1](https://www.w3.org/TR/css-backgrounds-3/#shadow-shape).

Opaque centered circular rings reuse the native rounded-border stroke. Other
sharp contours emit disjoint horizontal spans, merging equal adjacent rows to
limit display commands. This avoids compositing translucent corners twice and
uses the existing transform path without allocating a framebuffer-sized mask.

Native checks compare every pixel of rectangular cases with independently
specified padding and hole rectangles. They cover asymmetric borders, padding,
positive/negative offsets and spread, opacity, collapsed/offscreen holes, and
both inline and cached declarations. Additional points check rounded and
elliptical contours, retained updates/removal, and a translated shape. The
`inset-shadow-padding-contour` WPT prerequisite independently checks the entire
800×600 framebuffer for a translated hole inside a transparent border.

`box-shadow-radius-002.html` now matches its reference exactly (0 differing
pixels), resolving the inset-radius failure described in the preceding section.
The native CSS suite and all 29 simulator prerequisites pass. This change covers
sharp inset geometry; the existing nonzero-blur approximation, missing outer
shadows, and fragmentation behavior remain unfinished.

The complete post-change run reports **298 PASS, 199 FAIL, 603 SKIP,
0 BLOCKED, 0 ERROR**, with all 29 prerequisites and all 17 harness checks passing.
The original 100 cases report **67 PASS, 31 FAIL, 2 SKIP**. The only status
change from the preceding 1,100-case run is `box-shadow-radius-002.html` changing
from FAIL to PASS. No fixtures, fuzzy ranges, selection entries, or skip rules
were changed.

## Alignment shorthands and automatic float widths

The shared engine now parses `place-items`, `place-content`, and `place-self`
into their corresponding two longhands, including independent values per axis,
baseline pairs, overflow modifiers, and variable substitution. Invalid shorthand
components leave both earlier values intact. `place-items` no longer overwrites
`justify-content`; generated native styles follow the same rule. Logical
`start`/`end` use the same encodings in generated and runtime styles.

`space-evenly` now works for flex items, flex lines, and grid tracks. All three
distributed spacing modes use cumulative division, preserving authored gaps
without accumulating integer rounding across each gap. Overflow uses the safe
fallback described in [CSS Box Alignment](https://www.w3.org/TR/css-align-3/).
Native regressions cover RTL, overflow, cached rules, inline mutation/removal,
and custom-property changes. The independent `alignment-shorthand-distribution`
probe checks the complete framebuffer and child geometry. The full alignment
checkpoint was **299 PASS, 198 FAIL, 603 SKIP**, with all 30 prerequisites passing
and no regressions: `place-content-shorthand-007.html` changed from FAIL to PASS.

Horizontal automatic-width non-replaced floats now use the existing min-content,
max-content, and final used-width measurement phases. Floated descendants
contribute to intrinsic width, including opposing floats and clearance. The
final width obeys available space and min/max constraints before children wrap,
following [CSS float sizing](https://www.w3.org/TR/CSS22/visudet.html#float-width).
Native checks cover available-space changes, margins, padding, overflow,
clearance, explicit-width mutation, and both block and flex float contents.
Orthogonal float sizing keeps its existing path.

The independent `float-shrink-to-fit` probe verifies border geometry and every
pixel of two opposing child floats. `flexbox-flex-wrap-horiz-002.html` now
matches its float-based reference exactly. Native CSS and percentage-sizing
programs pass, along with all 17 generated-style checks and 17 harness checks.

The complete float-width checkpoint was **300 PASS, 197 FAIL, 603 SKIP**, with
all 31 prerequisites passing and no regressions. Its only status change was
`flexbox-flex-wrap-horiz-002.html` changing from FAIL to PASS.

Empty blocks whose margins collapse through them now retain the border-edge
position required by [CSS 2.2 margin collapsing](https://www.w3.org/TR/CSS22/box.html#collapsing-margins).
Unless they share their parent's top margin, they are positioned as if they had
a nonzero bottom border: their own bottom margin and later siblings' margins
do not pull their descendants along. The margin group still determines normal
flow independently. This also preserves the preceding paragraph's margin when
a trailing empty block contains only floats.

A retained-layout check exposed a second issue: an unchanged scope height does
not guarantee that descendant margins have no effect on ancestors. Scoped
relayout now requires a boundary that contains those margins; otherwise it
retries from an ancestor. Native CSS and retained-subtree checks pass, including
margin mutation, negative margins, following siblings, and parent-top collapse.
The independent `empty-wrapper-float-position` probe verifies the float's full
framebuffer and geometry.

The final full run reports **303 PASS, 194 FAIL, 603 SKIP, 0 BLOCKED, 0 ERROR**,
with all **32** rendering prerequisites passing. Relative to the 298/199/603
checkpoint, five failures now match their references exactly, with no new
failures: the two alignment/float-width cases above, plus
`negative-margin-float-positioning.html`,
`zero-available-space-float-positioning.html`, and
`position-absolute-multicol-001.html`. The last case checks that an absolutely
positioned word appears below a paragraph; fixing its empty-wrapper position
does not establish general multicolumn support. The original 100 cases report
**68 PASS, 30 FAIL, 2 SKIP**. The default remains the complete **1,100-case**
corpus; no upstream fixtures, fuzzy tolerances, or skip rules were changed.


## Independent background layers and document canvas

`background-color` and `background-image` now retain independent computed
values. An image-only declaration no longer clears the color, and a color-only
declaration no longer clears gradients. The color paints beneath translucent
images. The `background` shorthand still resets both. Inline writes, cached
class rules, generated styles, and static stylesheet registrations share these
semantics; declaration removal and class changes restore the cascade.

For HTML documents, the root's solid background color covers the viewport,
including outside its border box and when the root has zero height. A
transparent root without an image takes its direct body's background color;
that color is painted once on the canvas. Containment on either `html` or
`body` prevents this propagation, as required by
[CSS Backgrounds](https://www.w3.org/TR/css-backgrounds-3/#special-backgrounds)
and [CSS Containment](https://www.w3.org/TR/css-contain-1/#contain-property).
Retained updates invalidate the full canvas when ownership or color changes,
and transparent repainting restores the white document surface.

Native checks cover the declaration combinations, generated registration
paths, cached rules, inline removal, containment, zero-height roots, root and
body opacity, and retained repainting. Independent framebuffer prerequisites
verify background-layer colors, document canvas coverage, and contained body
backgrounds without relying on another document rendered by the same engine.

This implements solid-color canvas propagation. Canvas image propagation,
positioning and tiling, ordinary `background-clip`, and the other layout and
painting effects of containment remain unfinished. In particular,
`background-color-clip.html` now produces matching test/reference images, but
both still ignore their content-box clipping: that match is **not evidence of
correct background clipping**. Reftest matches can share a renderer defect;
the independent framebuffer checks are necessary additional evidence.


The complete run after these changes reports **310 PASS, 187 FAIL, 603 SKIP,
0 BLOCKED, 0 ERROR**, with all **35** rendering prerequisites passing. Compared
with 303/194/603, seven comparisons changed from FAIL to PASS and none regressed.
Six are independently supported canvas fixes: the four root/body-propagated
`clip-border-area`/`clip-text` cases and `background-color-body-propagation-001`
and `-002`. The seventh is the shared clipping defect described above, not a
seventh conformance fix. The `contain: paint` cases `-008` and `-009` remain
passing after exercising the propagation exception.

All 17 harness tests, 18 focused generated-style tests, and three static CSS
registration-emitter tests pass. The native CSS suite passes, including the new
background and containment checks; native viewport-style and retained-subtree
checks also passed during this change. The plugin build and architecture ratchet
pass. The complete WPT command exits 1 because 187 comparisons still fail.
The first 100 cases remain **68 PASS, 30 FAIL, 2 SKIP**. The default still runs
all **1,100** tests; upstream fixtures, fuzzy tolerances, and skip rules are
unchanged.


## Background color clipping and large corner curves

Background colors now honor `border-box`, `padding-box`, and `content-box`.
The clip list is matched against the image-layer count, including `none` layers;
excess entries are ignored and shorter lists repeat. The color uses the clip
of the bottom image layer. Class rules, inline mutation/removal, and generated
styles preserve that relationship. The `background` shorthand resets the clip
list, and its one/two box keywords supply the color's clip. These rules follow
[CSS Backgrounds](https://www.w3.org/TR/css-backgrounds-3/#the-background-clip).

Inner corner radii subtract the appropriate border and padding from the
resolved outer curves. They are not clamped again to half the inner rectangle.
Percentage borders now paint from resolved outer and inner contours. Direct
and batched drawing share the eligibility check for the simpler canvas
primitive; retained recoloring shares the precise border coverage calculation.

The `background-color-clipping` prerequisite checks every framebuffer pixel
against two independently specified rectangles, including the multiple-`none`
case. `background-curved-clip` checks the geometric interior and exterior of a
large inner curve (479,860 pixels), leaving its narrow antialias boundary to
the unchanged upstream tolerances. Native checks also cover invalid values,
shorthand resets, cached class rules, inline removal, image-count changes,
transforms, and recoloring around a differently colored curved border.

The earlier shared-defect match in `background-color-clip.html` is now resolved:
its actual and reference images have the correct 120-by-100 content rectangle
at (18, 18), rather than painting under the transparent border. This change
covers background **colors**. Clipping gradient/image layers, text clipping,
border-area clipping, and general background positioning remain unfinished.


The final complete run reports **316 PASS, 181 FAIL, 603 SKIP, 0 BLOCKED,
0 ERROR**, with all **37** independent rendering prerequisites passing. Six
previous failures now match exactly: the content/padding box radius cases
`-002` and `-003`, `background-clip-color.html`, and
`background-clip-content-box-001.html`. No previously passing case regressed.
`background-color-clip.html` remains PASS and now passes an independent full
framebuffer check of its specified geometry.

The native CSS and transformed-rounded-rectangle suites pass, as do all 18
focused generated-style checks, four static registration-emitter checks, and
17 harness checks. The plugin build and architecture ratchet pass. The WPT
command exits 1 because 181 comparisons remain failing. The first 100 cases
report **72 PASS, 26 FAIL, 2 SKIP**. The default remains all 1,100 tests;
selection, fixtures, fuzzy tolerances, and skip rules are unchanged.

One remaining box-clipping-named failure,
`background-clip-content-box-002.html`, has a separate flex sizing defect:
two children with `flex-basis: 50%` in a definite 100px container receive zero
content width (their border boxes are only 5px and 6px wide). The percentage
basis was discarded by the parser; accepting it also requires layout-time
resolution instead of resolving against the container before layout. The fix
is described below.


## Percentage flex bases and truthful line-height-unit results

The flex-basis parser and static longhand registration now preserve percentages.
Deferred bases share the existing length-expression pool and resolve against
container content space on the physical main axis during layout, including
`calc()` and font-relative inputs. Measurement substitutes the basis for the
preferred width/height without modifying authored style. Unresolved percentages
in auto-height columns measure content. Inline replacement/removal, cached class
rules, custom-property fallback changes, and vertical writing modes are covered
by native checks.

The cached flex shorthand had an additional defect: its length payload overwrote
the slot subsequently read as a has-basis flag. Runtime flex operations now use
their guaranteed authored basis. Static flex registrations preserve percentages
and default shrinking; shorthands with shrink factors the compact API cannot
represent use the full declaration compiler.

`background-clip-content-box-002.html` now matches its reference exactly. Its
100-by-100 square at (8, 56) also independently contains exactly 10,000 green
pixels. The new `percentage-flex-basis` prerequisite checks row and column
geometry and every framebuffer pixel against independently specified rectangles.

The complete default run remains **all 1,100** pinned tests and reports
**316 PASS, 179 FAIL, 603 SKIP, 2 BLOCKED, 0 ERROR**. One actual renderer failure
was fixed; another former failure now produces an untrustworthy image match,
not a verified pass. The first 100 remain **72 PASS, 26 FAIL, 2 SKIP**. No previous
pass became a failing comparison. Fixtures, selection, skip rules, and upstream
fuzzy allowances are unchanged.

The newly observed false match exposed unsupported `lh` length resolution:
`width:2lh;height:1lh;font:20px/1 Ahem` produces a 2-by-1 box instead of 40-by-20.
A scoped independent prerequisite now blocks matching tests/references that
use this unit; differing images continue to FAIL. The two blocked matches are
`discard/discard-multicol-001.html` and `line-clamp-auto-012.html` under
`css/css-overflow/line-clamp/`. This is a remaining renderer defect, not an
adapter skip. Correct `lh` sizing and the underlying multicolumn/line-clamp
behavior still need work. **38 of 39** rendering prerequisites pass.

Verification: native CSS/block/flex-basis and percentage-size suites pass; all
five registration-emitter checks and 17 harness checks pass. The simulator WASM
build succeeds. The full WPT run exits 1 because failures and blocked comparisons
remain. General intrinsic flex-basis keywords and complete flex sizing
conformance are not claimed by this change.


## Line-height-relative lengths

The renderer now parses `lh` and `rlh` through its shared length-expression
path. `lh` uses the element's computed line height; `rlh` uses the root's.
`normal` uses font line metrics. Self-references in font size and line height
use parent metrics, and root self-references use initial 16px serif metrics
rather than the root author's font. Lengths remain deferred in dimensions,
box edges, and flex bases so later font/line-height changes are reflected.

Relative line-height declarations retain expression handles across inline
replay. The cascade resolves the winning font, then the winning line height,
then dependent properties. This fixes declaration-order errors in constraints
such as `min-width:2lh`, and an inline mutation regression where the temporary
parent basis leaked into unrelated length evaluation. Native checks cover
parent/root mutations, class restoration, calc expressions, normal metrics,
root self-reference, shorthand, and absolute point-unit compatibility.

The static registration emitter also stops discarding the `font` shorthand;
its runtime parser now receives the full declaration. Six emitter checks verify
that line-height-relative lengths and shorthand metadata survive generation.

Six independent simulator probes cover ordinary `lh`, root `rlh`, normal font
metrics, parent-relative font size/line height, and the initial-font fallback
for a root self-reference. Expected rectangles are specified independently of
native layout and compared over the entire framebuffer.


The final full run reports **319 PASS, 178 FAIL, 603 SKIP, 0 BLOCKED, 0 ERROR**
with all **44** rendering prerequisites passing. The default selected all 1,100
tests. The original 100 remain **72 PASS, 26 FAIL, 2 SKIP**. No previously passing
comparison regressed.

Two former failures, `line-clamp-auto-006.html` and `line-clamp-auto-007.html`,
now match exactly: their five 32px lines fit inside correctly resolved `5lh`
and `6lh` maximum heights. These test cases require no clamping. The formerly
blocked `line-clamp-auto-012.html` also passes: a minimum height alone does not
truncate its five lines. The other formerly blocked case,
`discard/discard-multicol-001.html`, now exposes a real **177-pixel mismatch**.
Correct sizing prevents its extra text from disappearing into a false match;
multicolumn fragmentation/discard and general line clamping remain unfinished.

The native CSS/block/flex-basis, percentage-size, and style/viewport-metrics
suites pass. All six registration-emitter checks and 17 harness checks pass.
The final simulator WASM build succeeds; the complete WPT command exits 1
because 178 comparisons still fail. Fixtures, selection, skip rules, and
upstream fuzzy tolerances remain unchanged.

The next inspected failure group is backface visibility on flattened 3D
subtrees: four `composited-under-rotateY-180deg` cases paint a red child beneath
a back-facing hidden parent. The preserve-3d variant must retain its different
behavior. Their actual images and the remaining work stay in the report.

## Flattened backface visibility

The four failing `composited-under-rotateY-180deg` cases now match their pinned
references exactly, each improving from 10,000 differing pixels to zero. The
`preserve-3d` variant continues to pass. The full corpus reports **323 PASS,
174 FAIL, 603 SKIP, 0 BLOCKED, 0 ERROR**, with no PASS regressions from the
319-pass checkpoint. All **50** independent rendering prerequisites pass.

`transform-style` now travels through inline declarations, compiled rules,
cached class application, and generated stylesheet registration. The renderer
culls a back-facing flattened element together with its painted descendants;
projected text no longer independently ORs every ancestor's backface flag.
The used style accounts for supported grouping effects: scrollable overflow,
partial opacity, filters (including `blur(0px)`), paint containment, and masks.
`overflow:clip` does not itself force flattening. A child counterrotation cannot
escape a culled flat group. Facing uses the inverse-transformed plane within
the 3D context, so a 2D reflection alone does not hide its descendant group.

Retained recording applies the same visibility decision. Class/inline
visibility changes invalidate the display list, and transform reprojection
falls back to recording when a group's visibility changes. Unchanged visible
and hidden groups retain reprojection eligibility. Native tests exercise
rotation in both directions over multiple frames, counterrotation, grouping
effects, inline removal, class changes, and reprojection eligibility. The
transformed-rounded-rect and CSS/block/flex-basis suites pass, as do seven CSS
registration-emitter checks and seventeen harness checks. The existing 3D cube
application pipeline also passes, including its opaque/translucent backface
toggle and projected-label checks.

This fixes flattened backface group visibility; it does not claim complete
3D flattening, projection, depth sorting, or all transform conformance. The
optional browser check of synthetic control pages was blocked by the browser's
URL policy. Verification uses pinned WPT references, native pixel tests, and
six new simulator controls with literal expected geometry and pixels. The
selection, fixtures, skip rules, and fuzzy tolerances are unchanged.

## Absolute descendant percentage sizing

Seven `positioned-grid-descendant-containing-block` cases now match exactly:
006, 007, 008, 012, 014, 015, and 016. Their percentage dimensions were being
measured against an intervening static wrapper, even though their insets used
the positioned grid ancestor. The final absolute-positioning pass now measures
dimensions and descendants against the resolved containing area before
alignment. Span-only and nonexistent grid lines keep their existing automatic
edge resolution. This follows the sizing order in
[CSS Positioned Layout](https://drafts.csswg.org/css-position-3/#abspos-layout).

Static alignment is recalculated with the final size. A block parent's content
edge supplies its horizontal static position, including right-to-left anchoring
when the absolute child is wider than that parent. Inline parents retain their
separate positioning path. Normal block flow also resolves its horizontal
constraint using the containing parent's inherited direction, as specified by
[CSS 2.2 width calculation](https://www.w3.org/TR/CSS22/visudet.html#blockwidth).
The native regression covers
grid and block ancestors, padding, percentage insets, nested percentage content,
changes to which ancestor is positioned, centered grid alignment, and RTL margins.
The new `absolute-containing-block-size` simulator prerequisite checks literal
geometry and the entire framebuffer for grid ancestors and LTR/RTL block
ancestors, including an overflowing child with padding and a right margin.

The CSS/block/flex-basis, percentage-size, and retained absolute-subtree native
suites pass, as do all 17 harness checks. The four `descendant-static-position`
cases remain under investigation: automatic sizing around floats and vertical
static-position geometry still differ from their references. These failures
remain visible; their fixtures and tolerances have not been changed.

The parent-direction correction also fixes five `flexbox-writing-mode` cases
(004, 005, 006, slr-rtl, and srl-rtl) and
`flex-align-baseline-column-rtl-direction`. Each now matches its reference
exactly. The final full run reports **336 PASS, 161 FAIL, 603 SKIP, 0 BLOCKED,
0 ERROR**, with **51** passing independent prerequisites. Compared with the
323-pass checkpoint, 13 failures become passes and four other failures have
smaller pixel differences; no status or pixel comparison worsens. The full
command still exits 1 because 161 comparisons fail.

The next isolated grid failure at that checkpoint was `positioned-grid-items-negative-indices-003`:
its absolute box has the correct `[146,66,376,130]` geometry, but the later
in-flow grid item paints over it. This needs painting-order work, rather than
another change to grid track sizing.

### Paint order and stacking-context descendants

`positioned-grid-items-negative-indices-003` now passes with zero differing
pixels, down from 48,880. Its geometry was already correct: the absolute box
was painted below a later ordinary grid item. The renderer now orders normal
block backgrounds, floats, inline content, positioned boxes, and signed stack
levels according to the [CSS painting order](https://www.w3.org/TR/CSS22/zindex.html#painting-order).
Static flex/grid items honor non-auto z-index; ordinary static blocks ignore it.
The style pipeline preserves `z-index: auto` separately from an explicit zero,
including cached class rules and inline removal.

Painting traverses stacking contexts rather than treating every DOM subtree
as an indivisible group. Positioned descendants of ordinary wrappers join the
enclosing context, retaining the wrappers' overflow clips. Actual stacking
contexts remain grouped. Hit testing uses the same traversal, and retained
transform replay preserves its ordering, including ties after a depth crossing.
This does not finish 3D rendering-context conformance: the existing
`3d-rendering-context-and-*` failures remain failures.

The independent `paint-order` prerequisite verifies every pixel for positioned
versus ordinary grid items, floats versus block backgrounds, explicit zero on
grid items, and positioned descendants through static wrappers. Native tests
also cover negative stack levels, identity transforms, class changes, clipping,
pointer exclusion, and retained-versus-full-render equality after repeated
depth changes. The CSS/block/flex-basis, transformed-rounded-rect, retained
absolute-subtree, and CSS 3D cube app pipeline all pass, as do all 17 harness
checks and 52 independent prerequisites.

The full default run still selects **all 1,100** pinned CSS tests and reports
**337 PASS, 160 FAIL, 603 SKIP, 0 BLOCKED, 0 ERROR**. Compared with 336/161,
one failure becomes a pass, seven remaining failures have smaller pixel
differences, and no passing test regresses. One remaining failure,
`align-self-static-position-005`, increases from 2,000 to 4,000 differing pixels:
its absolute box is at `[299,9,100,20]` versus `[9,19,100,20]` in the reference,
and the positioned painting phase makes that mismatch more visible. Its inline
static-position/alignment defect remains unresolved. The first 100 remain at
81 PASS, 17 FAIL, 2 SKIP. Fixtures, skips, and tolerances are unchanged; the full
command exits 1 because 160 comparisons still fail.

### Automatic height around floats

Automatic block height now uses the same formatting-context classification as
margin collapsing. Absolute/fixed boxes, root boxes, floats, overflow containers,
and block-level flex/grid items include their floats' bottom margin edges.
Ordinary and relatively positioned blocks continue to exclude floats from their
own automatic height. This follows
[CSS 2.2 automatic heights for formatting-context roots](https://www.w3.org/TR/CSS22/visudet.html#root-height).

The final height calculation includes nested floats through ordinary wrappers,
stops at another formatting context, excludes out-of-flow descendants, and
removes relative visual offsets from the measurement. Explicit heights remain
fixed, while minimum/maximum height constraints apply to automatic enclosure.
One older native assertion expected a root height of 60px despite a nested
float extending to 76px; its expected height is now 76px, with a separate
regression covering relative offsets and nested formatting-context boundaries.

The `float-formatting-context-height` prerequisite checks nine literal rectangles
against every pixel, as well as each box's reported geometry. Native CSS,
percentage-sizing, and retained absolute-subtree suites pass, along with all
17 harness checks.

The subsequent full run selects all 1,100 tests and remains at **337 PASS,
160 FAIL, 603 SKIP, 0 BLOCKED, 0 ERROR**, with **53** independent prerequisites
passing. No WPT status changes. `clear-on-child-with-margins-2` improves from
4,200 to 4,000 differing pixels. The four `descendant-static-position` grid
cases worsen: 001 and 003 go from 2,320 to 3,008; 002 from 3,131 to 4,237;
004 from 3,131 to 4,278. Their absolute boxes now enclose the floats instead
of having zero height, making their unresolved position/width differences more
visible. These remain failures, with fixtures and tolerances unchanged. The
full command exits 1; this prerequisite correction is not counted as a newly
passing WPT test.

### Unitless line-height inheritance

Computed style now preserves the number in `line-height: 1.5` and resolves the
used pixel height after each element's final font cascade. Descendants with
different font sizes therefore scale their own line height. Pixel, percentage,
and `em` declarations continue to inherit their computed length, as required by
[CSS 2.2 line-height](https://www.w3.org/TR/CSS22/visudet.html#propdef-line-height).
Authored inline percentages also recompute when the declaring element's font
size changes before that length is inherited.

The multiplier survives string/numeric CSS APIs, font shorthand, custom
properties, generated static CSS rules, cached classes, inline overrides, and
removal. Inheritance invalidation includes the multiplier, so switching between
`1.5` and `30px` on a 20px parent still updates its descendants even though the
parent's used height is unchanged. The native integer `Property::LineHeight`
API continues to mean pixels. The multiplier uses a four-byte computed-style
field to avoid allocating a large rare-style record for every inheriting node.

Four independent Ahem controls compare literal glyph rectangles and line-box
geometry for numeric, pixel, percentage, and `em` inheritance. The native CSS
regressions additionally cover changed fonts, cached class toggles, shorthand,
custom properties, overrides/removal, generated static rules, and percentage
reevaluation after font changes.

The final full run remains **337 PASS, 160 FAIL, 603 SKIP, 0 BLOCKED, 0 ERROR**
across all 1,100 cases, with all **57** prerequisites and **17** harness checks
passing. The native CSS suite (including dynamic multiline text layout) and
viewport/style suite pass. No WPT status changes. One existing failure,
`clip-text-multiline-linebreak`, increases from 10,140 to 25,978 differing pixels:
its 100px text now inherits a 100px line height from `line-height: 1`, exposing
more of the unfinished text-background clipping/fragmentation behavior. The
full command still exits 1; no fixture, skip, or tolerance has changed.

A browser cross-check confirms that `descendant-static-position-001` and its
reference agree in browser geometry. Their remaining differences in this rig
need absolute shrink-to-fit sizing and static-position origin corrections, not
fixture changes. The inline `align-self-static-position-005` test and reference
also agree in the browser: their absolute box is `[129,39,100,20]`. The simulator
still differs in hypothetical inline position, whitespace across an out-of-flow
child, inline box bounds, and border exclusion from the containing block.


## Absolute shrink-to-fit sizing and grid static areas

Automatic horizontal absolute widths now use the existing min/max-content
measurement to shrink to the space from the resolved inset or static position
to the opposite containing-block edge. This can exceed the width of a selected
grid area when the static position starts outside that area. The final pass
preserves the containing-block basis for percentage padding and constrains the
used width with min/max-width. A grid that establishes the containing block
also uses its placement area, including padding edges for automatic lines, for
static alignment. A grid outside the containing-block chain retains its content
box as the static-position rectangle.

All four `css/css-grid/abspos/descendant-static-position-00{1,2,3,4}.html`
cases now pass with zero differing pixels (previously 3,008, 4,237, 3,008, and
4,278). The complete default run selects all **1,100** cases and reports
**341 PASS, 156 FAIL, 603 SKIP, 0 BLOCKED, 0 ERROR**. These are the only status
or pixel-count changes from the preceding run. The command exits 1 because
156 reftests still fail; fixtures, skip rules, and tolerances are unchanged.

All **58** independent rendering prerequisites and **17** harness tests pass.
The added prerequisite checks literal geometry and every framebuffer pixel for
LTR/RTL nested static positions and a positioned grid's padding-edge origin.
The native CSS suite additionally checks inset mutation, percentage padding,
and min/max-width constraints; the retained absolute-subtree suite also passes.
Viewport-fixed automatic sizing, ordinary absolute containing-block borders,
and hypothetical inline positioning remain separate work.


## Absolute containing-block borders and margins

The positioned ancestor's padding box now supplies absolute inset and percentage
bases, excluding its borders as required by
[CSS 2.2 section 10.1](https://www.w3.org/TR/CSS22/visudet.html#containing-block-details).
A shared containing-area helper is used by provisional layout, final ancestor
resolution, and retained updates. Definite insets include the corresponding
margins. A retained absolute child under a static wrapper falls back to the full
pass so the wrapper cannot replace its actual containing block.

Native CSS, percentage-layout, and retained absolute-subtree checks pass. The
retained test asserts that pixel-inset movement takes the fast path, preserves
the unchanged percentage axis, and resolves borders correctly. Its explicit
zero minimums satisfy the existing retained-path eligibility checks; CSS auto
minimums were not made eligible by weakening that guard. The new simulator
control independently checks three literal rectangles and every framebuffer
pixel for percentage sizing, start/end insets, margins, and stretching.

The full default **1,100**-test run remains **341 PASS, 156 FAIL, 603 SKIP,
0 BLOCKED, 0 ERROR**; all **59** renderer prerequisites and **17** harness tests
pass. There are no status changes. Eight existing failures change pixel counts:

| Existing failure | Before | After |
| --- | ---: | ---: |
| `slice-block-fragmentation-001` | 1,000 | 1,975 |
| `slice-block-fragmentation-002` | 1,000 | 1,975 |
| `slice-block-fragmentation-003` | 4,400 | 8,400 |
| `flex-abspos-align-self-safe-outer-cb-001` | 26,622 | 23,384 |
| `flex-abspos-align-self-safe-outer-cb-002` | 30,492 | 23,384 |
| `grid-abspos-staticpos-align-self-safe-outer-cb-001` | 3,430 | 3,478 |
| `grid-abspos-staticpos-align-self-safe-outer-cb-003` | 890 | 410 |
| `floats-wrap-bfc-with-margin-010` | 15,850 | 11,125 |

The three fragmented-shadow references now honor their 120px/240px absolute
margins; their actual multicolumn content remains unfragmented. The increased
grid alignment difference follows corrected border exclusion in its explicit
reference offsets; the actual still has incorrect vertical block flow and safe
static alignment. These remain failures, with unchanged fixtures, skips, and
tolerances. The full command exits 1. Initial-containing-block and hypothetical
inline-position behavior still need further work.


## Vertical block flow

Block children now stack along the writing mode's block axis. Vertical and
sideways modes resolve sibling and descendant margins on their horizontal
block edges, compute automatic block width from that flow, and position reverse
flow after the final width is known. Inline height filling, automatic margins,
and direction use the corresponding vertical axis. A writing-mode boundary
establishes a formatting context, preventing inappropriate margin collapse.
These mappings follow [CSS Writing Modes, abstract box layout](https://www.w3.org/TR/css-writing-modes-3/#abstract-layout).

Native CSS regressions cover all four vertical/sideways modes in both text
directions, automatic width mutation, inline auto margins, and inline stretching.
The independent simulator control verifies 16 literal rectangles and every pixel.
Native CSS, percentage-layout, retained absolute-subtree, all **60** renderer
prerequisites, and all **17** harness tests pass.

The complete default run remains **341 PASS, 156 FAIL, 603 SKIP, 0 BLOCKED,
0 ERROR** across all **1,100** tests. No status changes. Pixel-count changes are:

| Existing failure | Before | After |
| --- | ---: | ---: |
| `grid-abspos-staticpos-align-self-safe-outer-cb-001.tentative` | 3,478 | 1,116 |
| `position-absolute-in-inline-008a` | 44,600 | 52,920 |
| `position-absolute-in-inline-008b` | 72,900 | 78,720 |
| `position-absolute-in-inline-010` | 74,300 | 60,590 |
| `position-absolute-in-inline-012` | 44,600 | 52,920 |

The inline-position cases still depend on logical size declarations, vertical
inline text, multicolumn fragmentation, and correct root writing-mode placement;
those features remain incomplete. They stay failures, and no fixture, skip rule,
or tolerance was changed. The full command exits 1.

A browser audit confirms that the tentative safe-outer-containing-block grid
reference is valid: test and reference both place their absolute children at
`[166,11,45,35]` and `[11,58,45,35]`. The first grid itself is now correctly
positioned at `[172,11,34,31]`. The remaining alignment correction needs to
resolve automatic insets from the static alignment point and the actual
containing block before applying overflow safety. For example, the horizontal
center anchor is y=67.5 inside a containing block spanning y=52..77, producing
an inset-modified interval y=58..77. The current engine only aligns against the
static parent's rectangle. See
[CSS Position, resolving auto insets](https://drafts.csswg.org/css-position-3/#resolving-insets).

## Absolute automatic-inset alignment

Absolute descendants of grid and flex containers now resolve automatic insets
from their static alignment point and their actual containing block before
applying overflow safety. Center alignment uses the symmetric interval bounded
by the nearer containing-block edge. Explicit safe alignment falls back to the
logical start of that interval; unsafe alignment preserves overflow. Flex axes
follow writing mode and reversal, and default main-axis alignment keeps the
start margin edge reachable in the actual containing block.

The shared alignment helper serves final layout and eligible retained updates.
Baseline fallback keeps its existing specified edge; definite insets still take
precedence. Native regression cases cover horizontal and vertical grids,
safe/unsafe mutations, definite insets, and overflowing vertical flex children
with and without margins. A separate simulator prerequisite checks four literal
rectangles and every framebuffer pixel. Viewport-fixed automatic-inset
alignment and alignment-dependent automatic sizing remain further work.

Unqualified grid self-alignment retains the browser's unsafe overflow fallback.
The full run caught a partial default-safety implementation moving eight
previously passing grid cases. Browser test/reference measurements confirmed
that the center and end offsets should remain 0px and -2px for a 6px child in
the small 2px grid track. A native mutation regression now distinguishes those
defaults from explicit `safe center` (2px). Smart default overflow safety remains
unimplemented for grid; [CSS Align's compatibility fallback](https://drafts.csswg.org/css-align-3/#auto-safety-default)
permits unsafe behavior where that mechanism is not implemented.
Flex default cross-axis alignment retains its containing-block overflow limit,
which the browser and the safe-outer-containing-block references require. A
separate native assertion covers this distinction.

The final complete default run selects **all 1,100 tests** and reports
**350 PASS, 147 FAIL, 603 SKIP, 0 BLOCKED, 0 ERROR**. Nine former failures now
match their references with zero differing pixels, with no new failures:

| Test filename (under its existing CSS area) | Previous differing pixels |
| --- | ---: |
| `flex-abspos-align-self-safe-outer-cb-001.tentative.html` | 23,384 |
| `flex-abspos-align-self-safe-outer-cb-002.tentative.html` | 23,384 |
| `flex-abspos-staticpos-justify-self-001.html` | 1,568 |
| `flex-abspos-staticpos-margin-001.html` | 1,120 |
| `flex-abspos-staticpos-margin-002.html` | 1,168 |
| `flex-abspos-staticpos-margin-003.html` | 1,220 |
| `grid-abspos-staticpos-align-self-safe-outer-cb-001.tentative.html` | 1,116 |
| `grid-abspos-staticpos-align-self-safe-outer-cb-003.tentative.html` | 410 |
| `position-absolute-containing-block-002.html` | 3,800 |

The only other pixel-count change is the still-failing
`flex-abspos-staticpos-fallback-justify-content-001.html`, improving from 840 to
728 differing pixels. All **61** independent renderer prerequisites, **17**
harness checks, and the native CSS and retained absolute-subtree suites pass.
The full command exits 1 because 147 reftests remain failures. Fixtures, skips,
and pixel tolerances are unchanged. The first 100 remain 81 PASS, 17 FAIL, 2 SKIP.

## Orthogonal automatic inline sizing

Intrinsic measurement now handles either physical axis. A normal-flow box whose
writing mode is perpendicular to its containing block measures its automatic
inline size as fit-content, following
[CSS Writing Modes 7.3.2](https://www.w3.org/TR/css-writing-modes-3/#orthogonal-auto).
Min/max-content probes preserve the authored style and suppress cyclic
percentages. The final used inline size becomes a fixed layout constraint,
allowing percentage gaps to resolve before flex line formation. Min/max size
constraints apply to that final size. Flex and grid items retain their parent
layout algorithms' automatic sizing.

The regression that exposed this was `flexbox-column-row-gap-004.html`: its
vertical row container should measure a 100px inline content size, then resolve
a 10px column gap. Two 50px items consequently occupy separate lines. Previously
the engine kept the gap at zero and stacked both items in one column.

Native tests cover both orthogonal directions, zero-gap and explicit-size
mutations, restoring auto size, and minimum/maximum constraints. A separate
simulator prerequisite checks twelve literal boxes and every framebuffer pixel.

The final full default run selects **all 1,100 tests** and reports
**351 PASS, 146 FAIL, 603 SKIP, 0 BLOCKED, 0 ERROR**. The percentage-gap case
improves from 5,500 differing pixels to zero; every other test keeps the same
status and pixel count. The first 100 now report 82 PASS, 16 FAIL, 2 SKIP.
All **62** renderer prerequisites, **17** harness checks, and native CSS,
percentage-layout, and retained absolute-subtree suites pass. The full command
exits 1 because the remaining 146 failures are still unresolved. No fixtures,
skip rules, or tolerances changed.

## Absolute distributed alignment and clearing line breaks

An absolutely positioned flex child now uses the single hypothetical item's
main-axis fallback: `space-between` starts it at flex-start, while `space-around`
and `space-evenly` center it, including when its static rectangle overflows.
The shared helper accounts for reversed flex direction, RTL, and writing mode.
See [CSS Flexbox, absolutely positioned children](https://www.w3.org/TR/css-flexbox-1/#abspos-items).

Anonymous collapsed whitespace adjacent to a `br` no longer creates a line,
including when hidden DOM nodes separate whitespace runs. In the float layout
path, a clearing inline `br` remains beside the floats on the current line and
advances the next line below their margin edges. It no longer moves itself
below the floats and then adds an extra line height.

The browser audit of `flex-abspos-staticpos-fallback-justify-content-001` confirms
that test and reference agree on the centered offsets and on the next row's
position despite hidden wrappers. Native regressions exercise all four flex
directions in both text directions and horizontal/vertical writing, oversized
absolute children, clearing breaks, hidden whitespace, and float-height
mutation. Two independent simulator controls check literal geometry and every
pixel with explicit line heights, avoiding dependence on platform font metrics.

The full default **1,100**-test run now reports **353 PASS, 144 FAIL, 603 SKIP,
0 BLOCKED, 0 ERROR**. Two former failures match with zero differing pixels:
`flex-abspos-staticpos-fallback-justify-content-001.html` (previously 728) and
`line-clamp-037.html` (previously 25,088). Every other status and pixel count is
unchanged. The latter verifies that whitespace and an empty span after the
fifth line create no phantom sixth line; it does not establish general
line-clamp support, which remains unimplemented.

All **64** independent renderer prerequisites, **17** harness checks, and native
CSS and retained absolute-subtree suites pass. The first 100 remain 82 PASS,
16 FAIL, 2 SKIP. The full command exits 1 because 144 failures remain. Fixtures,
skip rules, and tolerances are unchanged.


### Visibility and collapsed flex items

The shared renderer now parses and inherits `visibility: visible | hidden |
collapse`. Hidden boxes retain their layout space but omit their own paint and
hit targets. Explicitly visible descendants still paint and receive input,
including positioned descendants hoisted into an ancestor's paint order.
Class and inline changes propagate inherited visibility and invalidate the
retained display list. Outside flex layout, collapse behaves like hidden.

For flex items, the implementation follows
[Flexbox 9.4](https://www.w3.org/TR/css-flexbox-1/#algo-visibility): measure the
original lines, including line stretching, remember each collapsed item's
line cross size, and redo layout with zero-main-size struts. Struts retain their
place while lines are formed; subsequent sizing and alignment use only the
surviving items. Collapsed items contribute no gaps, margins, grow/shrink
factors, auto margins or baseline alignment to that second pass. A collapsed
flex subtree is excluded from painting and hit testing even when a descendant
explicitly requests visibility.

Native regressions cover inherited class styles, visible descendants, positioned
paint-order hoisting, invalid declarations, declaration/class removal, repeated
visibility changes, row/column intrinsic sizing, gaps at the start/middle/end,
strut migration after line stretching, and input exclusion. The independent
`visibility-and-flex-collapse` simulator prerequisite checks seven literal
boxes and every framebuffer pixel, including an all-collapsed container and a
visible item stretched to the collapsed item's cross size.

The full default **1,100**-test run reports **357 PASS, 140 FAIL, 603 SKIP,
0 BLOCKED, 0 ERROR**. Four former failures now match with zero differing pixels:

| WPT | Previously differing pixels |
| --- | ---: |
| `flexbox-collapsed-item-horiz-001.html` | 11,440 |
| `flexbox-collapsed-item-horiz-002.html` | 7,595 |
| `flexbox-collapsed-item-horiz-003.html` | 600 |
| `gap-collapse.html` | 15,000 |

Every other status and differing-pixel count is unchanged. All **65** independent
renderer prerequisites, **17** harness checks, and native CSS and retained
absolute-subtree suites pass. The first 100 report 86 PASS, 12 FAIL, 2 SKIP.
The full command exits 1 because 140 failures remain. Fixtures, skip rules,
and visual tolerances are unchanged; the default report still includes all tests.


### Computed border-width inheritance and side overrides

`border-width: inherit` and the four individual border-width longhands now copy
the parent's resolved widths. A child's larger font does not re-evaluate the
parent's `em` value. The authored inheritance marker survives inline replay;
parent border mutations and class changes trigger descendant style updates.
This follows [CSS inheritance of computed values](https://www.w3.org/TR/CSS22/cascade.html#value-def-inherit).

Border writes now share one implementation across ordinary and cached styles.
A narrower or zero-width side can override a wider uniform border: the other
edges retain their widths. A later shorthand resets all earlier side overrides,
and removing an inline side declaration restores the remaining cascade.
The cached-operation write masks account for all four edges of a shorthand.

Native coverage verifies class and inline inheritance, differing font sizes,
asymmetric parents, parent class and direct-property mutations, narrower/zero
side overrides, invalid mixed-inherit values, shorthand replacement, removal,
and repeated cached class applications. The `computed-border-inheritance`
prerequisite checks six literal boxes and all framebuffer pixels against border
rings specified independently of CSS rendering.

The full default **1,100**-test run reports **358 PASS, 139 FAIL, 603 SKIP,
0 BLOCKED, 0 ERROR**. `CSS2/cascade/inherit-computed-002.html` now matches with
zero differing pixels (previously 56,685). Every other status and differing-pixel
count is unchanged. All **66** independent renderer prerequisites, **17** harness
checks, and native CSS and retained absolute-subtree suites pass. The first 100
remain 86 PASS, 12 FAIL, 2 SKIP. The full command exits 1 because 139 failures
remain. Upstream files, skip rules, tolerances, and the all-tests default are
unchanged.

### Shared float contexts and nested clearance

Float exclusions now span ordinary wrappers within the same block formatting
context. Earlier nested floats affect later siblings and clearing descendants;
floats inside independent contexts remain isolated. Context coordinates exclude
relative-position offsets. Subtrees whose geometry depends on preceding floats
invalidate their size-only layout memo entries.

Clearance is recorded from the hypothetical collapsed-margin position. A
descendant that actually needs clearance separates adjoining margins, and its
wrapper is then placed again with that separation retained. Provisional floats
are discarded before the subtree is placed again. Margin collection stops at
actual clearance, including across empty preceding siblings. This also handles
negative clearance, using the border-to-float-bottom alignment permitted by
[CSS 2.2](https://www.w3.org/TR/CSS22/visuren.html#flow-control). New formatting
contexts avoid surrounding floats when their width cannot fit between them.
Their automatic widths fill the available interval between float margin boxes;
negative margins cannot cross those exclusions, including zero-width floats.

Repeated layout exposed an automatic-height flex-column defect: `min-height`
was being used as a wrapping limit. Regular, balanced, and collapsed-item line
packing now share the same available-main-size rule. An automatic block main
size grows with content unless a maximum or an assigned size constrains it.
`max-width: none` and `max-height: none` also preserve the unbounded value in
ordinary and compiled/cached style paths, rather than resolving to zero.

Native tests cover nested float placement, side-specific clearance, actual vs.
unnecessary clearance, descendant margin separation, negative clearance, float
height mutation, independent formatting contexts, float avoidance, automatic
flex-column wrapping, and cached/inline maximum removal. The
`nested-float-clearance` prerequisite checks twenty-two literal boxes and every
framebuffer pixel independently of CSS reference rendering.

The complete default **1,100**-test run reports **371 PASS, 126 FAIL, 603 SKIP,
0 BLOCKED, 0 ERROR**. Eleven former failures now match with zero differing pixels:

| WPT | Previously differing pixels |
| --- | ---: |
| `floats-clear/adjoining-float-nested-forced-clearance-002.html` | 1,000 |
| `floats-clear/clear-after-top-margin.html` | 9,000 |
| `floats-clear/clear-on-child-with-margins-2.html` | 200 |
| `floats-clear/clear-on-child-with-margins.html` | 2,500 |
| `floats-clear/negative-clearance-after-bottom-margin.html` | 2,550 |
| `floats-clear/no-clearance-adjoining-opposite-float.html` | 117,600 |
| `floats-clear/second-float-inside-empty-cleared-block-after-margin.html` | 2,900 |
| `floats-clear/second-float-inside-empty-cleared-block.html` | 4,900 |
| `floats/floats-wrap-bfc-with-margin-010.html` | 11,125 |
| `floats/overhanging-float-paint-order.html` | 8,800 |
| `floats/zero-width-floats-positioning.tentative.html` | 3,300 |

Paths in this table are under `css/CSS2/`. Every previously passing test still
passes. Five existing failures have smaller differences; four have larger ones:
two last-baseline grid comparisons change from 112 to 160 pixels as floats that
previously overlapped now sit alongside one another, and two multicolumn tests
change from 9,900 to 10,710 and 10,500 to 11,850 pixels. All four remain failures;
column fragmentation and the grid baseline mismatches remain unresolved.
Other statuses and pixel counts are unchanged.

All **68** independent rendering prerequisites, **17** harness checks, and native
CSS and retained absolute-subtree suites pass. The first 100 remain 86 PASS,
12 FAIL, 2 SKIP. The full command exits 1 because 126 failures remain. The five
remaining `floats-clear` failures require multicolumn fragmentation or block
content inside inline wrappers. Upstream fixtures, skip rules, tolerances, and
the all-tests default are unchanged.


### Block content inside inline wrappers

Undecorated inline ancestors containing in-flow blocks now contribute their
children to the enclosing formatting context, following the
[CSS anonymous block model](https://www.w3.org/TR/CSS22/visuren.html#anonymous-block-level).
This preserves DOM ancestry while allowing block margins to collapse across
separate inline wrappers. Inline vertical margins do not move those blocks or
inflate scroll extents. Relative offsets on a split inline ancestor still move
its descendants.

Contiguous inline content before and after blocks forms anonymous line groups.
Those groups use native inline layout, including wrapping, collapsed whitespace,
float exclusions, and forced breaks. A BR terminates its current line rather
than adding a second empty line; a clearing BR moves the next line below matching
floats. Mixed content also measures intrinsic width before assigning its final
containing width, preserving shrink-to-fit sizing.

Native checks cover margin mutation, DOM ancestry, hit testing, scroll extents,
relative positioning, text around blocks, BR clearance, and shrink-to-fit sizes.
The `block-in-inline-formatting` prerequisite checks twenty-six literal boxes
and every framebuffer pixel, independently of reference rendering.

This is partial inline fragmentation support. Decorated inline fragments and
positioned descendants still need fragment geometry. Floats embedded between
inline text runs and changing float exclusions across multiple lines remain
incomplete. In particular, the existing `float-nowrap-3`, `-4`, `-7`, and `-9`
failures have larger differences after intrinsic sizing: 2,488→3,954,
2,126→3,956, 2,523→5,476, and 3,510→4,830 pixels. Their inline wrappers still
incorrectly supply float placement widths and interrupt the text line.

The BR correction also makes the test and reference for
`normal-flow/block-in-inline-first-line-001.html` identical. This is **not a
conformance pass**: both sides omit their `::first-line` background. A new
`first-line-background` prerequisite checks the missing 400-pixel background
between Ahem glyphs. It fails, so matching comparisons that depend on
`:first-line` or `::first-line` are BLOCKED. Other selectors remain unaffected;
unequal comparisons still FAIL. This dependency rule applies to both tests and
references and is covered by a harness regression test.


The final default **1,100**-test run reports **384 PASS, 112 FAIL, 603 SKIP,
1 BLOCKED, 0 ERROR**. Thirteen former failures now pass:

- `CSS2/box-display/block-in-inline-large-margin-bottom.html`
- `CSS2/box-display/block-in-inline-margin-with-leading-and-trailing-text.html`
- `CSS2/box-display/block-in-inline-margin-with-leading-text.html`
- `CSS2/box-display/block-in-inline-margin-with-multi-line-text-before.html`
- `CSS2/box-display/block-in-inline-margins-collapse-with-trailing-block.html`
- `CSS2/box-display/block-in-inline-self-collapsing-only-child.html`
- `CSS2/box-display/block-in-inline-vertical-margins-on-span-ignored.html`
- `CSS2/box-display/block-in-inlines-in-different-spans-margin-collapse.html`
- `CSS2/box-display/inline-text-after-block-in-inline-with-intervening-float.html`
- `CSS2/box-display/three-block-in-inlines-cascading-margins.html`
- `CSS2/floats-clear/adjoining-float-nested-forced-clearance-004.html`
- `CSS2/normal-flow/block-in-inline-after-block-in-inline-with-margin-collapse.html`
- `CSS2/normal-flow/block-in-inline-align-justify-001.html`

Every previously passing test still passes. Eleven existing failures have smaller
pixel differences, four have larger ones as detailed above, and one former
failure is now BLOCKED because equal images omit required first-line styling.
All **18** harness checks, **69 of 70** rendering prerequisites, and native CSS
and retained absolute-subtree suites pass. The first 100 remain 86 PASS,
12 FAIL, 2 SKIP. The full command exits **1** because failures and the scoped
prerequisite defect remain. Upstream files, tolerances, skip rules, and the
all-tests default are unchanged.


### Block static positions for automatic absolute insets

Absolutely and fixed-positioned block boxes now retain their hypothetical
block-start position after preceding in-flow siblings. The anchor includes the
preceding collapsed margin and the parent's content inset, but excludes relative
translations and intervening out-of-flow boxes. It is captured in parent-relative
coordinates before layout becomes absolute, so retained movement and resize can
reuse it. The final offset adds the absolute box's own margin and uses the
correct block direction in horizontal, vertical-lr, and vertical-rl layout.
Automatic inline positions also honor content padding in vertical writing modes.
This follows the [static-position model](https://www.w3.org/TR/css-position-3/#staticpos-rect);
inline fragment anchors remain separate unfinished work.

Native tests cover preceding-margin mutation, hidden siblings, vertical block
directions, relative translations, explicit-inset replacement and removal,
retained movement and resize, and preceding-sibling resize. The retained test
asserts that the fast path actually ran and that old painted pixels disappear.
The `absolute-block-static-position` prerequisite checks seven literal rectangles
and all framebuffer pixels, including fixed positioning and a static wrapper
whose containing block is an outer ancestor.


A transform failure exposed by the corrected static anchor used
`transform-origin: 0 0`. The origin parser previously accepted percentages and
keywords but sent zero lengths to the default center. Valid literal zero lengths
now resolve to the start edge through the shared origin parser, including
transform and perspective origins. Native checks cover compiled class rules,
inline custom-property resolution, and removing an override. The
`zero-transform-origin` prerequisite checks five independent painted rectangles
for unitless, pixel, font-relative, percentage, and center origins. General
nonzero length origins still require length-aware origin storage and resolution.


The complete default **1,100**-test run reports **388 PASS, 108 FAIL, 603 SKIP,
1 BLOCKED, 0 ERROR**. Four former failures now match with zero differing pixels:

| WPT | Previously differing pixels |
| --- | ---: |
| `css/css-flexbox/align-items-006.html` | 16,000 |
| `css/css-transforms/css-transform-scale-002.html` | 21,228 |
| `css/css-transforms/fractional-scale-gradient-bg-obscure-red-bg.html` | 615 |
| `css/CSS2/floats/negative-block-margin-pushing-float-out-of-block-formatting-context.html` | 2,500 |

Every previously passing test still passes. Five existing transform failures have
smaller pixel differences. `individual-transform-2e.html` increases from 16,173
to 16,465 pixels: the corrected zero origin changes geometry, while composition
of the individual `translate` property with the transform list remains broken.
Other statuses and pixel counts are unchanged. All **18** harness checks,
**71 of 72** rendering prerequisites, and native CSS, transformed painting,
and retained absolute-subtree suites pass. The remaining failed prerequisite is
`first-line-background`; it continues to block the shared false match. The first
100 remain 86 PASS, 12 FAIL, 2 SKIP. The full run exits **1** because 108 failures
and that scoped prerequisite defect remain. Upstream fixtures, tolerances,
skip rules, and the all-tests default are unchanged.


## Independent translation and transform composition

The individual `translate` property now retains its own x/y/z lengths and x/y
percentages, independent of `transform`. Its offset applies outside rotation and
scale, and percentages use the element's own untransformed border box. `none`
and identity translations retain their different containing-block behavior.
Compiled declarations, cached class rules, inline declarations, removal, and
translation keyframes use the independent fields.

Transform-list translation also retains whether each translated axis precedes
the rotation group. Leading translations stay outside rotation; trailing ones
rotate with the local axes. Current and previous-frame projection use the same
composition, including the inverse-transpose calculation for backface visibility.
The order follows the [CSS transformation model](https://www.w3.org/TR/css-transforms-2/#ctm).

A new independent `individual-translate` prerequisite checks nine literal painted
rectangles and every framebuffer pixel. It exercises declaration order, rotation,
scale, own-box percentages, `none`, identity fixed containing blocks, and both
orders of list translation and rotation. It initially caught a shared error in
both sides of otherwise matching WPT images; those matches were blocked until
the independent oracle passed.

Native checks cover inline removal, percentage resize, custom properties, hit
testing, old-pixel clearing, changing transform order, animation interpolation,
and fixed descendants. Geometry dirt now remains distinguishable from transform
dirt, so simultaneous geometry and transform changes cannot skip layout when the
node is ineligible for retained position updates. Transform changes still request
layout when fixed descendants may depend on their containing block.

The complete default run reports **392 PASS, 104 FAIL, 603 SKIP, 1 BLOCKED,
0 ERROR**. `individual-transform-2a`, `2b`, `2d`, and `2e` change from FAIL to
PASS with zero differing pixels. Every previously passing case still passes.
`individual-transform-1` improves from 15,000 to 4,000 differing pixels, and `2c`
from 16,149 to 15,659. Other statuses and differences remain unchanged.
All 18 harness checks and 72 of 73 rendering prerequisites pass; the remaining
`first-line-background` prerequisite still blocks its shared false match.
Native CSS, transformed painting, retained absolute-subtree, and animation
priming checks pass. The report still exits 1 because failures remain.

This does not establish general transform-list conformance: repeated/interleaved
transform functions and arbitrary matrix composition remain unfinished, as do
independent `rotate` and `scale` storage. The latter still explains `2c`.
Percentage-containing expressions in individual `translate` are deliberately
unsupported until expression evaluation can preserve the element's own reference
box; evaluating them against the containing block would be incorrect. Bare
percentages are supported. Upstream fixtures, tolerances, skips, and the default
selection of all imported tests are unchanged.

## Independent rotation and scaling

Individual `rotate` and `scale` now have their own fields, so declaring either
before or after `transform` produces the same composition. Rotation accepts
axis keywords and vectors; scaling retains three separate signed axes and
percentage values. Current and previous-frame transform caches compose the
individual properties with the transform list into one affine map. Hit testing,
backface visibility, and clearing old paint use that map too.

Static CSS registration and generated numeric style updates use the same
independent representation. Rotation keyframes keep the axis and angle coupled:
different axes use spherical interpolation, while common-axis turns preserve
the authored angle and identity endpoints adopt the other endpoint's axis.
This follows the [rotation interpolation rules](https://www.w3.org/TR/css-transforms-2/#interpolation-of-transform-functions).

The `individual-rotate-scale` prerequisite checks every framebuffer pixel against
seven literal rectangles and a hidden backface. Native checks additionally cover
inline removal, class restoration, numeric generated-style helpers, reflected
paint removal, same-axis full turns, differing-axis animation midpoints, and
three-axis scale animation through zero. Static CSS generation and the three
focused template/mounted-codegen checks pass.

The full 1,100-case report is **393 PASS, 103 FAIL, 603 SKIP, 1 BLOCKED,
0 ERROR**. `individual-transform-2c` now passes with zero differing pixels.
All previous passes remain passes. The still-failing `individual-transform-1`
changes from 4,000 to 8,000 differing pixels: its individual rotations now work,
but its reference still uses unsupported `rotate3d()` and `scale3d()` functions.
This is not counted as a conformance pass. General transform-list ordering,
repeated functions, matrix functions, and perspective functions remain work to do.

All 18 harness checks and 73 of 74 rendering prerequisites pass. The existing
`first-line-background` defect still blocks one shared false match. Native CSS,
transformed painting, retained subtree, and animation checks pass. The full WPT
command still exits 1 because genuine failures remain; it selects every imported
test by default.


## Canvas background image placement and wide gradients

The renderer now positions and sizes document background gradients against the
root box while repeating them over the canvas, including its margin area. A
propagated body image uses the root's geometry. Per-layer size, position, repeat,
attachment and origin declarations reach the shared runtime; fixed attachment
uses the viewport positioning area. One-value `background-size` preserves its
implicit `auto` height, and static CSS generation retains complete layer lists.
This follows the [root background rules](https://www.w3.org/TR/css-backgrounds-3/#root-background).

The WPT references also exposed an initial-containing-block error: absolute
`top: 0; bottom: 0` descendants of an unpositioned HTML root were sized against
the root's short content box. They now use the viewport; a positioned or
transformed root still establishes its own containing block, including an
identity transform.

Linear and radial gradient scanlines previously stopped at the embedded display
buffer width when rendering a wider viewport. They now process the complete row
in bounded chunks. Cached bitmap rows cover the complete span too, and the
opaque gradient cache includes image geometry in its key.

Five tests change from FAIL to PASS, each with zero differing pixels:

- `background-attachment-margin-root-001`
- `background-attachment-margin-root-002`
- `background-margin-root`
- `background-margin-transformed-root`
- `background-margin-will-change-root`

The full report is **398 PASS, 98 FAIL, 603 SKIP, 1 BLOCKED, 0 ERROR**.
All other statuses and measured pixel differences match the previous complete
run. No fixture, tolerance, skip rule, or default selection was changed.
The command still exits 1 because failures remain.

The new canvas image prerequisite checks literal black/white bands across an
800-pixel viewport, using a 700-pixel image tile and separate layer placement.
Native regression checks cover propagation, percentage sizing, placement
mutation, image removal, viewport containment and identity-transform containment.
Wide linear/radial gradients are checked through repeated direct/cache replays,
including transparency and changed geometry. Native CSS, transformed painting,
and retained absolute-subtree checks pass, as do all 18 harness checks, eight
background/codegen checks, static CSS codegen and the focused template check.
74 of 75 rendering prerequisites pass; `first-line-background` remains failing
and blocks one shared false match.

Remaining background work includes general transformed image placement, rounded
clipping of positioned/repeated images, shorthand placement syntax, three/four
value positions, percentage expressions, and fractional `round` tiling. These
five passes do not establish conformance for those cases or skipped image tests.


## Block margin trimming

`margin-trim` now reaches the shared style parser and block formatting context.
Logical block-start/end trimming removes entire adjoining collapsed margin
groups, including descendants and empty siblings, while preserving the
container's own margins and the spacing between non-empty siblings. Computed
child margins remain intact; trimming affects their contribution to layout.
Logical edges follow vertical and sideways writing modes too. This implements
the [block-container trimming rules](https://www.w3.org/TR/css-box-4/#margin-trim-block).

Seven cases now pass with zero differing pixels: `block-container-block-001/002`,
`block-container-block-start-001/002`, `block-container-block-end-001/002`, and
`block-container-non-adjoining-item`. The complete run is **405 PASS, 91 FAIL,
603 SKIP, 1 BLOCKED, 0 ERROR**. Every other status and measured pixel difference
matches the preceding full run. All 1,100 cases remain selected by default;
fixtures, tolerances, and skip rules are unchanged.

The new independent `block-margin-trim` prerequisite checks literal container
geometry and red/blue/black pixel regions for padded, nested and vertical blocks.
Native checks additionally cover positive/negative margins, collapsing empty
siblings, unchanged computed margins, class removal/restoration, inline style
removal, invalid values, and all four vertical/sideways modes. The native CSS and
retained absolute-subtree checks, plugin build/architecture gate, focused generated
style check and static CSS generation pass. 75 of 76 rendering prerequisites
pass; the existing `first-line-background` defect still blocks one comparison.
The full runner exits 1 because unresolved failures remain.

Margin trimming in flex and grid layout remains unfinished, as does the adapter
coverage needed for the 33 skipped margin-trim fixtures. Accepting the property's
logical-edge grammar does not establish conformance for those layout modes.


## Unbreakable text and manual hover scaling

Normal wrapping now preserves unbreakable words. A line whose first word cannot
fit beside a float advances below the float, and a forced line break recomputes
the float exclusions. Inline text consistently uses its line's baseline, even
when it is the only run. The independent `unbreakable-text-and-floats` probe and
native text/float checks cover leading whitespace, explicit breaks, overflow,
float-height changes, and exact glyph placement.

Four upstream failures became exact matches: `float-no-content-beside-001`,
`line-clamp-038`, `vertical-align-nested-top-001`, and
`block-in-inline-first-line-002`. The intermediate full run was 409 PASS / 87 FAIL.
No passing test regressed. Fourteen other measured differences changed; several
existing failures grew, notably absolute positioning in split inline boxes and
negative-leading vertical alignment. Those remain unresolved; multi-line float
exclusions and embedded floats in inline runs also need further work.

`css-transform-scale-001-manual.html` requires hovering over `.greenSquare`.
Previously the rig captured the initial state, and the shared engine did not
match `:hover`. `interactions.mjs` now records the prescribed hover; the renderer
moves a pointer to the target's center, verifies the hit node, refreshes through
the shared input/cascade/render pipeline, and records the action and coordinates
in JSON and HTML. Upstream CSS, references, and tolerances remain unchanged.

The engine now matches hovered elements and ancestors, including compiled
selector plans. Hover-dependent matches cannot reuse class-only cache results;
changing the hovered node recomputes affected cascade state. The simulator sends
mouse movement/exit to the same API. Touch dragging retains its existing path.
Four independent pixel probes check initial, entered, sibling, and exited states;
native tests also exercise ancestor selectors, transformed hit testing, target
removal, and tree reset. This adds explicit mouse hover; it does not claim full
pointer-event or automatic stationary-pointer retargeting conformance.

The manual scale test now passes with **zero differing pixels**. The full run
reports **410 PASS, 86 FAIL, 603 SKIP, 1 BLOCKED, 0 ERROR** across all 1,100 tests.
Compared with the 409/87 intermediate run, only this test changes status or pixel
difference. 80 of 81 independent prerequisites pass; `first-line-background`
still fails at 400 pixels and blocks one comparison. The full runner exits 1.
Native CSS, retained absolute-subtree, inline-text, wrapped-text, static CSS
codegen, 19 adapter/font checks, the simulator runtime tests, TypeScript, and the
web entrypoint syntax check pass. No ESP32 hardware or full app rebuild was run.


## Rotation functions and source order

`rotate3d()` now normalizes arbitrary finite direction vectors and composes with
other rotation functions in CSS source order. A zero direction vector leaves the
rotation unchanged. The shared CSS parser accumulates the rotation matrix and
converts it to the renderer's existing Rx/Ry/Rz representation. Repeated axes
compose too. Canonical axis sequences retain authored turns for existing
animation tracks; only values beyond signed 16-bit angle storage are reduced to
an equivalent rotation before narrowing. The animation-priming regression caught
lost full turns during implementation and passes after this correction.

Static code generation delegates multiple-rotation declarations to the shared
CSS parser, avoiding an independent matrix decomposition in JavaScript. The
native tests cover class and inline declarations, normalized/negative/zero/large
axes, reversed and repeated rotations, edge-on geometry, overflow of composed
angle storage, removal/repaint, and hit testing. The independent
`rotation-list-composition` probe checks eight literal projected rectangles.

Seven upstream tests now match exactly: the six positive/negative X/Y/Z
`css-transform-3d-rotate3d-*` cases and `css-rotate-2d-3d-001`. The complete final
rotation baseline is **417 PASS, 79 FAIL, 603 SKIP, 1 BLOCKED, 0 ERROR** across all
1,100 imported tests. No passing test regressed. The only other pixel change is
`individual-transform-1`, still failing but reduced from 8,000 to 4,000 pixels.
81 of 82 independent prerequisites pass; `first-line-background` still fails.
Native CSS geometry, transformed rounded rendering, animation priming, static
CSS generation, and all 19 adapter/font checks pass. The full runner exits 1.

General transform-list composition with interleaved translations/nonuniform
scales, perspective functions, matrix functions, and full transform-list
animation interpolation remain unfinished. Rotation angles retain the existing
one-tenth-degree precision and signed 16-bit storage limits. These fixes do not
establish conformance for those cases or the remaining 3D-context failures.

## First-line backgrounds, inline static positions, and 3D contexts

The renderer now resolves `::first-line` background colors through both cached
and uncached stylesheet plans. Layout records the actual first formatted line's
text fragments, including propagation through the first in-flow block child.
Painting uses the fragment's line height and transform, and retained updates
invalidate stale backgrounds when classes change. Leading and trailing
collapsible whitespace are excluded from the painted fragment; a space between
inline runs remains part of the line. This implements background painting, not
the full set of properties applicable to `::first-line`.

Inline absolutely positioned boxes now take their static position from their
source-order location in the line. A BR or wrapped text continuation moves that
anchor to the next line's origin, including inside a padded inline ancestor.
Leading whitespace in nested inline boxes is trimmed at a definite line
boundary while preserving separators after preceding inline content.

Depth sorting is restricted to participating members of a shared 3D rendering
context. An intervening flat parent prevents positioned descendants from being
hoisted into its ancestor's depth sort. Transform eligibility is shared by
painting, containing-block selection, and retained geometry: ordinary
non-replaced inline boxes ignore transforms, while replaced and blockified boxes
can use them. `preserve-3d` also establishes the containing block for fixed
descendants without requiring an additional transform declaration.

Independent literal-pixel probes cover cached first-line siblings, whitespace,
transformed owners, fixed-height owners, later inline content, first block
children, wrapped runs, and three 3D-context scenes. These checks do not use a
second renderer output as their expected image. Native regressions cover
retained class changes, static-position invalidation, wrapping and BR anchors,
transform eligibility, depth sorting, and fixed containing blocks.

Full 3D projection flattening, transform-property Z scaling, and large used
dimensions remain unfinished. The simulator exercises the shared embedded
engine, but this batch has not been run on ESP32 hardware. Whitespace trimming
inside nontransparent inline wrappers that move to a new line by soft wrapping
still needs parent-to-child line-context propagation; the new boundary checks
cover definite starts and preserve the native vertical-margin block behavior.

The integrated full run reports **424 PASS, 73 FAIL, 603 SKIP, 0 BLOCKED,
0 ERROR**, with all 90 rendering prerequisites and all 19 adapter/font checks
passing. Native CSS geometry, first-line backgrounds, and transformed rounded
rendering regressions pass. Relative to the preceding 417-pass baseline, six
failures and one blocked case now pass, with no previous pass regressing:
the five 3D cases `3d-rendering-context-and-z-ordering-001/002`,
`3d-rendering-context-and-abspos`, `3d-rendering-context-and-fixpos`, and
`css-transforms-3d-on-anonymous-block-001`; the inline static-position case
`hypothetical-inline-alone-on-second-line`; and `block-in-inline-first-line-001`.
All seven match at zero differing pixels. The still-failing
`background-clip/clip-text-multiline-linebreak` comparison improves from 25,978
to 21,578 differing pixels. The full runner exits 1 because failures remain.

## Transform Z scaling and shaded borders

`transform: scaleZ()` and `scale3d()` now retain the Z factor through raw,
compiled, cached, and generated static styles. The view matrix scales its Z
column, and transform-presence checks, containing-block selection, snapshots,
and retained repainting include the new factor. Repeated scale functions
multiply rather than overwrite their previous factors. The independent
`transform-scale-z` probe projects four literal rectangles under perspective,
covering positive, zero, negative, and repeated Z scaling. Native projection
and static-codegen checks pass. `individual-transform-1` improves from 4,000
differing pixels to an exact match.

Border shorthands now retain `groove`, `ridge`, `inset`, and `outset` per side.
The painter draws shaded bands with joined corners; black borders still have a
visible light shade. CSS leaves the precise relief colors to the user agent
([CSS border styles](https://www.w3.org/TR/CSS22/box.html#border-style-properties)).
Cached rules, inline overrides and removal, side resets, and transformed repaint
are covered by native tests. A separate simulator probe checks 40 literal edge,
interior, and outside pixels. Static generation delegates shaded shorthands to
the shared parser; compact flat shorthands reset both relief and omitted color
bindings, including `border: 0`.

`groove-default` and `ridge-default` are mismatch tests: they require a result
different from the solid-border reference. Both now pass with 2,200 differing
pixels, supported by the independent shaded-edge checks. The final full run is
**427 PASS, 70 FAIL, 603 SKIP, 0 BLOCKED, 0 ERROR**. Only these three tests changed
relative to the preceding 424-pass run; no previous pass regressed. All 92
rendering prerequisites, all 19 adapter/font checks, native border/transform/CSS
geometry checks, and static-codegen checks pass. The full runner exits 1 because
70 failures remain. No hardware run was performed.

This change does not finish dotted/dashed/double styles, standalone border-style
longhands, or relief borders with rounded corners. Those remain renderer work;
the pass counts are not a claim of complete border conformance.

Two larger remaining groups were investigated against their actual/reference
images. The absolute-in-inline cases require physical inline fragments and
column fragmentation, including painting positioned descendants in those
fragments. Current aggregate node rectangles cannot supply that geometry;
inventing first/last endpoints from them would not fix the underlying layout.
The twelve `background-clip:text` failures require glyph coverage compositing of
the owner's background layers across its descendant text. The current parser
rejects text clipping and the painter only has rectangular clip scopes. A
reusable mask/compositing path must preserve wrapping, ellipsis, decorations,
transforms, scroll, and retained replay. Blend-mode and text-emphasis cases also
need their respective missing features. These groups remain unfinished rather
than being reclassified as passes.


## Text-clipped backgrounds and performance checks (2026-09-25)

The complete 1,100-case run now reports **434 PASS, 62 FAIL, 603 SKIP,
1 BLOCKED, 0 ERROR**. Seven previous failures are exact matches: ellipsis,
multiline line breaks, a non-propagated body background, relative descendants,
scaled text, stacking-context descendants, and text decorations. No previously
passing test changed status. Unequal images still fail; tolerances and upstream
fixtures are unchanged.

The renderer parses `background-clip: text` and the corresponding shorthand,
then masks each selected background layer with descendant glyph coverage.
Wrapping, indentation, line selection, and ellipsis share the existing text
paint path. Transparent foreground and opacity-zero in-flow descendants retain
coverage; absolute/fixed descendants do not contribute. Borders keep their own
paint commands. Projected text shares its existing inverse mapping and glyph
coverage cache. Native tests cover fractional glyph coverage, text and position
changes, background recoloring, clip toggles, and logical canvas pixel access.
A literal Ahem pixel probe independently covers gradients, multiple layers,
overflow alongside an unrelated transform, transparent text, descendants,
borders, line breaks, and scaling.

`clip-text-text-emphasis` would otherwise become a false pass: both images omit
emphasis marks. A new property-scoped probe requires emphasis ink above a known
Ahem glyph. It currently finds 400 glyph pixels and zero emphasis pixels. That
comparison is BLOCKED until emphasis rendering is implemented. The four other
text-clip failures (blend mode, constrained geometry, fragmentation, and the
multi-line gradient) remain visible failures. The float/nowrap group also
remains: its inline stream currently loses line continuity at float boundaries.

Performance safeguards:

- Mask presence is maintained during command recording and queried in constant
  time. Ordinary refreshes do not scan nodes or display commands for masks.
- Ordinary background recording avoids mask state changes and duplicate clip
  lookups. Existing retained translation, reprojection, batching, and recolor
  paths remain available to scenes without text-clipped backgrounds.
- Metadata occupies pre-existing command-header padding; compile-time layout
  checks passed for both native 64-bit and WebAssembly 32-bit targets.
- The compositor uses 128-pixel row buffers, not a framebuffer-sized mask.
  Ink contributors are collected once per painted background command. Existing
  projected-glyph coverage caches are reused.
- Masked scene mutations currently force a full repaint to keep descendant
  dependencies correct. This new feature has additional cost; masked animation
  performance is not claimed to match an ordinary rectangular background.

An unchanged native transformed-rounded-rect test binary from before this batch
was measured before rebuilding it with these changes: five warmups followed by
30 complete executions per version. Median elapsed time was **153.5 ms before,
129.0 ms after**; the 10th/90th percentiles were **135.4/158.8 ms before** and
**114.0/188.6 ms after**. The noisy tail prevents a claim of a precise speedup or
unchanged worst-case latency. All executions passed, including the existing
3 ms replay gate for 56 transformed rounded dial ticks and retained-reprojection
checks. No ESP32 hardware timing was performed.

The native text-coverage parity, text-background integration, first-line, and
transformed-rounded-rect suites pass. The adapter/font suite has 20 passing
checks. Work stops here at the user's request; remaining failures are preserved
for a later session.
