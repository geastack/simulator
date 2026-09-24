# Simulator Architecture

The simulator repo has two related jobs:

1. Provide a browser development app for Gea programs.
2. Provide the web target scripts used by examples, tests, and the CLI.

## Runtime Pieces

| File | Responsibility |
| --- | --- |
| `simulator/src/app-loader.ts` | Resolve and load generated app bundles. |
| `simulator/src/app-runtime.ts` | Runtime surface for loaded apps. |
| `simulator/src/manifest.ts` | App manifest parsing and validation helpers. |
| `simulator/src/framebuffer.ts` | Framebuffer behavior for display parity. |
| `simulator/src/mirror-runtime.ts` | Runtime mirror behavior for target parity. |
| `simulator/src/defaults.ts` | Default app/target state. |
| `simulator/src/main.ts` | Browser app entry point. |

Tests live next to the runtime files and cover app loading, manifests,
framebuffer behavior, fetch/media/RTC/WebSocket parity, and defaults.

## Web Target Scripts

`targets/web` contains the target entry points:

- `dev-web.mjs`: run one DOM app with Vite HMR; `--emulator` wraps it in a device iframe.
- `dom-emulator.mjs`: development-only viewport shell.
- `build-dom-web.mjs`: build production HTML/JS/CSS.
- `build-web.sh`: compile the embedded renderer to WASM (`gea simulate --renderer wasm`).

Generated outputs under `targets/web/generated` are build products.

## App Resolution

The simulator expects app manifests from the examples repo or explicitly passed
app paths. The `gea` manifest in an app's `package.json` is the source of truth
for id, entry, runtime, and target compatibility.

When adding a manifest field:

1. update simulator manifest parsing;
2. update examples docs;
3. update core app-manifest tests;
4. update IDE/CLI consumers if they read the same field.

## Development Loop

For simulator UI/runtime work:

```sh
cd simulator
npm run dev
npm test
npm run check
```

For target-script work:

```sh
targets/web/dev-web.mjs <app-id>
targets/web/build-web.sh <app-id>
```

Use a small representative app such as `watch`, then a heavier rendering app
such as `css-3d-cube`, `maps`, or `bouncing-balls-jsx` when runtime behavior
changed.
