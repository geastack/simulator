// Shared plumbing for the real-DOM web target (dev-web.mjs + build-dom-web.mjs).
//
// This is the DOM path, not the WASM simulator and not the C++ pipeline: the
// gea-embedded TSX is compiled to the @geajs/core reactive DOM runtime by
// @geajs/vite-plugin, mounted into <div id="app">, and styled with the app's
// real CSS. Both entry points want exactly the same four answers, so they live
// here once:
//
//   1. WHERE the toolchain is. Everything the DOM path needs now ships inside
//      `@geastack/core` (vite, @geajs/vite-plugin, @geajs/core, the compat
//      transform, runtime.ts). Nothing is resolved against a repository layout
//      any more -- the old `vendor/gea/...` and `lib/gea-embedded/...` paths do
//      not exist. `resolveCoreRoot` finds the package from the APP first, so an
//      app pinning its own @geastack/core gets the one it declared.
//   2. WHAT the app is. Read straight out of the app's own `package.json` "gea"
//      block, so an app at an arbitrary absolute path works with no apps-root,
//      no id registry and no CLI subprocess.
//   3. The ALIASES. `gea-embedded` and `@geastack/core` must land on the SAME
//      runtime.ts module instance (two identities means two Component base
//      classes and nothing renders), and `@geajs/core` must be one copy for the
//      same reason -- the plugin's generated code imports it by bare name from
//      transformed app modules, which may resolve it from a different
//      node_modules than the one the framework runtime came from.
//   4. The HOST SHIMS. Device-only globals (__gea_Display, __gea_Camera,
//      navigator.wifi, the `image` file/asset host) become browser no-ops so an
//      app written for a board mounts in a browser instead of throwing.
//
// Nothing here is C++-specific: no lib mode, no IR, no module graph, no geatsc.

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// ---------------------------------------------------------------------------
// package resolution (no hardcoded node_modules paths)
// ---------------------------------------------------------------------------

/** Walk `dir` and its parents looking for `node_modules/<name>/package.json`. */
export function findPackageDir(name, fromDir) {
  if (!fromDir) return ''
  let dir = path.resolve(fromDir)
  for (;;) {
    const candidate = path.join(dir, 'node_modules', ...name.split('/'))
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      try {
        return fs.realpathSync(candidate)
      } catch {
        return candidate
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) return ''
    dir = parent
  }
}

/** First hit of `findPackageDir` across several starting directories. */
export function findPackageDirFrom(name, fromDirs) {
  for (const from of fromDirs) {
    const hit = findPackageDir(name, from)
    if (hit) return hit
  }
  return ''
}

function pickExportTarget(node, conditions) {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) {
    for (const entry of node) {
      const hit = pickExportTarget(entry, conditions)
      if (hit) return hit
    }
    return ''
  }
  if (!node || typeof node !== 'object') return ''
  for (const condition of conditions) {
    if (condition in node) {
      const hit = pickExportTarget(node[condition], conditions)
      if (hit) return hit
    }
  }
  return ''
}

/**
 * Resolve one subpath of an already-located package to an absolute file.
 *
 * `createRequire(...).resolve` cannot do this: both @geajs packages publish an
 * `exports` map with only `types`/`import` conditions, so a CJS require throws
 * ERR_PACKAGE_PATH_NOT_EXPORTED, and `import.meta.resolve` has no usable parent
 * URL from a script that lives outside the package. So read the map directly.
 *
 * `conditions` is ordered most-wanted first. "source" is tried ahead of
 * "import" where a caller wants the package's TypeScript sources -- but only
 * counts when the file is actually on disk: @geajs/core declares `source`
 * conditions while shipping only `dist`, so the condition exists in every
 * install and resolves in almost none.
 */
export function resolvePackageExport(pkgDir, subpath = '.', conditions = ['import', 'module', 'default']) {
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
  const key = subpath === '.' ? '.' : subpath.startsWith('./') ? subpath : `./${subpath}`
  const candidates = []
  if (pkg.exports) {
    const node = typeof pkg.exports === 'object' && !Array.isArray(pkg.exports) ? pkg.exports[key] : key === '.' ? pkg.exports : undefined
    const target = pickExportTarget(node, conditions)
    if (target) candidates.push(target)
  }
  if (key === '.') {
    if (pkg.module) candidates.push(pkg.module)
    if (pkg.main) candidates.push(pkg.main)
    candidates.push('./index.mjs', './index.js')
  }
  for (const candidate of candidates) {
    const resolved = path.resolve(pkgDir, candidate)
    if (fs.existsSync(resolved)) return resolved
  }
  return ''
}

/**
 * Locate `@geastack/core`. The app wins: an app that pins its own version must
 * be compiled against the one it declared, not against whatever this script
 * happens to sit next to. `GEA_CORE_ROOT` overrides both for an unusual layout.
 */
export function resolveCoreRoot({ appDir = '', scriptDir = '' } = {}) {
  const override = process.env.GEA_CORE_ROOT
  if (override) {
    const resolved = path.resolve(override)
    if (!fs.existsSync(path.join(resolved, 'runtime.ts'))) {
      throw new Error(`GEA_CORE_ROOT does not look like @geastack/core (no runtime.ts): ${resolved}`)
    }
    return resolved
  }
  const hit = findPackageDirFrom('@geastack/core', [appDir, scriptDir].filter(Boolean))
  if (!hit) {
    throw new Error(
      '@geastack/core could not be resolved from the app directory or from this script.\n' +
        'Install it in the app (every gea app depends on it), or set GEA_CORE_ROOT to the package directory.',
    )
  }
  return hit
}

