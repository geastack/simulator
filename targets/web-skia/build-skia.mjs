#!/usr/bin/env node
// Builds the Gea app in the current directory for the web-skia target:
//   <app>/.gea/build/web-skia/public/apps/<id>/{module.wasm,module.js,<Family>.ttf}
// It runs the web target's build-web.sh with the web-skia profile, then writes
// the TTFs the engine measured text with (extracted from the generated font
// unit, so they are byte-identical) next to module.wasm, named as the list's
// font table names them. An app.json beside the app's package.json is copied
// into the bundle as is; the target does not interpret it.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import zlib from 'node:zlib'

const here = path.dirname(fileURLToPath(import.meta.url))
const simulatorDir = path.resolve(here, '..', '..')

function resolveCliDir() {
  if (process.env.GEA_CLI_DIR) return path.resolve(process.env.GEA_CLI_DIR)
  for (const base of [process.cwd(), simulatorDir]) {
    try {
      return path.dirname(createRequire(path.join(base, 'package.json')).resolve('@geastack/cli/package.json'))
    } catch {}
  }
  const sibling = path.resolve(simulatorDir, '..', 'cli')
  if (fs.existsSync(path.join(sibling, 'src', 'build-config.mjs'))) return sibling
  throw new Error('Cannot resolve @geastack/cli; set GEA_CLI_DIR')
}

const cliDir = resolveCliDir()
const { findCurrentApp } = await import(pathToFileURL(path.join(cliDir, 'src', 'manifest.mjs')).href)
const { nativeScriptBuildEnv } = await import(pathToFileURL(path.join(cliDir, 'src', 'build-config.mjs')).href)

const app = findCurrentApp(process.cwd())
if (!app) throw new Error('Run inside a Gea app folder')
if (!app.targets?.web) throw new Error(`'${app.id}' does not declare gea.targets.web`)

const root = path.join(app.root, '.gea', 'build', 'web-skia')
const generatedRoot = path.join(root, 'generated')
const publicRoot = path.join(root, 'public', 'apps')
const distRoot = path.join(root, 'dist')
const env = {
  ...nativeScriptBuildEnv(app, 'web', process.env, { buildDir: root }),
  GEA_WEB_GENERATED_ROOT: generatedRoot,
  GEA_WEB_DIST_ROOT: distRoot,
  GEA_WEB_PUBLIC_ROOT: publicRoot,
  GEA_WEB_OBJCACHE_DIR: process.env.GEA_WEB_OBJCACHE_DIR || path.join(os.homedir(), '.geastack', 'web-objcache'),
  GEA_HEAVY_BUILD_LOCK_PATH: path.join(root, 'heavy-build.lock'),
  GEA_WEB_TARGET_PROFILE: path.join(here, 'profile.sh'),
  GEA_SKIA_DEFAULT_FONT: path.join(cliDir, 'starters', 'fonts', 'Inter-Regular.ttf')
}

const result = spawnSync('bash', [path.join(simulatorDir, 'targets', 'web', 'build-web.sh'), app.id], { cwd: app.root, env, stdio: 'inherit' })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

const bundleDir = path.join(publicRoot, app.id)
fs.copyFileSync(path.join(distRoot, app.id, 'module.js'), path.join(bundleDir, 'module.js'))
for (const entry of fs.readdirSync(bundleDir)) {
  if (/\.(ttf|otf)$/i.test(entry)) fs.rmSync(path.join(bundleDir, entry))
}
for (const font of runtimeFonts(path.join(generatedRoot, app.id, 'gea_embedded_font_generated.cpp'))) {
  fs.writeFileSync(path.join(bundleDir, `${font.family}.ttf`), font.data)
  console.log(`  font: ${font.family}.ttf (${font.data.length} bytes)`)
}
const appJson = path.join(app.root, 'app.json')
if (fs.existsSync(appJson)) fs.copyFileSync(appJson, path.join(bundleDir, 'app.json'))
else fs.rmSync(path.join(bundleDir, 'app.json'), { force: true })
console.log(`Done: ${app.id} web-skia bundle -> ${bundleDir}`)

function runtimeFonts(file) {
  const source = fs.readFileSync(file, 'utf8')
  const families = new Map([...source.matchAll(/\{ (\d+), ("(?:[^"\\]|\\.)*") \},/g)].map((m) => [Number(m[1]), JSON.parse(m[2])]))
  const deflated = new Map(
    [...source.matchAll(/const std::uint8_t gea_runtime_ttf_(\d+)_deflated\[\d+\] = \{([^}]*)\};/g)].map((m) => [
      Number(m[1]),
      Buffer.from(m[2].match(/0x[0-9a-f]{2}/gi).map((hex) => parseInt(hex, 16)))
    ])
  )
  return [...source.matchAll(/\{ (\d+), gea_runtime_ttf_(\d+)_deflated,/g)].map((m) => ({
    family: families.get(Number(m[1])),
    data: zlib.inflateSync(deflated.get(Number(m[2])))
  }))
}
