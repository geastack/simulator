import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function waitFor(check, timeout = 30_000, assertAlive = () => {}) {
  const deadline = Date.now() + timeout
  let lastError
  do {
    assertAlive()
    try { if (await check()) return } catch (error) { lastError = error }
    await delay(100)
  } while (Date.now() < deadline)
  throw new Error('Timed out waiting for test condition', { cause: lastError })
}

export async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.text()
}

async function freePort() {
  const probe = net.createServer()
  await new Promise((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const { port } = probe.address()
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))
  return port
}

function launch(script, args) {
  const child = spawn(process.execPath, [join(webRoot, script), ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  let failure
  let closed = false
  child.stdout.on('data', (data) => { output += data })
  child.stderr.on('data', (data) => { output += data })
  child.on('error', (error) => { failure = error; output += `\n${error.stack || error.message}` })
  const done = new Promise((resolve) => child.once('close', (code) => { closed = true; resolve(code) }))
  return {
    done,
    get output() { return output },
    check() {
      if (failure) throw failure
      if (closed) throw new Error(`Child process exited:\n${output}`)
    },
    async stop() {
      if (closed) return
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 3_000)
      try { await done } finally { clearTimeout(timer) }
    },
  }
}

export async function withWebFixture(name, run) {
  const appDir = mkdtempSync(join(tmpdir(), `gea-${name}-`))
  const children = []
  let browser
  try {
    mkdirSync(join(appDir, 'components'))
    symlinkSync(resolve(webRoot, '../../node_modules'), join(appDir, 'node_modules'), 'junction')
    writeFileSync(join(appDir, 'package.json'), JSON.stringify({
      name, type: 'module', gea: { id: name, entry: 'index.tsx', runtime: 'gea', targets: { web: true } },
    }))
    await run({
      appDir,
      write(file, source) { writeFileSync(join(appDir, file), source) },
      async start(args = []) {
        const port = await freePort()
        const child = launch('dev-web.mjs', ['--app-dir', appDir, '--host', '127.0.0.1', '--port', String(port), ...args])
        children.push(child)
        const url = `http://127.0.0.1:${port}`
        try {
          await waitFor(async () => {
            // Probe HTTP directly: Vite's colored CI output splits "Local:" with ANSI codes.
            await fetchText(url)
            return true
          }, 60_000, () => child.check())
        } catch (error) {
          throw new Error(`Dev server startup failed:\n${child.output}`, { cause: error })
        }
        return { url, stop: () => child.stop() }
      },
      async page() {
        browser ||= await chromium.launch({ headless: true })
        const page = await browser.newPage()
        page.setDefaultTimeout(15_000)
        page.setDefaultNavigationTimeout(15_000)
        return page
      },
      async build() {
        const outDir = join(appDir, 'site')
        const child = launch('build-dom-web.mjs', ['--app-dir', appDir, '--out-dir', outDir])
        children.push(child)
        let timer
        try {
          const code = await Promise.race([
            child.done,
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Build timed out')), 60_000) }),
          ])
          if (code !== 0) throw new Error(`Build failed (${code}):\n${child.output}`)
        } finally { clearTimeout(timer); await child.stop() }
        return outDir
      },
    })
  } finally {
    try { await browser?.close() } finally {
      await Promise.all(children.map((child) => child.stop()))
      rmSync(appDir, { recursive: true, force: true })
    }
  }
}