/** vite, resolved from @geastack/core's own install (it declares the dependency). */
export async function loadVite(coreRoot) {
  const requireFromCore = createRequire(path.join(coreRoot, 'package.json'))
  let entry = ''
  try {
    entry = requireFromCore.resolve('vite')
  } catch {
    const pkgDir = findPackageDirFrom('vite', [coreRoot])
    if (pkgDir) entry = resolvePackageExport(pkgDir, '.')
  }
  if (!entry) throw new Error(`vite could not be resolved from @geastack/core at ${coreRoot}`)
  return import(pathToFileURL(entry).href)
}

/**
 * @geajs/vite-plugin -- the published package `vite-plugin-gea` was renamed to.
 * Exported symbol is still `geaPlugin` (verified against dist/index.mjs 1.4.1),
 * but read whichever callable the module exposes rather than assuming.
 */
export async function loadGeaPlugin(coreRoot) {
  const pkgDir = findPackageDirFrom('@geajs/vite-plugin', [coreRoot])
  if (!pkgDir) throw new Error(`@geajs/vite-plugin could not be resolved from @geastack/core at ${coreRoot}`)
  const entry = resolvePackageExport(pkgDir, '.')
  if (!entry) throw new Error(`@geajs/vite-plugin has no resolvable entry at ${pkgDir}`)
  const mod = await import(pathToFileURL(entry).href)
  const geaPlugin = mod.geaPlugin ?? mod.default ?? mod.gea ?? mod.vitePluginGea
  if (typeof geaPlugin !== 'function') {
    throw new Error(`@geajs/vite-plugin (${entry}) exports no callable plugin factory; saw: ${Object.keys(mod).join(', ')}`)
  }
  return geaPlugin
}

// ---------------------------------------------------------------------------
// app discovery
// ---------------------------------------------------------------------------

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** The four facts the old `gea-embedded inspect --format shell` printed. */
function appFactsFromDir(dir) {
  const pkg = readJson(path.join(dir, 'package.json'))
  if (!pkg || !pkg.gea) return null
  const gea = pkg.gea
  return {
    appDir: fs.realpathSync(dir),
    appId: gea.id || path.basename(dir),
    appName: gea.name || gea.id || path.basename(dir),
    entry: gea.entry || 'index.tsx',
    runtime: gea.runtime || 'gea',
    gea,
    pkg,
  }
}

function* candidateAppDirs(projectDir) {
  for (const base of [path.join(projectDir, 'apps'), projectDir]) {
    if (!fs.existsSync(base)) continue
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
      yield path.join(base, entry.name)
    }
  }
}

/**
 * Resolve an app from an explicit directory (first class: no id registry, no
 * CLI subprocess -- this is what `gea dev --target web` calls) or, failing
 * that, by scanning the PROJECT -- the directory the tool was run in -- for a
 * package.json whose `gea.id` matches. Either way the facts come from the
 * app's own package.json.
 */
export function resolveApp({ appDir = '', appId = '', projectDir = process.cwd() } = {}) {
  if (appDir) {
    const dir = path.resolve(appDir)
    if (!fs.existsSync(dir)) throw new Error(`--app-dir does not exist: ${dir}`)
    const facts = appFactsFromDir(dir)
    if (!facts) throw new Error(`${dir} has no package.json with a "gea" block — not a gea app directory.`)
    return facts
  }
  if (!appId) throw new Error('no app: pass --app-dir <dir> or an app id.')
  const roots = projectDir ? [path.resolve(projectDir)] : []
  for (const root of roots) {
    for (const dir of candidateAppDirs(root)) {
      const facts = appFactsFromDir(dir)
      if (facts && facts.appId === appId) return facts
    }
  }
  throw new Error(
    `app "${appId}" was not found under ${roots.join(', ') || '(nowhere to look)'}.\n` +
      'Run this from the app project that holds it, or pass --app-dir <absolute app directory>.',
  )
}

export function assertGeaRuntime(app) {
  if (app.runtime !== 'gea') {
    throw new Error(`app "${app.appId}" runtime is "${app.runtime}", not "gea" — the DOM web target only supports gea apps.`)
  }
}

// ---------------------------------------------------------------------------
// aliases
// ---------------------------------------------------------------------------

export const RUNTIME_BRIDGE_ID = 'virtual:gea-embedded-runtime'
const RUNTIME_BRIDGE_RESOLVED = `\0${RUNTIME_BRIDGE_ID}`
// Every specifier that must land on the bridge instead of core's runtime.ts.
const RUNTIME_BRIDGE_NAMES = new Set(['gea-embedded', '@geastack/core', '@geastack/core/runtime'])

