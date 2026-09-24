#!/usr/bin/env node
// Live web dev server for gea-embedded TSX apps — REAL DOM, REAL CSS, full Vite HMR.
//
// This is NOT the WASM simulator (targets/web/build-web.sh + simulator/). It runs
// the app on the web the way a gea app runs on the web: the gea-embedded TSX is
// compiled to the @geajs/core reactive DOM runtime by @geajs/vite-plugin, mounted
// into <div id="app">, and styled with the app's real CSS. Because it's plain DOM
// + Vite, editing a .css (or .tsx) file hot-reloads instantly — no C++/WASM rebuild.
//
// Two pieces bridge gea-embedded onto the gea web runtime, mirroring the C++
// pipeline (@geastack/core/scripts/build-gea-vite-geatsc.mjs):
//   1. The compat transform (@geastack/core/scripts/gea-embedded-compat-transform.mjs)
//      rewrites function components -> `class extends Component { template() }`,
//      the form @geajs/vite-plugin compiles.
//   2. Host shims for device-only globals (__gea_Display, navigator.wifi, the
//      `image` filesystem host) injected into the HTML head so board-only APIs
//      are harmless no-ops in the browser.
//
// Everything both this and the production DOM build need lives in
// ./dom-web-shared.mjs — toolchain resolution, app discovery, aliases, shims.
// Nothing is resolved against a repository layout: the toolchain comes out of
// @geastack/core, which every gea app depends on.
//
// Usage:
//   node targets/web/dev-web.mjs --app-dir <absolute app dir> [--port 5181]
//   node targets/web/dev-web.mjs <appId> [--port 5181]      (run from the project)
//
//      GEA_CORE_ROOT  override the @geastack/core package directory
//      PORT           default port

import { emulatorHtml, emulatorOptions, EMULATOR_PATH } from './dom-emulator.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  HOST_SHIM,
  PRELOAD_MANIFEST_URL,
  assertGeaRuntime,
  buildAliases,
  createCompatPlugin,
  createDotEnvPlugin,
  createRuntimeBridgePlugin,
  appHtml,
  webViteConfig,
  loadBabel,
  loadCompatTransform,
  loadDotEnvDefines,
  loadGeaPlugin,
  loadVite,
  parseCommonArgs,
  resolveApp,
  resolveCoreRoot,
  webPreloadManifest,
  webPreloadMounts,
  withoutTsconfigWrite,
} from './dom-web-shared.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))

// ---- args ------------------------------------------------------------------
const args = parseCommonArgs(process.argv.slice(2), ['--help', '-h', '--emulator', '--open'])
if (args.flags['--help'] || args.flags['-h']) {
  process.stdout.write(
    'usage: dev-web.mjs [appId] [--app-dir <dir>] [--port N] [--host <host>]\n' +
      '  --app-dir  absolute path to the app (no apps-root or id registry needed)\n' +
      '  --emulator adjustable DOM device viewport (--width, --height, --dpr, --zoom)\n' +
      '  --open     open the app or emulator in the browser\n' +
      '  appId      looked up in the directory this was run from\n',
  )
  process.exit(0)
}
const port = Number(args.flags['--port'] ?? process.env.PORT ?? 5181)
const host = args.flags['--host'] ?? true
const viewport = emulatorOptions(args.flags)
// No default. This is a published package: it cannot know where the caller
// keeps its apps, and guessing a sibling checkout only ever works on the
// machine the guess was written on. --app-dir names one app directly; the gea
// The project is where this ran. --app-dir names one app directly; otherwise
// an id is looked up in the project, exactly as the gea CLI does it.
const projectDir = process.cwd()

