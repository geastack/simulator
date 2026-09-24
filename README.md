# GeaStack Simulator

Web simulator and web target support for Gea applications.

This repo owns the browser-based development loop, app loading/runtime mirror,
framebuffer and input parity tests, and the web target scripts used by examples
and the CLI.

## What Is Here

| Path | Purpose |
| --- | --- |
| `simulator` | Vite app for the browser simulator. |
| `simulator/src` | App loader, manifest parsing, runtime mirror, framebuffer, parity tests, and UI shell. |
| `targets/web` | Build and development scripts for the web target. |
| `docs` | Architecture and development notes. |

## Quick Start

Run the simulator app:

```sh
cd simulator
npm install
npm run dev
```

Build and preview:

```sh
npm run build
npm run start
```

Run checks (no browser installation required):

```sh
npm run check
npm test
```

Run browser tests for hot reload and environment variables when working on those
features. Install Chromium once before the first run:

```sh
npx playwright install chromium
npm run test:browser
```

Browser tests use the `*.browser.test.mjs` suffix and are excluded from
`npm test` and `npm run test:targets`.

Run a specific example through the web target:

```sh
targets/web/dev-web.mjs watch
targets/web/build-dom-web.mjs watch
```

## Documentation

- [CSS conformance developer workflow](docs/CSS-CONFORMANCE.md): establish a
  baseline, diagnose failures, add independent regressions, validate fixes and
  performance, and hand the work to another developer.

- [WPT CSS conformance rig](test/wpt/README.md): run upstream CSS reftests
  against the simulator renderer with automated framebuffer diffs and reports.

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): simulator runtime, target
  scripts, generated apps, and parity tests.

## Maintenance Notes

- Keep simulator behavior close to target behavior. Parity tests exist to catch
  drift in app loading, framebuffer, RTC, media, fetch, and WebSocket behavior.
- Keep generated app output under `targets/web/generated` disposable.
- When adding a new app manifest feature, update simulator parsing and the
  examples/core manifest tests together.

## License

Apache-2.0 (see `LICENSE`). You can ship closed-source products
built on it. The only GeaStack code under a different license is
the embedded board support (`targets` and `@geastack/chips`, GPL-3.0-only):
shipping closed-source firmware through those needs a commercial license.
Contact [contact@geastack.com](mailto:contact@geastack.com) for commercial terms, support and hosted builds.

## DOM emulator and web apps

From an app declaring `gea.targets.web`:

```sh
gea dev                         # real DOM + CSS, Vite HMR
gea simulate                    # DOM app inside an adjustable device viewport
gea simulate --width 320 --height 480 --dpr 2 --zoom 1 --no-open
gea simulate --renderer wasm    # embedded C++ renderer; requires Emscripten
gea build --target web          # .gea/build/web/site
```

`simulate` now defaults to DOM. Scripts that require framebuffer parity must
explicitly pass `--renderer wasm`. The WASM shell (`npm run dev` in this repo)
remains available; it does not provide the DOM app's component HMR.

The DOM emulator uses the same development pipeline as `gea dev`. Its iframe
contains real Gea DOM elements, browser CSS, and native pointer/keyboard input.
Width and height are CSS pixels. Zoom scales the preview without changing the
app viewport. DPR controls `Display.getDevicePixelRatio()` only; it does not
change the browser's actual `window.devicePixelRatio` or CSS media queries.
Viewport adjustments preserve the running app and HMR connection.

### HTML and configuration

An app's `index.html` is used in both development and production. Keep an app
mount element (`#app` for `@geastack/core.mount`) and a module script for your
entry. If HTML is absent, Gea generates it in memory. HTML edits reload the app.

Put web-only Vite settings in `vite.web.config.ts` (also supported: `.mts`, `.js`,
`.mjs`, `.cts`, `.cjs`). Gea scaffolds this file. Legacy `vite.config.*` is left
for existing embedded builds and is never loaded by this DOM pipeline.
Aliases, plugins, base paths, and ordinary Vite options are merged into both
web commands. Gea owns the root, app entry, runtime aliases, JSX transforms,
and CLI output directory. It installs its Gea compiler plugin once even if the
web config also supplies one. Restart after editing the web config.

CSS updates and compatible reactive, static/function, and nested component
edits use HMR. Compatible reactive edits preserve state. Changes to runtime
base classes or modules that cannot be patched fall back to a page reload.
Hardware and embedded layout parity must be checked separately using WASM or
a device; browser layout is the browser's own layout implementation.

### Browser device API contract

| API | DOM behavior |
| --- | --- |
| Display dimensions | Live iframe/window dimensions; emulator DPR as described above |
| Display brightness, orientation setters, panel/refresh/memory tuning | No-ops; no hardware effects |
| Input, CSS, DOM, fetch, local storage | Browser APIs; storage compatibility returns an empty string for missing keys |
| Oscillator audio | Web Audio where available, subject to browser playback policy |
| Device audio volume | Fixed readback, no-op setter |
| Battery, heap/PSRAM/stack, Wi-Fi | Simulated values: battery 87%, memory 0, Wi-Fi `web`/loopback with empty scan results |
| Camera host | Unavailable; opening/recording fail and capture returns -1; no browser-camera bridge |
| `webPreload` files | Read-only HTTP files at the declared device paths, with range reads in dev |
| Device filesystem writes, native image handles | Unsupported; failure/empty results |

### Testing local compiler/runtime changes

The installed dependency artifacts can differ from sibling source checkouts.
Build the plugin and explicitly select both local packages when validating a
cross-repository change (paths below assume sibling repositories):

```sh
npm --prefix ../gea run build:vite-plugin
GEA_WEB_PLUGIN_DIR="$PWD/../gea/packages/vite-plugin-gea" \
GEA_WEB_RUNTIME_DIR="$PWD/../gea/packages/gea" npm run test:browser
```

The same environment variables work with `gea dev`, `gea simulate`, and web
builds. Without them, packages resolve from the app/core installation as before.
Ship corresponding compiler/runtime and simulator changes together; selecting
an older installed artifact does not exercise the modified sources.
