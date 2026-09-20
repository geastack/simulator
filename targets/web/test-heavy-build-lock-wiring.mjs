import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(new URL('./build-web.sh', import.meta.url))
const script = readFileSync(scriptPath, 'utf8')

assert.match(script, /source "\$CORE_DIR\/scripts\/heavy-build-lock\.sh"/)

const acquire = script.indexOf('gea_acquire_heavy_build_lock "$HEAVY_BUILD_LOCK_PATH" web "$APP_ID"')
const generatedOutput = script.indexOf('GENERATED_DIR=', acquire)
const link = script.lastIndexOf('\nemcc $OPT \\\n')
const publish = script.indexOf('cp "$DIST_DIR/module.wasm" "$PUBLIC_DIR/module.wasm"')

assert.ok(acquire >= 0, 'web builds should acquire the workspace resource lock')
assert.ok(generatedOutput > acquire, 'the resource lock should precede generated-output paths and mutations')
assert.ok(link > generatedOutput, 'the resource lock should cover Emscripten linking')
assert.ok(publish > link, 'the resource lock should cover WASM publication')
assert.match(script.slice(acquire, generatedOutput), /trap gea_release_heavy_build_lock EXIT/)

console.log('web heavy-build lock wiring tests passed')
