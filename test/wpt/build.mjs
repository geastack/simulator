// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });
const env = { ...process.env };
for (const [key, pkg] of Object.entries({ GEA_CORE: 'core', GEA_HOST_DIR: 'host', GEA_ENGINE_DIR: 'engine', GEA_ELEMENTS_DIR: 'elements', GEA_GEAOS_PACKAGE_DIR: 'geaos' })) {
  env[key] ||= path.dirname(require.resolve(`@geastack/${pkg}/package.json`));
  env[key] = path.resolve(env[key]);
}
const manifest = await import(pathToFileURL(path.join(env.GEA_CORE, 'gea_sources.mjs')));
const includes = [...manifest.includeFlags(env), `-I${root}/targets/web/include`];
const sources = [...manifest.cSources(env), ...manifest.cxxSources(env),
  ...['web_display', 'web_platform', 'web_power', 'web_storage_service', 'web_camera'].map(n => `${root}/targets/web/main/${n}.cpp`),
  `${root}/test/wpt/bridge.cpp`];
for (const source of sources) fs.accessSync(source);
const flags = ['-O1', '-DGEA_EMBEDDED_ENABLE_VIRTUAL_KEYBOARD=0', '-DGEA_EMBEDDED_HAS_GENERATED_FONTS=1', '-DGEA_EMBEDDED_TTF_RUNTIME_FONTS=1'];
function run(bin, args, capture = false) {
  const result = spawnSync(bin, args, { env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${bin} failed (${result.status})\n${result.stderr || ''}`);
  return result.stdout;
}
const compiler = process.env.EMXX || 'em++';
const cc = process.env.EMCC || 'emcc';
const identity = JSON.stringify({ version: run(compiler, ['--version'], true), includes, flags, sources });
const stamp = `${out}/wpt-build-profile.json`;
const sameProfile = fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === identity;
const objects = sources.map((_, i) => `${out}/wpt-${i}.o`);
const fresh = sameProfile ? run(process.execPath, [`${root}/targets/web/obj-up-to-date.mjs`, ...objects], true).trim().split('\n') : [];
// Serial compilation: no oversubscription or shared scratch races.
for (let i = 0; i < sources.length; i++) {
  if (fresh[i] === 'fresh') continue;
  const c = sources[i].endsWith('.c');
  console.log(`[${i + 1}/${sources.length}] ${path.basename(sources[i])}`);
  run(c ? cc : compiler, [...flags, ...includes, ...(c ? ['-DGEA_EMBEDDED_GIF_C_API'] : ['-std=c++20']), '-MD', '-MF', `${objects[i]}.d`, '-c', sources[i], '-o', objects[i]]);
}
fs.writeFileSync(stamp, identity);
run(compiler, ['-O1', ...objects, '--no-entry', '-sALLOW_MEMORY_GROWTH=1', '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=node', '-sEXPORTED_FUNCTIONS=["_malloc","_free"]', '-sEXPORTED_RUNTIME_METHODS=["ccall","HEAPU8"]', '-o', `${out}/wpt-renderer.mjs`]);
fs.writeFileSync(`${out}/wpt-build.json`, JSON.stringify({ packages: Object.fromEntries(Object.entries(env).filter(([k]) => ['GEA_CORE', 'GEA_HOST_DIR', 'GEA_ENGINE_DIR', 'GEA_ELEMENTS_DIR', 'GEA_GEAOS_PACKAGE_DIR'].includes(k))), compiler: run(compiler, ['--version'], true), flags, profile: 'simulator RGB565, CSS DPR 1, static HTML subset with pinned fonts and ASCII/degree text' }, null, 2));
console.log('Built dist/wpt-renderer.mjs using simulator display and shared framework sources.');