/**
 * `gea-embedded` / `@geastack/core` on the DOM target.
 *
 * @geastack/core's runtime.ts is the surface a BOARD build compiles: there
 * `Component` and `Store` are deliberately empty marker classes
 * (`export class Store {}` in runtime/compiler.ts) because geatsc implements
 * reactivity in C++. On the web nothing fills them in, so an app store that
 * @geajs/vite-plugin does not statically compile — and it only compiles the
 * `export default new S()` shape, not the `export const s = new S()` that
 * gea-embedded apps are written in — extends a class with no reactivity at
 * all: the store mutates and the DOM never re-renders, silently, with no error.
 *
 * So the two names resolve to this bridge instead: the whole core runtime
 * surface (Display, mount, images, host, types), with `Component` and `Store`
 * taken from @geajs/core, which is where the real DOM implementations live.
 * Explicit re-exports shadow `export *`, so the board markers lose and
 * everything else is untouched.
 */
export function createRuntimeBridgePlugin({ coreRoot, appDir }) {
  const runtimePath = path.join(coreRoot, 'runtime.ts')
  const geaCoreDir = findPackageDirFrom('@geajs/core', [appDir, coreRoot].filter(Boolean))
  const geaCoreEntry = geaCoreDir ? resolvePackageExport(geaCoreDir, '.', ['source', 'import', 'module', 'default']) : ''
  const q = (value) => JSON.stringify(value)
  return {
    name: 'gea-embedded-runtime-bridge',
    enforce: 'pre',
    // The three names are answered HERE rather than through `resolve.alias`.
    // An alias whose replacement is a virtual id is resolved by vite's own
    // alias layer, which in a rolldown build never re-enters plugin resolveId:
    // the id stays unresolved, rolldown externalises it, the entry chunk never
    // forms, and the failure surfaces as `vite:build-html` throwing
    // "replacement content must be a string" while rewriting the html's script
    // src to a chunk that does not exist. A `pre` resolveId runs before the
    // alias layer in both dev and build.
    resolveId(source) {
      if (RUNTIME_BRIDGE_NAMES.has(source)) return RUNTIME_BRIDGE_RESOLVED
      if (source === RUNTIME_BRIDGE_ID || source === RUNTIME_BRIDGE_RESOLVED) return RUNTIME_BRIDGE_RESOLVED
      return null
    },
    load(id) {
      if (id !== RUNTIME_BRIDGE_RESOLVED) return null
      if (!geaCoreEntry) return `export * from ${q(runtimePath)}\n`
      return `export * from ${q(runtimePath)}\nexport { Component, Store } from ${q(geaCoreEntry)}\n`
    },
  }
}

/**
 * One module identity per framework package.
 *
 * `@geastack/core` already answers "." with runtime.ts through its own exports
 * map, but `gea-embedded` (the bare name the compat transform injects) answers
 * nothing at all, and an app may reach the package through a different
 * node_modules than the plugin's generated imports do. Pinning all of them to
 * absolute files is what keeps `Component` a single class.
 */
export function buildAliases({ coreRoot, appDir }) {
  const runtimePath = path.join(coreRoot, 'runtime.ts')
  const alias = []

  // @geajs/core: prefer the package's own "source" condition when the install
  // actually carries src/ (a workspace checkout), else its published dist.
  const geaCoreDir = findPackageDirFrom('@geajs/core', [appDir, coreRoot].filter(Boolean))
  if (geaCoreDir) {
    const conditions = ['source', 'import', 'module', 'default']
    for (const subpath of ['./jsx-dev-runtime', './jsx-runtime', './router', './ssr', './compiler-runtime']) {
      const resolved = resolvePackageExport(geaCoreDir, subpath, conditions)
      if (resolved) alias.push({ find: `@geajs/core${subpath.slice(1)}`, replacement: resolved })
    }
    const root = resolvePackageExport(geaCoreDir, '.', conditions)
    // Bare-name last: vite's alias list is ordered, and a prefix match on
    // '@geajs/core' would otherwise swallow every subpath above.
    if (root) alias.push({ find: /^@geajs\/core$/, replacement: root })
  }

  // `gea-embedded`, `@geastack/core` and `@geastack/core/runtime` are NOT
  // aliased — createRuntimeBridgePlugin answers them (see RUNTIME_BRIDGE_ID).
  // Deep runtime subpaths are plain files and stay aliases.
  alias.push({ find: /^@geastack\/core\/runtime\/(.+)$/, replacement: path.join(coreRoot, 'runtime/$1.ts') })

  // Optional component packages, aliased only when they are actually installed
  // (they sit beside core in a workspace checkout, in node_modules otherwise).
  for (const [name, pkg] of [
    ['@geastack/elements', 'elements'],
    ['@geastack/engine', 'engine'],
  ]) {
    const sibling = path.resolve(coreRoot, '..', pkg)
    const dir = fs.existsSync(path.join(sibling, 'package.json'))
      ? sibling
      : findPackageDirFrom(name, [appDir, coreRoot].filter(Boolean))
    if (!dir) continue
    const index = path.join(dir, 'components/index.ts')
    if (!fs.existsSync(index)) continue
    alias.push({ find: new RegExp(`^${name.replace('/', '\\/')}\\/components\\/(.+)$`), replacement: path.join(dir, 'components/$1') })
    alias.push({ find: new RegExp(`^${name.replace('/', '\\/')}\\/components$`), replacement: index })
    alias.push({ find: new RegExp(`^${name.replace('/', '\\/')}$`), replacement: index })
  }

  // The pre-split spelling of the same component trees.
  const elementsSibling = path.resolve(coreRoot, '..', 'elements')
  if (fs.existsSync(path.join(elementsSibling, 'components/index.ts'))) {
    alias.push({ find: /^gea-embedded\/components$/, replacement: path.join(elementsSibling, 'components/index.ts') })
    alias.push({ find: /^gea-embedded\/components\/(.+)$/, replacement: path.join(elementsSibling, 'components/$1') })
  }

  return alias
}

