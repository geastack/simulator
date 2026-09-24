import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { fetchText, waitFor, withWebFixture } from './web-test-helpers.mjs'

await withWebFixture('hmr-app', async ({ write, edit, start, page: newPage }) => {
  write('index.tsx', "import { mount } from '@geastack/core'\nimport { App } from './components/App'\nmount(App)\n")
  const reactive = (label) => `import { ReactiveComponent } from '@geastack/core'
export class App extends ReactiveComponent {
  count = 0
  template() { return <button class="count" onClick={() => this.count++}>${label}: {this.count}</button> }
}`
  write('components/App.tsx', reactive('before'))
  const server = await start()
  const served = (await fetchText(`${server.url}/components/App.tsx`)).split('//# sourceMappingURL')[0]
  assert.match(served, /if \((?:__incompatible \|\| )?!__patched\) import\.meta\.hot\.invalidate\(\)/)
  const page = await newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(server.url)
  await page.locator('.count').click()
  await expect(page.locator('.count')).toHaveText('before: 1')
  await page.evaluate(() => { window.hmrSentinel = 'same-page' })
  await edit('components/App.tsx', reactive('after'))
  await expect(page.locator('.count')).toHaveText('after: 1')
  assert.equal(await page.evaluate(() => window.hmrSentinel), 'same-page', 'reactive edit reloaded the page')
  await page.locator('.count').click()
  await expect(page.locator('.count')).toHaveText('after: 2')

  // A runtime-base change must reload, while subsequent static edits patch.
  const staticComponent = (label) => `export function App() { return <p class="static">${label}</p> }`
  await edit('components/App.tsx', staticComponent('static-before'))
  await waitFor(async () => (await fetchText(`${server.url}/components/App.tsx`)).includes('static-before'))
  await expect(page.locator('.static')).toHaveText('static-before')
  assert.equal(await page.evaluate(() => window.hmrSentinel), undefined, 'incompatible edit did not reload')
  await page.evaluate(() => { window.hmrSentinel = 'before-fallback' })
  await edit('components/App.tsx', staticComponent('static-after'))
  await expect(page.locator('.static')).toHaveText('static-after')
  assert.equal(await page.evaluate(() => window.hmrSentinel), 'before-fallback', 'static edit reloaded the page')
  assert.deepEqual(errors, [])
  console.log('dev-web hot updates reactive and static components')
})

await withWebFixture('nested-hmr', async ({ write, edit, start, page: newPage }) => {
  write('index.tsx', "import { mount } from '@geastack/core'; import { App } from './components/App'; mount(App)")
  const parent = (label) => `import { ReactiveComponent } from '@geastack/core'
    import { Child } from './Child'
    export class App extends ReactiveComponent {
      count = 0
      template() { return <div><button class="parent" onClick={() => this.count++}>${label}: {this.count}</button><Child value={this.count} /></div> }
    }`
  const child = (label) => `export function Child({ value }) { return <span class="child">${label}: {value}</span> }`
  write('components/App.tsx', parent('parent'))
  write('components/Child.tsx', child('child-before'))
  const server = await start()
  const page = await newPage()
  await page.goto(server.url)
  await expect(page.locator('.child')).toHaveText('child-before: 0')
  await page.locator('.parent').click()
  await page.evaluate(() => { window.sentinel = 'preserved'; window.oldButton = document.querySelector('.parent') })
  await edit('components/Child.tsx', child('child-after'))
  await expect(page.locator('.child')).toHaveText('child-after: 1')
  await expect(page.locator('.parent')).toHaveText('parent: 1')
  await edit('components/App.tsx', parent('updated-parent'))
  await expect(page.locator('.parent')).toHaveText('updated-parent: 1')
  await expect(page.locator('.child')).toHaveText('child-after: 1')
  await page.locator('.parent').click()
  await expect(page.locator('.parent')).toHaveText('updated-parent: 2')
  assert.equal(await page.evaluate(() => window.oldButton.textContent), 'parent: 1', 'detached bindings still subscribed')
  await edit('components/Child.tsx', child('child-final'))
  await expect(page.locator('.child')).toHaveText('child-final: 2')
  assert.equal(await page.evaluate(() => window.sentinel), 'preserved')
  await edit('components/Child.tsx', 'export function Child() { return <span>')
  await expect(page.locator('vite-error-overlay')).toHaveCount(1)
  await edit('components/Child.tsx', child('recovered'))
  await expect(page.locator('.child')).toHaveText('recovered: 2')
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  assert.equal(await page.evaluate(() => window.sentinel), 'preserved')
  console.log('nested HMR preserves parent state, disposes old bindings, and recovers from syntax errors')
})
