// The web build resolves @geastack/core, @geastack/compiler and @geastack/cli
// through each package's own package.json. A package whose exports map does
// not expose "./package.json" fails that resolution exactly like a package
// that was never installed -- and for months this script discarded node's
// stderr, so the two were indistinguishable. @geastack/cli shipped without the
// export, the web-WASM CI step reported a CLI it had in fact installed as
// unresolvable, and reading the build log could not tell you which fix applied.
//
// This asserts the resolver keeps the reason. The success path must return a
// real directory; both failure paths must return nothing on stdout and say on
// stderr WHICH failure it was.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const script = readFileSync(resolve(webRoot, 'build-web-noregen.sh'), 'utf8')

const marker = '# --- end resolve_gea_dir (the test sources everything above this marker) ---'
assert.ok(script.includes(marker), 'build-web-noregen.sh lost the resolver end marker')
const helper = script.slice(script.indexOf('resolve_gea_dir() {'), script.indexOf(marker))
assert.ok(helper.includes('printf'), 'resolver body did not extract')

// Fixtures go in the build output this target already owns -- no new directory,
// nothing outside the repository, and gitignored like the rest of dist/.
const fixtures = resolve(webRoot, 'dist', '.resolve-gea-dir-fixtures')
const install = (name, exports) => {
  const dir = resolve(fixtures, 'node_modules', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', exports }))
  writeFileSync(resolve(dir, 'index.mjs'), 'export default 1\n')
}

// spawnSync, not execFileSync: the resolver exits 0 on a resolution failure so
// the guard in the build script owns the exit, which means stderr is the only
// place the reason lives and it has to be captured on a SUCCESSFUL exit too.
const run = (name, script) => {
  const result = spawnSync('bash', ['-c', `set -euo pipefail\n${helper}\n${script}`, 'bash', name, fixtures], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, `bash failed: ${result.stderr}`)
  return { stdout: result.stdout, stderr: result.stderr }
}

try {
  rmSync(fixtures, { recursive: true, force: true })
  install('open-exports', { '.': './index.mjs', './package.json': './package.json' })
  install('blocked-exports', { '.': './index.mjs' })

  // 1. The package exposes ./package.json: the resolver answers with its directory.
  const found = run('open-exports', 'resolve_gea_dir "$1" "$2"')
  assert.equal(found.stdout, resolve(fixtures, 'node_modules', 'open-exports'))
  assert.equal(found.stderr, '', 'a successful resolution must stay quiet')

  // 2. Installed, but the exports map blocks ./package.json. Nothing on stdout,
  //    and the exports map is named as the cause -- this is the @geastack/cli case.
  const blocked = run('blocked-exports', 'printf \'STDOUT:%s\' "$(resolve_gea_dir "$1" "$2")"')
  assert.equal(blocked.stdout, 'STDOUT:', 'a blocked exports map must yield no directory')
  assert.match(blocked.stderr, /blocked-exports/)
  assert.match(blocked.stderr, /exports/, 'the exports map must be named as the cause')

  // 3. Genuinely not installed. Also empty, but a DIFFERENT reason, so a build
  //    log distinguishes "republish the package" from "run npm install".
  const missing = run('never-installed', 'printf \'STDOUT:%s\' "$(resolve_gea_dir "$1" "$2")"')
  assert.equal(missing.stdout, 'STDOUT:', 'an uninstalled package must yield no directory')
  assert.match(missing.stderr, /Cannot find module|Cannot resolve/)
  assert.doesNotMatch(missing.stderr, /is not defined by "exports"/)

  console.log('resolve_gea_dir keeps node\'s reason: exports-blocked and not-installed stay distinguishable')
} finally {
  rmSync(fixtures, { recursive: true, force: true })
}
