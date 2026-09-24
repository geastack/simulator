import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { fetchText, waitFor, withWebFixture } from './web-test-helpers.mjs'

await withWebFixture('hmr-app', async ({ write, start, page: newPage }) => {
  write('index.tsx', "import { mount } from '@geastack/core'\nimport { App } from './components/App'\nmount(App)\n")
  const reactive = (label) => `import { ReactiveComponent } from '@geastack/core'
export class App extends ReactiveComponent {
  count = 0
  template() { return <button class="count" onClick={() => this.count++}>${label}: {this.count}</button> }
}`
  write('components/App.tsx', reactive('before'))
  const server = await start()
  const served = (await fetchText(`${server.url}/components/App.tsx`)).split('//# sourceMappingURL')[0]
  assert.match(served, /if \(!__patched\) import\.meta\.hot\.invalidate\(\)/)
  const page = await newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(server.url)
  await page.locator('.count').click()
  await expect(page.locator('.count')).toHaveText('before: 1')
  await page.evaluate(() => { window.hmrSentinel = 'same-page' })
  write('components/App.tsx', reactive('after'))
  await expect(page.locator('.count')).toHaveText('after: 1')
  assert.equal(await page.evaluate(() => window.hmrSentinel), 'same-page', 'reactive edit reloaded the page')
  await page.locator('.count').click()
  await expect(page.locator('.count')).toHaveText('after: 2')

  // Establish a fresh static mount before testing its edit/fallback path.
  const staticComponent = (label) => `export function App() { return <p class="static">${label}</p> }`
  write('components/App.tsx', staticComponent('static-before'))
  await waitFor(async () => (await fetchText(`${server.url}/components/App.tsx`)).includes('static-before'))
  await page.reload()
  await expect(page.locator('.static')).toHaveText('static-before')
  await page.evaluate(() => { window.hmrSentinel = 'before-fallback' })
  write('components/App.tsx', staticComponent('static-after'))
  await expect(page.locator('.static')).toHaveText('static-after')
  assert.equal(await page.evaluate(() => window.hmrSentinel), undefined, 'unpatchable static edit did not reload')
  assert.deepEqual(errors, [])
  console.log('dev-web updates reactive components and reloads static components')
})
