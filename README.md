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
targets/web/build-web.sh watch
```

## Documentation

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