// ---------------------------------------------------------------------------
// compat transform plugin
// ---------------------------------------------------------------------------

/**
 * The gea-embedded -> @geajs/core compat rewrite, as a `pre` Vite plugin:
 * capitalized JSX-returning functions become `class X extends Component`, and
 * `Component`/`Store` imports move onto the `gea-embedded` specifier. Shared
 * with the C++ pipeline -- it ships inside @geastack/core.
 */
export async function loadCompatTransform(coreRoot) {
  const entry = path.join(coreRoot, 'scripts/gea-embedded-compat-transform.mjs')
  if (!fs.existsSync(entry)) throw new Error(`@geastack/core is missing the compat transform: ${entry}`)
  return import(pathToFileURL(entry).href)
}

export async function loadDotEnvDefines(coreRoot) {
  const entry = path.join(coreRoot, 'scripts/dotenv-defines.mjs')
  if (!fs.existsSync(entry)) throw new Error(`@geastack/core is missing the dotenv defines: ${entry}`)
  return import(pathToFileURL(entry).href)
}

/**
 * Inlines the app's `.env` defines (`process.env.KEY`, `import.meta.env.KEY`)
 * as a `pre` Vite plugin: in dev, where Vite's own `define` isn't used, and
 * in the build for `import.meta.env.KEY`, which `define` would also fold into
 * the whole `import.meta.env` object. Only real member expressions are
 * replaced -- located through babel's AST, so matching text inside strings,
 * templates and comments is untouched.
 */
export function createDotEnvPlugin(loadDefines, babel) {
  let defines
  if (!babel) throw new Error('@geastack/core is missing @babel/parser, needed to inline .env values')
  return {
    name: 'gea-dotenv',
    enforce: 'pre',
    configResolved() {
      // Vite reuses inline plugin instances when restarting the dev server.
      defines = typeof loadDefines === 'function' ? loadDefines() : loadDefines
    },
    configureServer(server) {
      const example = path.join(server.config.root, '.env.example')
      server.watcher.add(example)
      // Vite already restarts for .env; extend that behavior to the contract.
      const onChange = (file) => {
        if (path.resolve(file) === example) {
          void server.restart().catch((error) => server.config.logger.error(error.stack || error.message))
        }
      }
      server.watcher.on('add', onChange).on('change', onChange).on('unlink', onChange)
      server.httpServer?.once('close', () => {
        for (const event of ['add', 'change', 'unlink']) server.watcher.off(event, onChange)
      })
    },
    transform(code, id) {
      const file = id.split('?')[0]
      if (!/\.(?:[jt]sx?|m[jt]s)$/.test(file)) return null
      if (file.includes('/node_modules/')) return null
      const out = inlineDotEnv(code, file, defines, babel)
      return out === code ? null : { code: out, map: null }
    },
  }
}

/** `process.env.KEY` / `import.meta.env.KEY` as a dotted string, or null. */
function dottedName(node) {
  if (node.type === 'Identifier') return node.name
  if (node.type === 'MetaProperty') return `${node.meta.name}.${node.property.name}`
  const member = node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression'
  if (!member || node.computed || node.property.type !== 'Identifier') return null
  const object = dottedName(node.object)
  return object === null ? null : `${object}.${node.property.name}`
}

/** The innermost object of a member chain: `process` in `process.env.KEY`. */
function rootObject(node) {
  while (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') node = node.object
  return node
}

/**
 * Whether the member expression at `p` is written to rather than read: the
 * left of `=`/`+=`/`for...in`/`for...of`, an update operand, or a slot of a
 * destructuring pattern (a computed key inside the pattern is still a read).
 */
function isAssignmentTarget(p) {
  const parent = p.parentPath
  if (parent.isUpdateExpression()) return true
  if (parent.isAssignmentExpression() || parent.isForInStatement() || parent.isForOfStatement() || parent.isAssignmentPattern()) {
    return p.key === 'left'
  }
  if (parent.isArrayPattern() || parent.isRestElement()) return true
  return parent.isObjectProperty() && p.key === 'value' && parent.parentPath.isObjectPattern()
}

export function inlineDotEnv(code, filename, defines, babel) {
  const { parser, traverse } = babel
  const plugins = ['decorators-legacy']
  if (/\.[cm]?tsx?$/.test(filename)) plugins.push('typescript')
  if (!/\.[cm]?ts$/.test(filename)) plugins.push('jsx')
  let ast
  try {
    ast = parser.parse(code, { sourceType: 'module', plugins, sourceFilename: filename })
  } catch (error) {
    throw new Error(`Unable to inline .env expressions in ${filename}: ${error.message}`, { cause: error })
  }
  const edits = []
  traverse(ast, {
    // `process.env?.KEY` is an OptionalMemberExpression; it must go too, or a
    // bare `process` reference reaches the browser.
    'MemberExpression|OptionalMemberExpression'(p) {
      const literal = defines[dottedName(p.node)]
      if (literal === undefined) return
      // An assignment target can't become a literal; leave it as written.
      if (isAssignmentTarget(p)) return
      // A local `process` (a parameter, a variable) is not the global one.
      if (p.scope.hasBinding(rootObject(p.node).name)) return
      edits.push([p.node.start, p.node.end, literal])
      p.skip()
    },
  })
  let out = code
  for (const [start, end, literal] of edits.sort((a, b) => b[0] - a[0])) {
    out = out.slice(0, start) + literal + out.slice(end)
  }
  return out
}

export function createCompatPlugin(transformGeaEmbeddedCompatSource, babel = null) {
  return {
    name: 'gea-embedded-compat',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0]
      if (!/\.[jt]sx?$/.test(file)) return null
      if (file.includes('/node_modules/')) return null
      let out = transformGeaEmbeddedCompatSource(code, file)
      out = domComponentCompat(out, file, babel)
      return out === code ? null : { code: out, map: null }
    },
  }
}

