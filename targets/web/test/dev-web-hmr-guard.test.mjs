import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const devServer = resolve(webRoot, 'dev-web.mjs')
const appDir = resolve(webRoot, '../../../examples/apps/counter-jsx')
const toolchain = resolve(webRoot, '../../../examples/node_modules/@geastack/core')

if (!existsSync(appDir) || !existsSync(toolchain)) {
  console.log(`dev-web-hmr-guard: skipped, no installed gea app at ${appDir}`)
  process.exit(0)
}

async function freePort() {
  const probe = net.createServer()
  await new Promise((r) => probe.listen(0, '127.0.0.1', r))
  const { port } = probe.address()
  await new Promise((r) => probe.close(r))
  return port
}

async function startDevServer(port) {
  const child = spawn('node', [devServer, '--app-dir', appDir, '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = []
  child.stdout.on('data', (d) => output.push(String(d)))
  child.stderr.on('data', (d) => output.push(String(d)))
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (output.join('').includes('Local:')) return child
    if (child.exitCode !== null) throw new Error(`dev server exited:\n${output.join('')}`)
    await new Promise((r) => setTimeout(r, 250))
  }
  child.kill('SIGKILL')
  throw new Error(`dev server never listened:\n${output.join('')}`)
}

const port = await freePort()
const server = await startDevServer(port)
try {
  const response = await fetch(`http://127.0.0.1:${port}/components/App.tsx`)
  assert.equal(response.status, 200)
  const served = (await response.text()).split('//# sourceMappingURL')[0]
  const code = served.replace(/\s+/g, ' ')

  const selfAccept = /import\.meta\.hot\.accept\(\(?newModule\)? =>/.exec(code)
  assert.ok(selfAccept, 'the served component lost its HMR self-accept')
  const nextAccept = code.indexOf('import.meta.hot.accept(', selfAccept.index + 1)
  const acceptBody = nextAccept === -1 ? code.slice(selfAccept.index) : code.slice(selfAccept.index, nextAccept)

  assert.ok(acceptBody.includes('let __patched = false'), 'self-accept does not track whether anything was patched')
  assert.match(
    acceptBody,
    /__patched = handleComponentUpdate\([\s\S]*?\) \|\| __patched/,
    'self-accept discards the handleComponentUpdate result',
  )
  assert.match(
    acceptBody,
    /if \(!__patched\) import\.meta\.hot\.invalidate\(\)/,
    'an unpatchable update is swallowed instead of invalidating',
  )

  console.log('dev-web serves components whose HMR self-accept invalidates when nothing could be patched')
} finally {
  server.kill('SIGTERM')
}