// ---- resolve the app from its own package.json "gea" block -----------------
let app
try {
  app = resolveApp({ appDir: args.appDir, appId: args.appId || (args.appDir ? '' : 'weather'), projectDir })
  assertGeaRuntime(app)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
const appDir = app.appDir

// ---- toolchain, all out of @geastack/core ----------------------------------
let coreRoot
let createServer
let geaPlugin
let transformGeaEmbeddedCompatSource
let dotEnv
try {
  coreRoot = resolveCoreRoot({ appDir, scriptDir })
  ;({ createServer } = await loadVite(coreRoot))
  geaPlugin = await loadGeaPlugin(coreRoot)
  ;({ transformGeaEmbeddedCompatSource } = await loadCompatTransform(coreRoot))
  dotEnv = await loadDotEnvDefines(coreRoot)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

const alias = buildAliases({ coreRoot, appDir })
const babel = loadBabel(coreRoot)
const compatTransform = createCompatPlugin(transformGeaEmbeddedCompatSource, babel)

// ---- the app's device files, served at their device paths ------------------
const preloadMounts = webPreloadMounts(app)
const preloadManifest = JSON.stringify(webPreloadManifest(preloadMounts))

const emulate = !!args.flags['--emulator']

// Serve a virtual index.html (so we never write into the app source tree) and
// inject the host shim as the very first <head> script, before the deferred app
// module evaluates host.ts.
const harnessPlugin = {
  name: 'gea-web-dev-harness',
  transformIndexHtml() {
    return [{ tag: 'script', injectTo: 'head-prepend', children: HOST_SHIM + (emulate ? `
      window.__geaEmulatorDpr = Number(new URLSearchParams(location.search).get('__gea_emulator_dpr')) || 1;
      window.__gea_Display.getDevicePixelRatio = function () { return window.__geaEmulatorDpr; };
    ` : '') }]
  },
  configureServer(server) {
    // PRE middleware. The device-file URLs (/sdcard/...) and the manifest are
    // not part of the module graph, and Vite's spa fallback rewrites req.url to
    // /index.html before any post middleware sees it — a post handler for these
    // paths silently serves the harness html instead of the file.
    server.middlewares.use((req, res, next) => {
      const requestPath = (req.url || '/').split('?')[0]
      const base = server.config.base
      const url = base !== '/' && requestPath.startsWith(base) ? '/' + requestPath.slice(base.length) : requestPath
      if (req.method !== 'GET' && req.method !== 'HEAD') return next()

      if (emulate && url === EMULATOR_PATH) {
        res.setHeader('Content-Type', 'text/html')
        res.end(emulatorHtml(viewport, server.config.base))
        return
      }

      if (url === PRELOAD_MANIFEST_URL) {
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(preloadManifest)
        return
      }

      // webPreload: /sdcard/books/x.epub -> <app>/books/x.epub, with Range
      // support because the framework's readFileRange is a ranged read.
      for (const mount of preloadMounts) {
        if (url !== mount.urlPrefix && !url.startsWith(`${mount.urlPrefix}/`)) continue
        const rel = decodeURIComponent(url.slice(mount.urlPrefix.length).replace(/^\/+/, ''))
        const file = path.resolve(mount.dir, rel)
        if (!file.startsWith(mount.dir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) continue
        const size = fs.statSync(file).size
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '')
        res.setHeader('Content-Type', 'application/octet-stream')
        res.setHeader('Accept-Ranges', 'bytes')
        if (range) {
          const start = Number(range[1])
          const end = Math.min(range[2] === '' ? size - 1 : Number(range[2]), size - 1)
          res.statusCode = 206
          res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
          res.setHeader('Content-Length', String(end - start + 1))
          fs.createReadStream(file, { start, end }).pipe(res)
        } else {
          res.statusCode = 200
          res.setHeader('Content-Length', String(size))
          fs.createReadStream(file).pipe(res)
        }
        return
      }
      next()
    })

    return () => {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || '/').split('?')[0]
        if (req.method !== 'GET' && req.method !== 'HEAD') return next()
        if (url !== '/' && url !== '/index.html') return next()
        try {
          const html = await server.transformIndexHtml(req.originalUrl || '/', appHtml(app))
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/html')
          res.end(html)
        } catch (e) {
          next(e)
        }
      })
    }
  },
}

const server = await createServer(await webViteConfig(coreRoot, appDir, 'serve', {
  root: appDir,
  configFile: false, // an app's own vite.config.ts targets the C++/WASM build
  cacheDir: path.join(appDir, '.gea/build/web/dev-cache'),
  appType: 'spa',
  clearScreen: false,
  plugins: [
    harnessPlugin,
    createDotEnvPlugin(() => dotEnv.dotEnvDefines(appDir), babel),
    createRuntimeBridgePlugin({ coreRoot, appDir }),
    compatTransform,
    withoutTsconfigWrite(geaPlugin()),
  ],
  esbuild: { jsx: 'preserve' }, // geaPlugin (pre) rewrites every JSX site; esbuild must not touch it
  resolve: { alias },
  // Never pre-bundle the framework. The reactive runtime keys its subscriber
  // registries off module-level WeakMaps in @geajs/core's own `symbols` module,
  // and the app reaches that package by two routes — this target's aliases, and
  // the plugin's own `virtual:gea-compiler-runtime`. If one of them is served
  // from an optimized dep chunk and the other from source, there are two
  // registries: stores mutate, bindings subscribe to the other copy, and the DOM
  // never updates — with no error anywhere. Serving it raw keeps one identity.
  optimizeDeps: { entries: [], exclude: ['@geajs/core', '@geastack/core'] },
  server: { port, strictPort: true, host, open: args.flags['--open'] ? (emulate ? EMULATOR_PATH : '/') : false },
}))

await server.listen()
console.log(`\n  gea web dev server (real DOM, HMR) — app: ${app.appId}`)
console.log(`  root: ${appDir}`)
console.log(`  core: ${coreRoot}`)
if (preloadMounts.length > 0) {
  for (const mount of preloadMounts) console.log(`  preload: ${mount.urlPrefix} -> ${mount.dir}`)
}
server.printUrls()

if (emulate) console.log(`  emulator: ${(server.resolvedUrls.local[0] || server.resolvedUrls.network[0]).replace(/\/$/, '')}${EMULATOR_PATH}`)
