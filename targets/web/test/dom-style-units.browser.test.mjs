import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { withWebFixture } from './web-test-helpers.mjs'
import { preview } from 'vite'

await withWebFixture('style-units', async ({ start, page: newPage, build }) => {
  const server = await start(['--emulator', '--width', '600', '--height', '900', '--dpr', '1'])
  const page = await newPage()
  await page.goto(server.url + '/__gea_emulator')
  const frame = page.frames().find(f => f !== page.mainFrame())
  await frame.waitForSelector('#constant')
  const width = id => frame.locator('#' + id).evaluate(el => el.getBoundingClientRect().width)
  for (const scale of [1, 1.5, 2]) {
    await page.locator('#dpr').fill(String(scale))
    await page.locator('#dpr').dispatchEvent('change')
    await expect.poll(() => frame.evaluate(() => __gea_Display.getDevicePixelRatio())).toBe(scale)
    for (const id of ['constant', 'reactive', 'object', 'spread-object', 'spread-attribute', 'static-text', 'dynamic-text', 'runtime-jsx']) {
      await expect.poll(() => width(id)).toBe(150 / scale)
    }
    await frame.locator('#pointer').dispatchEvent('pointerdown', { clientX: 30 })
    await expect(frame.locator('#pointer-x')).toHaveText(String(30 * scale))
    assert.equal(await width('css'), 150)
    assert.equal(await width('relative'), 300 / scale)
    assert.deepEqual(await frame.evaluate(() => [__gea_Display.width, __gea_Display.height]), [600, 900])
    assert.deepEqual(await frame.evaluate(() => [innerWidth, innerHeight]), [600 / scale, 900 / scale])
    assert.deepEqual(await frame.locator('#unitless').evaluate(el => {
      const s = getComputedStyle(el)
      return [s.opacity, s.zIndex, s.getPropertyValue('--value'), parseFloat(s.lineHeight)]
    }), ['0.5', '3', '150', 30 / scale])
  }
  await frame.locator('#update').click()
  for (const id of ['reactive', 'object', 'spread-object', 'spread-attribute', 'dynamic-text']) {
    await expect.poll(() => width(id)).toBe(45)
  }
  assert.equal(await width('css'), 90)
  await frame.evaluate(() => __gea_Display.setDevicePixelRatio(1.5))
  await expect.poll(() => width('reactive')).toBe(60)
  assert.equal(await width('constant'), 100)
  const outDir = await build(fileURLToPath(new URL('../dist', import.meta.url)))
  const production = await preview({ configFile: false, root: fileURLToPath(new URL('./fixtures/style-units', import.meta.url)), build: { outDir }, preview: { host: '127.0.0.1', port: 0 } })
  try {
    const builtPage = await newPage()
    await builtPage.goto(production.resolvedUrls.local[0])
    await expect(builtPage.locator('#constant')).toHaveCSS('width', '150px')
    await builtPage.evaluate(() => __gea_Display.setDevicePixelRatio(2))
    for (const id of ['constant', 'reactive', 'object', 'spread-object', 'spread-attribute', 'static-text', 'dynamic-text', 'runtime-jsx']) {
      await expect(builtPage.locator('#' + id)).toHaveCSS('width', '75px')
    }
    await expect(builtPage.locator('#css')).toHaveCSS('width', '150px')
    await builtPage.locator('#update').click()
    await expect(builtPage.locator('#reactive')).toHaveCSS('width', '45px')
    await builtPage.evaluate(() => __gea_Display.setDevicePixelRatio(0))
    await expect(builtPage.locator('#reactive')).toHaveCSS('width', '90px')
  } finally {
    await new Promise((resolve, reject) => production.httpServer.close(error => error ? reject(error) : resolve()))
  }
  console.log('DOM style units: static, reactive, object/spread, strings, runtime JSX, scale changes and rendered production output passed')
}, { fixtureDir: fileURLToPath(new URL('./fixtures/style-units', import.meta.url)) })
