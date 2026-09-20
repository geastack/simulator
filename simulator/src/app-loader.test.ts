import { describe, expect, it } from 'vitest'
import { getAppScriptUrl, getModuleAssetUrl, getModuleDevImportUrl, getModuleImportKey, getModuleWasmUrl } from './app-loader'

describe('app loader paths', () => {
  it('loads wasm modules from the web build output instead of public assets', () => {
    expect(getModuleImportKey('static-card')).toBe('../../targets/web/dist/static-card/module.js')
  })

  it('can address freshly built modules outside the stale glob map in dev', () => {
    expect(getModuleDevImportUrl('static-card')).toMatch(/static-card\/module\.js$/)
  })

  it('keeps the thin app bundle in public assets', () => {
    expect(getAppScriptUrl('static-card', '123')).toBe('/apps/static-card/app.js?v=123')
  })

  it('loads the wasm binary from the simulator public assets', () => {
    expect(getModuleWasmUrl('static-card')).toBe('/apps/static-card/module.wasm')
  })

  it('loads preloaded filesystem data from the app public assets', () => {
    expect(getModuleAssetUrl('e-reader', 'module.data')).toBe('/apps/e-reader/module.data')
    expect(getModuleAssetUrl('e-reader', 'module.data', '123')).toBe('/apps/e-reader/module.data?v=123')
  })

  it('can cache-bust the wasm binary for local rebuilds', () => {
    expect(getModuleWasmUrl('static-card', '123')).toBe('/apps/static-card/module.wasm?v=123')
  })
})
