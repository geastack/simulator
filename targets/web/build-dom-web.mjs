#!/usr/bin/env node
// Production build for the real-DOM web target — the `vite build` counterpart of
// dev-web.mjs.
//
// Same pipeline, same aliases, same host shims (all from ./dom-web-shared.mjs):
// the gea-embedded TSX goes through the compat transform, is compiled to the
// @geajs/core reactive DOM runtime by @geajs/vite-plugin, mounted into
// <div id="app">, and styled with the app's real CSS. The output is an ordinary
// static site — index.html + hashed JS + the app's real CSS — that any file
// server can host.
//
// This is NOT the C++/WASM pipeline. Nothing here is lib mode, there is no
// cssCodeSplit collapsing into a C++ StyleSheet fragment, no IR, no module
// graph, no geatsc. The CSS stays CSS.
//
// Usage:
//   node targets/web/build-dom-web.mjs --app-dir <absolute app dir> [--out-dir <dir>] [--base /path/]
//   node targets/web/build-dom-web.mjs <appId> [--out-dir <dir>]     (run from the project)
//
// --out-dir defaults to <app>/.gea/build/web/dist — the app's own build tree,
// beside the board builds it already writes there. Never node_modules, never a
// newly invented scratch directory.
//
//      GEA_CORE_ROOT  override the @geastack/core package directory

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  HOST_SHIM,
  PRELOAD_MANIFEST_URL,
  assertGeaRuntime,
  buildAliases,
  createCompatPlugin,
  createRuntimeBridgePlugin,
  harnessHtml,
  loadBabel,
  loadCompatTransform,
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
const packageRoot = path.resolve(scriptDir, '../..')

// ---- args ------------------------------------------------------------------
const args = parseCommonArgs(process.argv.slice(2), ['--help', '-h', '--no-preload'])
if (args.flags['--help'] || args.flags['-h']) {
  process.stdout.write(
    'usage: build-dom-web.mjs [appId] [--app-dir <dir>] [--out-dir <dir>] [--base <path>]\n' +
      '  --app-dir   absolute path to the app (no apps-root or id registry needed)\n' +
      '  --out-dir   static site output (default <app>/.gea/build/web/dist)\n' +
      '  --base      public base path for emitted asset URLs (default ./)\n',
  )
  process.exit(0)
}
// No default. This is a published package: it cannot know where the caller
// keeps its apps, and guessing a sibling checkout only ever works on the
// machine the guess was written on. --app-dir names one app directly; the gea
// The project is where this ran. --app-dir names one app directly; otherwise
// an id is looked up in the project, exactly as the gea CLI does it.
const projectDir = process.cwd()

let app
try {
  app = resolveApp({ appDir: args.appDir, appId: args.appId, projectDir })
  assertGeaRuntime(app)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
const appDir = app.appDir
const webBuildDir = path.join(appDir, '.gea/build/web')
const outDir = path.resolve(args.flags['--out-dir'] || path.join(webBuildDir, 'dist'))
const base = args.flags['--base'] || './'

// ---- toolchain, all out of @geastack/core ----------------------------------
let coreRoot
let build
let geaPlugin
let transformGeaEmbeddedCompatSource
try {
  coreRoot = resolveCoreRoot({ appDir, scriptDir })
  ;({ build } = await loadVite(coreRoot))
  geaPlugin = await loadGeaPlugin(coreRoot)
  ;({ transformGeaEmbeddedCompatSource } = await loadCompatTransform(coreRoot))
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

// ---- the app's device files -------------------------------------------------
const preloadMounts = args.flags['--no-preload'] ? [] : webPreloadMounts(app)

// ---- build -----------------------------------------------------------------
// The build root is the app directory itself, exactly as in dev — NOT a staged
// copy. A staged tree at a different depth silently breaks every relative
// reference that escapes the app: e-reader's own CSS reaches its fonts with
// `url(../../../assets/fonts/...)`, which from a copy three directories deeper
// points at nothing, and Vite reports it only as "didn't resolve at build
// time, it will remain unchanged" before shipping a site with no fonts.
//
// Vite still needs an html entry inside the root, and the app source tree is
// not ours to write into. So the harness html is VIRTUAL: `<app>/index.html`
// is named as the rollup input and served from memory by a `pre` load hook, so
// it is at the right depth without ever existing on disk. The compat transform
// runs as the same plugin dev uses.
const alias = buildAliases({ coreRoot, appDir })
const harnessPath = path.join(appDir, 'index.html')
const harnessSource = harnessHtml({ title: app.appName, entry: app.entry })
if (fs.existsSync(harnessPath)) {
  console.warn(`  note: ${path.relative(appDir, harnessPath)} exists in the app and is ignored — the harness html is generated.`)
}

// Deliberately NOT `enforce: 'pre'`. A pre plugin's transformIndexHtml runs
// ahead of vite:build-html's own html transform, and the inline `<style>` in
// the harness then never reaches the html-proxy cache the CSS transform fills:
// generateBundle looks the proxy up, gets undefined, and rolldown reports it as
// `vite:build-html` / "replacement content must be a string" with no mention of
// CSS. The default (normal) ordering is correct here, and resolveId/load still
// run ahead of vite's filesystem fallback.
const harnessPlugin = {
  name: 'gea-web-dom-harness',
  resolveId(source, importer) {
    const clean = source.split('?')[0]
    if (clean === harnessPath || (!importer && path.resolve(appDir, clean) === harnessPath)) return harnessPath
    return null
  },
  load(id) {
    return id.split('?')[0] === harnessPath ? harnessSource : null
  },
  transformIndexHtml() {
    return [{ tag: 'script', injectTo: 'head-prepend', children: HOST_SHIM }]
  },
}

await build({
  root: appDir,
  base,
  configFile: false, // an app's own vite.config.ts targets the C++/WASM build
  cacheDir: path.join(webBuildDir, 'build-cache'),
  clearScreen: false,
  logLevel: 'info',
  plugins: [
    harnessPlugin,
    createRuntimeBridgePlugin({ coreRoot, appDir }),
    createCompatPlugin(transformGeaEmbeddedCompatSource, loadBabel(coreRoot)),
    withoutTsconfigWrite(geaPlugin()),
  ],
  esbuild: { jsx: 'preserve' }, // geaPlugin (pre) rewrites every JSX site; esbuild must not touch it
  resolve: { alias },
  // See dev-web.mjs: one @geajs/core identity, or stores mutate into a registry
  // no binding is subscribed to.
  // See dev-web.mjs: one @geajs/core identity, or stores mutate into a registry
  // no binding is subscribed to.
  optimizeDeps: { exclude: ['@geajs/core', '@geastack/core'] },
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: { input: harnessPath },
  },
})

// ---- the app's device files, emitted at their device paths -----------------
function copyDir(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true })
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const src = path.join(srcDir, entry.name)
    const dst = path.join(dstDir, entry.name)
    if (entry.isDirectory()) copyDir(src, dst)
    else if (entry.isFile()) fs.copyFileSync(src, dst)
  }
}
for (const mount of preloadMounts) {
  copyDir(mount.dir, path.join(outDir, mount.urlPrefix.replace(/^\/+/, '')))
}
fs.writeFileSync(
  path.join(outDir, PRELOAD_MANIFEST_URL.replace(/^\/+/, '')),
  JSON.stringify(webPreloadManifest(preloadMounts)),
)

console.log(`\n  gea web (real DOM) build — app: ${app.appId}`)
console.log(`  core:  ${coreRoot}`)
for (const mount of preloadMounts) console.log(`  preload: ${mount.urlPrefix} <- ${mount.dir}`)
console.log(`  out:   ${outDir}`)