/** The specifiers an app can reach the framework's class API through. */
const RUNTIME_CLASS_SOURCES = new Set(['@geastack/core', '@geastack/core/runtime', 'gea-embedded', '@geajs/core'])

/**
 * `extends ReactiveComponent` -> `extends Component`, for the DOM target only.
 *
 * `ReactiveComponent` is an EMBEDDED spelling. @geastack/core declares it as an
 * empty `class ReactiveComponent extends Component {}` marker and says so:
 * "the vite-plugin rewrites `extends ReactiveComponent` to a lean typed class
 * BEFORE CODEGEN (matched by source identifier)" — codegen being geatsc's. The
 * plugin honours that by taking a geatsc-only branch for it: it deletes the
 * `template()` method AND sets `superClass = null`, because on the embedded
 * path geatsc synthesises the component from the IR afterwards.
 *
 * On the web nothing comes afterwards. The class ships as `export class App {}`
 * — no base, no template, no `render` — and `mount()` fails with
 * `instance.render is not a function`, the first symptom of a component that
 * was silently not compiled. Verified on examples/apps/css-3d-cube.
 *
 * `Component` is the same class one level up, and it is the spelling the
 * plugin's web branches match on: with it the very same class compiles to
 * `extends CompiledTinyReactiveComponent` with a real `[GEA_CREATE_TEMPLATE]`.
 * So on this target the marker is renamed to its own base before the plugin
 * sees it. Nothing is rewritten for the C++ pipeline, which still needs the
 * distinction.
 */
export function domComponentCompat(code, filename, babel) {
  if (!babel) return code
  if (!code.includes('ReactiveComponent') && !/\bmount\b/.test(code)) return code
  const { parser, traverse, generate, t } = babel
  let ast
  try {
    ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript', 'classProperties', 'classPrivateProperties', 'classPrivateMethods'],
      sourceFilename: filename,
    })
  } catch {
    return code
  }

  // Which local name the marker arrived under, and whether `Component` is
  // already bound to something else (in which case renaming would capture it).
  let reactiveLocal = ''
  let componentImport = null
  let runtimeImport = null
  for (const node of ast.program.body) {
    if (!t.isImportDeclaration(node) || !RUNTIME_CLASS_SOURCES.has(node.source.value)) continue
    runtimeImport = runtimeImport || node
    for (const spec of node.specifiers) {
      if (!t.isImportSpecifier(spec)) continue
      const imported = t.isIdentifier(spec.imported) ? spec.imported.name : spec.imported.value
      if (imported === 'ReactiveComponent') reactiveLocal = spec.local.name
      if (imported === 'Component') componentImport = spec
    }
  }
  let changed = false

  if (reactiveLocal && !(componentImport && componentImport.local.name !== 'Component')) {
    const visit = (path) => {
      const node = path.node
      if (!t.isIdentifier(node.superClass, { name: reactiveLocal })) return
      node.superClass = t.identifier('Component')
      changed = true
    }
    traverse(ast, { ClassDeclaration: visit, ClassExpression: visit })
  }

  // A module that declares a component AND imports `mount` from the framework
  // collides with the plugin's own codegen: compiling a template that mounts a
  // child component makes it inject `import { mount } from
  // 'virtual:gea-compiler-runtime'` at the top of that same module, and babel
  // then refuses the file with "Identifier 'mount' has already been declared".
  // The plugin catches that, logs it, and returns the module UNCHANGED — so the
  // component never gets a compiled base or a `render`, and mount() fails at
  // runtime exactly as an untransformed component does. Reproduced on the
  // untouched original source of examples/apps/analog-clock/index.tsx, so it
  // predates this target; renaming the app's own binding is enough to let the
  // two coexist, and the framework `mount` the app calls is unchanged.
  let hasComponentClass = false
  const noteComponentClass = (path) => {
    if (t.isIdentifier(path.node.superClass, { name: 'Component' })) hasComponentClass = true
  }
  traverse(ast, { ClassDeclaration: noteComponentClass, ClassExpression: noteComponentClass })
  if (hasComponentClass) {
    for (const node of ast.program.body) {
      if (!t.isImportDeclaration(node) || !RUNTIME_CLASS_SOURCES.has(node.source.value)) continue
      for (const spec of node.specifiers) {
        if (!t.isImportSpecifier(spec)) continue
        const imported = t.isIdentifier(spec.imported) ? spec.imported.name : spec.imported.value
        if (imported !== 'mount' || spec.local.name !== 'mount') continue
        traverse(ast, {
          Program(programPath) {
            programPath.scope.rename('mount', '__gea_app_mount')
            programPath.stop()
          },
        })
        changed = true
      }
    }
  }

  if (!changed) return code

  if (reactiveLocal && !componentImport) {
    const target = runtimeImport || ast.program.body.find((node) => t.isImportDeclaration(node) && RUNTIME_CLASS_SOURCES.has(node.source.value))
    const specifier = t.importSpecifier(t.identifier('Component'), t.identifier('Component'))
    if (target) target.specifiers.push(specifier)
    else ast.program.body.unshift(t.importDeclaration([specifier], t.stringLiteral('gea-embedded')))
  }
  return generate(ast, { retainLines: false, jsescOption: { minimal: true } }, code).code
}

