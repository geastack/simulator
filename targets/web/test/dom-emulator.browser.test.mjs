import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { withWebFixture } from './web-test-helpers.mjs'

await withWebFixture('dom-emulator', async ({ write, start, page: newPage, build }) => {
  write('index.html', '<!doctype html><html><head><meta name="custom" content="preserved"></head><body><aside>Custom HTML</aside><div id="app"></div><script type="module" src="/entry.tsx"></script></body></html>')
  write('entry.tsx', "import { mount } from '@geastack/core'; import { App } from '@app'; import './style.css'; mount(App)")
  // The legacy config must never enter this web pipeline.
  write('vite.config.mjs', "throw new Error('embedded config loaded')")
  write('vite.web.config.mjs', `export default {
    base: '/preview/',
    resolve: { alias: { '@app': ${JSON.stringify('./components/App.tsx')} } },
    plugins: [{ name: 'gea-plugin', transform() { throw new Error('duplicate Gea transform') } }, { name: 'web-config-test', transformIndexHtml(html) { return html.replace('Custom HTML', 'Configured HTML') } }]
  }`)
  const component = (label) => `import { ReactiveComponent } from '@geastack/core'
  export class App extends ReactiveComponent {
    count = 0
    template() { return <button class="probe" onClick={() => this.count++}>${label}: {this.count}</button> }
  }`
  write('components/App.tsx', component('before'))
  write('style.css', '.probe { color: rgb(255, 0, 0); }')
  const server = await start(['--emulator', '--width', '320', '--height', '480', '--dpr', '2'])
  const page = await newPage()
  const requests = []
  page.on('request', (req) => requests.push(req.url()))
  await page.goto(`${server.url}/preview/__gea_emulator`)
  const app = page.frameLocator('iframe')
  await expect(app.locator('aside')).toHaveText('Configured HTML')
  await expect(app.locator('.probe')).toHaveCSS('color', 'rgb(255, 0, 0)')
  const frame = page.frames().find((frame) => frame !== page.mainFrame())
  assert.deepEqual(await frame.evaluate(() => [innerWidth, innerHeight, __gea_Display.getDevicePixelRatio()]), [320, 480, 2])
  assert.deepEqual(await frame.evaluate(() => [__gea_Camera.isAvailable(), __gea_Camera.open(), __gea_Camera.deviceCount]), [false, false, 0])
  await app.locator('.probe').click()
  await frame.evaluate(() => { window.sentinel = 'same-app' })
  await page.evaluate(() => { window.sentinel = 'same-shell' })
  write('style.css', '.probe { color: rgb(0, 0, 255); }')
  await expect(app.locator('.probe')).toHaveCSS('color', 'rgb(0, 0, 255)')
  for (const label of ['after', 'again', 'final']) {
    write('components/App.tsx', component(label))
    await expect(app.locator('.probe')).toHaveText(`${label}: 1`)
  }
  await app.locator('.probe').click()
  await expect(app.locator('.probe')).toHaveText('final: 2')
  assert.equal(await frame.evaluate(() => window.sentinel), 'same-app')
  assert.equal(await page.evaluate(() => window.sentinel), 'same-shell')
  await page.locator('#width').fill('400')
  await page.locator('#width').dispatchEvent('change')
  await page.locator('#zoom').fill('0.5')
  await page.locator('#zoom').dispatchEvent('change')
  await page.locator('#dpr').fill('3')
  await page.locator('#dpr').dispatchEvent('change')
  await expect.poll(() => frame.evaluate(() => [innerWidth, __gea_Display.width, __gea_Display.getDevicePixelRatio()])).toEqual([400, 400, 3])
  await expect(page.locator('#device')).toHaveCSS('width', '200px')
  assert.equal(await frame.evaluate(() => window.sentinel), 'same-app')
  assert.equal(requests.some((url) => /\.wasm(?:$|\?)/.test(url)), false)
  const out = await build()
  const html = readFileSync(join(out, 'index.html'), 'utf8')
  assert.match(html, /Configured HTML/)
  assert.match(html, /\/preview\/assets\//)
  assert.match(html, /name="custom" content="preserved"/)
  const assets = readdirSync(join(out, 'assets'))
  assert.ok(assets.some((name) => name.endsWith('.css')))
  const output = html + assets.filter((name) => name.endsWith('.js')).map((name) => readFileSync(join(out, 'assets', name), 'utf8')).join('')
  assert.doesNotMatch(output, /@vite\/client|__gea_emulator|Gea DOM emulator|\.wasm/)
  console.log('DOM emulator: custom HTML/config, CSS and component HMR, viewport, production isolation passed')
})
