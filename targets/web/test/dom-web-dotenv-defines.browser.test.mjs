import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { fetchText, waitFor, withWebFixture } from './web-test-helpers.mjs'

await withWebFixture('dotenv-app', async ({ write, edit, start, build, page: newPage }) => {
  const env = (value) => `GEA_TEST_GREETING=${value}\nGEA_TEST_UNREFERENCED=unreferenced-secret\n`
  write('.env', env('before-review'))
  write('.env.example', 'GEA_TEST_GREETING=\nGEA_TEST_OPTIONAL=\n')
  write('index.tsx', "import { mount } from '@geastack/core'\nimport { App } from './components/App'\nmount(App)\n")
  write('values.ts', `
function local(process) { return process?.env.GEA_TEST_GREETING }
const processValue = process?.env.GEA_TEST_GREETING
const spaced = process . env.GEA_TEST_GREETING
const meta = import.meta . env.GEA_TEST_GREETING
const optional = import.meta.env?.GEA_TEST_GREETING
export const values = [processValue, spaced, meta, optional, local({ env: { GEA_TEST_GREETING: 'local-value' } })].join('|')
export const contract = () => import.meta.env.GEA_TEST_ADDED
`)
  write('components/App.tsx', `import { values, contract } from '../values'
export function App() {
 return <div class="greeting" data-env={JSON.stringify(import.meta.env)} data-contract={String(contract())} title={'optional<' + process.env.GEA_TEST_OPTIONAL + '>'}>{values}</div>
}`)
  write('decorated.ts', 'function identity(target) { return target }\n@identity export class Example { value = process.env.GEA_TEST_GREETING }')
  const server = await start()
  const decorated = (await fetchText(`${server.url}/decorated.ts`)).split('//# sourceMappingURL')[0]
  assert.ok(decorated.includes('before-review'))
  assert.ok(!decorated.includes('process.env.GEA_TEST_GREETING'))
  const page = await newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const expected = (value) => [value, value, value, value, 'local-value'].join('|')
  await page.goto(server.url)
  await expect(page.locator('.greeting')).toHaveText(expected('before-review'))
  await expect(page.locator('.greeting')).toHaveAttribute('title', 'optional<>')
  const envCode = await fetchText(`${server.url}/@vite/env`)
  assert.ok(!envCode.includes('GEA_TEST_'))
  assert.ok(!envCode.includes('before-review'))

  await edit('.env', env('after-review'))
  await expect(page.locator('.greeting')).toHaveText(expected('after-review'))
  await expect(page.locator('.greeting')).toHaveAttribute('data-contract', 'undefined')
  await edit('.env.example', 'GEA_TEST_GREETING=\nGEA_TEST_OPTIONAL=\nGEA_TEST_ADDED=\n')
  await expect(page.locator('.greeting')).toHaveAttribute('data-contract', '')
  await waitFor(async () => (await fetchText(`${server.url}/values.ts`)).includes('after-review'))
  assert.ok(!(await fetchText(`${server.url}/components/App.tsx`)).includes('unreferenced-secret'))
  await server.stop()

  const outDir = await build()
  const assets = readdirSync(join(outDir, 'assets')).filter((file) => file.endsWith('.js'))
  assert.ok(assets.length)
  const code = assets.map((file) => readFileSync(join(outDir, 'assets', file), 'utf8')).join('\n')
  assert.ok(!code.includes('unreferenced-secret'))
  // Serve the emitted assets through browser routing to execute the production
  // define pass as well as the source inliner.
  await page.route('http://production.test/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    const file = pathname === '/' ? 'index.html' : pathname.slice(1)
    await route.fulfill({ body: readFileSync(join(outDir, file)), contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' })
  })
  await page.goto('http://production.test/')
  await expect(page.locator('.greeting')).toHaveText(expected('after-review'))
  await expect(page.locator('.greeting')).toHaveAttribute('title', 'optional<>')
  await expect(page.locator('.greeting')).toHaveAttribute('data-contract', '')
  assert.ok(!(await page.locator('.greeting').getAttribute('data-env')).includes('unreferenced-secret'))
  assert.deepEqual(errors, [])
  console.log('dotenv values refresh live and preserve optional chaining and local scope in dev and build')
})