/**
 * @geajs/vite-plugin, minus its `config()` hook.
 *
 * That hook has one job: it REWRITES the app's own `tsconfig.json` on disk,
 * appending a path to the plugin's `gea-env.d.ts` to `include`. Running a dev
 * server or a build is not a reason to edit a user's checked-in source file,
 * and the path it writes is relative to wherever the plugin happens to be
 * installed (`../../../core/packages/core/node_modules/@geajs/vite-plugin/...`
 * here) — the sort of resolved-once path that stops meaning anything the moment
 * the layout differs. Observed dirtying examples/apps/analog-clock/tsconfig.json.
 * Nothing else in the hook does anything, so the DOM target drops it.
 */
export function withoutTsconfigWrite(plugin) {
  const strip = (one) => {
    if (!one || typeof one !== 'object' || !('config' in one)) return one
    const { config, ...rest } = one
    return rest
  }
  return Array.isArray(plugin) ? plugin.map(strip) : strip(plugin)
}

/** @babel/{parser,traverse,generator,types}, from @geastack/core's own install. */
export function loadBabel(coreRoot) {
  const requireFromCore = createRequire(path.join(coreRoot, 'package.json'))
  try {
    const parser = requireFromCore('@babel/parser')
    const traverseModule = requireFromCore('@babel/traverse')
    const generatorModule = requireFromCore('@babel/generator')
    return {
      parser,
      traverse: traverseModule.default || traverseModule,
      generate: generatorModule.default || generatorModule,
      t: requireFromCore('@babel/types'),
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// webPreload: the app's device files, served under their device paths
// ---------------------------------------------------------------------------

/**
 * `gea.webPreload` states board-filesystem paths an app expects to read at
 * runtime (e.g. e-reader's `books` -> `/sdcard/books`). On the DOM target those
 * become plain static URLs at the same absolute path, which is what the `image`
 * host shim below fetches.
 */
export function webPreloadMounts(app) {
  const list = Array.isArray(app.gea?.webPreload) ? app.gea.webPreload : []
  const mounts = []
  for (const item of list) {
    if (!item || !item.source || !item.target) continue
    const dir = path.resolve(app.appDir, item.source)
    if (!fs.existsSync(dir)) continue
    const target = item.target.startsWith('/') ? item.target : `/${item.target}`
    mounts.push({ dir, urlPrefix: target.replace(/\/+$/, '') })
  }
  return mounts
}

/** `{ "<url dir>": ["file", ...] }` — the directory listing `image.listFiles` answers from. */
export function webPreloadManifest(mounts) {
  const manifest = {}
  const walk = (dir, urlDir) => {
    const names = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${urlDir}/${entry.name}`)
      else if (entry.isFile()) names.push(entry.name)
    }
    manifest[urlDir] = names
  }
  for (const mount of mounts) walk(mount.dir, mount.urlPrefix)
  return manifest
}

export const PRELOAD_MANIFEST_URL = '/__gea_web_preload.json'

// ---------------------------------------------------------------------------
// host shims
// ---------------------------------------------------------------------------

// Device-only globals, as browser no-ops, injected as the first <head> script
// so they exist before the app module evaluates the framework's host.ts.
export const HOST_SHIM = `;(function () {
  var noop = function () {}
  try {
    var StorageCtor = window.Storage
    if (StorageCtor && !StorageCtor.prototype.__geaGetItemReturnsString) {
      var rawGetItem = StorageCtor.prototype.getItem
      Object.defineProperty(StorageCtor.prototype, 'getItem', {
        configurable: true,
        value: function (key) {
          var value = rawGetItem.call(this, key)
          return value == null ? '' : value
        }
      })
      Object.defineProperty(StorageCtor.prototype, '__geaGetItemReturnsString', { value: true })
    }
  } catch (e) {}
  var geaFocusVoiceNotesApp = function () {
    var el = document.querySelector && document.querySelector('.voice-notes-app')
    if (!el || el.__geaWebFocusReady) return
    el.__geaWebFocusReady = true
    el.setAttribute('tabindex', '0')
    try { el.focus({ preventScroll: true }) } catch (e) { try { el.focus() } catch (ignore) {} }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', geaFocusVoiceNotesApp)
  else geaFocusVoiceNotesApp()
  try {
    new MutationObserver(geaFocusVoiceNotesApp).observe(document.documentElement, { childList: true, subtree: true })
  } catch (e) {}
  if (typeof window.__gea_Display === 'undefined') {
    window.__gea_Display = {
      get width() { return window.innerWidth },
      get height() { return window.innerHeight },
      get nativeWidth() { return window.innerWidth },
      get nativeHeight() { return window.innerHeight },
      ctx: null,
      orientation: 'portrait',
      supportedOrientations: [],
      autoRotate: false,
      pixelFormat: 'rgb888',
      panelPixelFormat: 'rgb888',
      supportedPixelFormats: ['rgb888'],
      getBrightness: function () { return 1 },
      setBrightness: noop,
      getOrientation: function () { return 'portrait' },
      setOrientation: noop,
      getSupportedOrientations: function () { return [] },
      setSupportedOrientations: noop,
      getAutoRotate: function () { return false },
      setAutoRotate: noop,
      getDevicePixelRatio: function () { return window.devicePixelRatio || 1 },
      setDevicePixelRatio: noop,
      getFrameIntervalMs: function () { return 16 },
      setFrameIntervalMs: noop,
      getFrameRate: function () { return 60 },
      setFrameRate: noop,
      getPixelFormat: function () { return 'rgb888' },
      setPixelFormat: noop,
      getPanelPixelFormat: function () { return 'rgb888' },
      getSupportedPixelFormats: function () { return ['rgb888'] },
      setAA: noop,
      setVSync: noop,
      // Board-only rasterizer/e-paper knobs. A real app calls these at module
      // top level (e-reader's index.tsx calls three of them before it mounts),
      // so a missing one is not a degraded pixel — it is a TypeError that stops
      // the entry module and leaves #app empty.
      setTextRasterCache: noop,
      setTextSolidBackdrop: noop,
      invalidate: noop,
      setMemoryConfig: noop,
      setFlushConfig: noop,
      setEpaperRefreshConfig: noop,
      epaperFullRefresh: noop
    }
  }
  if (typeof window.__gea_Battery === 'undefined') {
    window.__gea_Battery = {
      level: function () { return 87 }
    }
  }
  if (typeof window.__gea_Memory === 'undefined') {
    window.__gea_Memory = {
      internalFree: function () { return 0 },
      internalLargestFreeBlock: function () { return 0 },
      internalMinimumFree: function () { return 0 },
      psramFree: function () { return 0 },
      currentTaskStackHighWaterMark: function () { return 0 },
      geaMainStackBytes: function () { return 0 },
      geaInitStackBytes: function () { return 0 }
    }
  }
  if (typeof window.__gea_audioContext === 'undefined') {
    var geaAudioState = { context: null, destination: {} }
    var getAudioContext = function () {
      var Ctor = window.AudioContext || window.webkitAudioContext
      if (!Ctor) return null
      if (!geaAudioState.context) geaAudioState.context = new Ctor()
      if (geaAudioState.context.state === 'suspended' && geaAudioState.context.resume) {
        geaAudioState.context.resume().catch(noop)
      }
      return geaAudioState.context
    }
    var makeAudioParam = function (param) {
      return {
        get value() { return param ? param.value : 0 },
        set value(value) {
          if (param) param.value = Number(value) || 0
        },
        setValueAtTime: function (value, startTime) {
          if (param && param.setValueAtTime) param.setValueAtTime(Number(value) || 0, Number(startTime) || 0)
        }
      }
    }
    window.__gea_audioContext = {
      get currentTime() {
        var context = getAudioContext()
        return context ? context.currentTime : 0
      },
      get destination() {
        return geaAudioState.destination
      },
      createOscillator: function () {
        var context = getAudioContext()
        var oscillator = context && context.createOscillator ? context.createOscillator() : null
        return {
          get type() { return oscillator ? oscillator.type : 'sine' },
          set type(value) {
            if (oscillator) oscillator.type = value
          },
          frequency: makeAudioParam(oscillator ? oscillator.frequency : null),
          connect: function () {
            if (oscillator && context) {
              try { oscillator.connect(context.destination) } catch (e) {}
            }
            return geaAudioState.destination
          },
          start: function (when) {
            if (!oscillator) return
            try { oscillator.start(typeof when === 'number' ? when : 0) } catch (e) {}
          },
          stop: function (when) {
            if (!oscillator) return
            try { oscillator.stop(typeof when === 'number' ? when : 0) } catch (e) {}
          }
        }
      }
    }
  }
  if (typeof window.__gea_Audio === 'undefined') {
    window.__gea_Audio = { getVolume: function () { return 1 }, setVolume: noop }
  }
  var wifiShim = {
    enabled: function () { return true },
    setEnabled: noop,
    connected: function () { return true },
    rssi: function () { return -50 },
    ssid: function () { return 'web' },
    ip: function () { return '127.0.0.1' },
    mac: function () { return '00:00:00:00:00:00' },
    configure: noop,
    startScan: noop,
    scanning: function () { return false },
    scanCount: function () { return 0 },
    scanSsidAt: function () { return '' },
    scanRssiAt: function () { return 0 },
    scanSecuredAt: function () { return false }
  }
  if (!navigator.wifi) {
    try { navigator.wifi = wifiShim } catch (e) {}
    if (!navigator.wifi) {
      try { Object.defineProperty(navigator, 'wifi', { value: wifiShim, configurable: true }) } catch (e) {}
    }
  }
  // Camera: device-only. Stub it so camera apps mount in the browser (no live
  // frames — the <camera> leaf just shows its CSS box) and the imperative control
  // surface (AE / zoom / capture / record) is exercisable. isAvailable() = true so
  // the app takes its normal "Live" path rather than the no-camera fallback.
  if (typeof window.__gea_Camera === 'undefined') {
    window.__gea_Camera = {
      width: 1280, height: 960, orientation: 0, facing: 'back', deviceCount: 1,
      isAvailable: function () { return true },
      hasPermission: function () { return true },
      requestPermission: function () { return true },
      open: function () { return true },
      close: noop,
      isOpen: function () { return true },
      draw: noop,
      capture: function () { return -1 },
      captureMirrored: function () { return -1 },
      startRecording: function () { return true },
      stopRecording: function () { return 0 },
      isRecording: function () { return false },
      setFlash: noop, setZoom: noop, setMirror: noop,
      setExposure: noop, setWhiteBalance: noop, setFocus: noop, setTorch: noop,
      deviceIdAt: function () { return 'web-camera' },
      deviceFacingAt: function () { return 'back' }
    }
  }
  // The "image" host: asset/image decoding AND the board filesystem
  // (listFiles/readFile/readFileRange), which the framework's images.ts calls
  // for every listCacheFiles/readCacheFile. There is no board here, so back the
  // filesystem half with the app's own webPreload assets, served at their device
  // paths (e-reader: books/ -> /sdcard/books). The API is synchronous by
  // definition, so the reads are synchronous XHR — correct for a dev/preview
  // target, and the only shape that can answer a call that cannot await.
  if (typeof window.__gea_web_image === 'undefined') {
    var EMPTY = new Uint8Array(0)
    var manifest = null
    var manifestUrl = ${JSON.stringify(PRELOAD_MANIFEST_URL)}
    var syncGet = function (url, asBytes, range) {
      try {
        var xhr = new XMLHttpRequest()
        xhr.open('GET', url, false)
        if (asBytes) xhr.overrideMimeType('text/plain; charset=x-user-defined')
        if (range) xhr.setRequestHeader('Range', 'bytes=' + range[0] + '-' + range[1])
        xhr.send(null)
        if (xhr.status !== 200 && xhr.status !== 206 && xhr.status !== 0) return null
        if (!asBytes) return xhr.responseText
        var text = xhr.responseText
        var out = new Uint8Array(text.length)
        for (var i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
        return out
      } catch (e) {
        return null
      }
    }
    var getManifest = function () {
      if (manifest) return manifest
      var body = syncGet(manifestUrl, false, null)
      try { manifest = body ? JSON.parse(body) : {} } catch (e) { manifest = {} }
      return manifest
    }
    var slots = []
    window.__gea_web_image = {
      listFiles: function (dir) {
        var key = String(dir || '').replace(/\\/+$/, '')
        var names = getManifest()[key]
        return names && names.length ? names.join('\\n') : ''
      },
      readFile: function (p) { return syncGet(String(p), true, null) || EMPTY },
      readFileRange: function (p, offset, length) {
        if (!length) return EMPTY
        return syncGet(String(p), true, [offset, offset + length - 1]) || EMPTY
      },
      writeFile: function () { return false },
      readMapArchive: function () { return EMPTY },
      fetchBytes: function (url) { return syncGet(String(url), true, null) || EMPTY },
      fetchText: function (url) { return syncGet(String(url), false, null) || '' },
      loadAssetPath: function () { return -1 },
      make: function (id) { return { id: id, width: 0, height: 0 } },
      loadBytes: function (bytes) { slots.push(bytes); return slots.length - 1 },
      loadBytesOpaque: function (bytes) { slots.push(bytes); return slots.length - 1 },
      width: function () { return 0 },
      height: function () { return 0 },
      frameCount: function () { return 1 },
      isAnimated: function () { return false },
      setPlaying: noop,
      seek: noop,
      dispose: noop
    }
  }
  if (typeof window.image === 'undefined') window.image = window.__gea_web_image
  if (typeof window.apps === 'undefined') window.apps = { launch: function () { return 0 } }
})()`

// ---------------------------------------------------------------------------
// harness html
// ---------------------------------------------------------------------------

export function harnessHtml({ title, entry }) {
  const src = entry.startsWith('/') ? entry : `/${entry}`
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>html,body,#app{width:100%;height:100%;margin:0;overflow:hidden}</style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="${src}"></script>
  </body>
</html>
`
}

// ---------------------------------------------------------------------------
// shared arg parsing
// ---------------------------------------------------------------------------

/**
 * `[appId] [--app-dir <dir>] [--flag value] [--flag=value] [--boolean]`.
 * `booleans` names the flags that take no value, so an unknown flag never eats
 * the next argument.
 */
export function parseCommonArgs(argv, booleans = []) {
  const booleanSet = new Set(booleans)
  const out = { appId: '', appDir: '', flags: {}, positionals: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('-')) {
      out.positionals.push(a)
      continue
    }
    const eq = a.indexOf('=')
    const name = eq === -1 ? a : a.slice(0, eq)
    if (booleanSet.has(name)) {
      out.flags[name] = eq === -1 ? true : a.slice(eq + 1) !== 'false'
      continue
    }
    out.flags[name] = eq === -1 ? argv[++i] : a.slice(eq + 1)
  }
  out.appDir = out.flags['--app-dir'] || ''
  out.appId = out.flags['--app'] || out.positionals[0] || ''
  return out
}
