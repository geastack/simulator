import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'
import { withWebFixture } from './web-test-helpers.mjs'

await withWebFixture('host-runtime', async ({ start, page: newPage, build }) => {
  async function verify(url) {
    const page = await newPage()
    await page.goto(url)
    await page.waitForFunction(() => globalThis.hostApi)
    const result = await page.evaluate(async () => {
      const api = globalThis.hostApi
      const globalMatches = Object.entries(api).every(([name, value]) => globalThis[name] === value)
      const id = api.fetchAsync('data:application/json,{"value":3}')
      const initiallyReady = api.fetchReady(id)
      const deadline = Date.now() + 5000
      while (!api.fetchReady(id)) {
        if (Date.now() > deadline) throw new Error('Fetch job did not settle')
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      const response = api.fetchResult(id)
      const json = response.json()
      const binaryMatches = new TextDecoder().decode(response.arrayBuffer()) === response.text()
      const bytes = response.bytes()
      bytes.fill(0)
      const independentBytes = response.json().value === 3
      api.fetchRelease(id)
      const context = document.createElement('canvas').getContext('2d')
      context.beginBatch()
      context.fillStyle = '#ff0000'
      context.fillRect(0, 0, 1, 1)
      context.endBatch()
      context.flush()
      return { globalMatches, initiallyReady, json, binaryMatches, independentBytes,
        released: !api.fetchReady(id), pixel: Array.from(context.getImageData(0, 0, 1, 1).data) }
    })
    assert.deepEqual(result, { globalMatches: true, initiallyReady: false, json: { value: 3 },
      binaryMatches: true, independentBytes: true, released: true, pixel: [255, 0, 0, 255] })
    await page.close()
  }
  const server = await start()
  await verify(server.url)
  const outDir = await build(fileURLToPath(new URL('../dist', import.meta.url)))
  const production = await preview({ configFile: false, root: fileURLToPath(new URL('./fixtures/host-runtime', import.meta.url)), build: { outDir }, preview: { host: '127.0.0.1', port: 0 } })
  try {
    await verify(production.resolvedUrls.local[0])
  } finally {
    await new Promise((resolve, reject) => production.httpServer.close(error => error ? reject(error) : resolve()))
  }
  console.log('Browser host runtime: imported/global fetch jobs and canvas batching passed in development and production')
}, { fixtureDir: fileURLToPath(new URL('./fixtures/host-runtime', import.meta.url)) })
