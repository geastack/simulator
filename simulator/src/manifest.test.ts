import { describe, expect, it } from 'vitest'
import { WEB_APP_IDS, isWebGeaApp } from './manifest'

describe('manifest helpers', () => {
  it('lists only gea web apps', () => {
    expect(WEB_APP_IDS).toContain('static-card')
    expect(WEB_APP_IDS).toContain('tic-tac-toe')
    expect(WEB_APP_IDS).toContain('bouncing-balls')
    expect(WEB_APP_IDS).not.toContain('gea-companion')
    expect(WEB_APP_IDS).not.toContain('ios-device-showcase')
  })

  it('handles non-web and incomplete entries', () => {
    expect(
      isWebGeaApp({
        id: 'native-only',
        root: 'examples/native-only',
        entry: 'index.ts',
        runtime: 'gea'
      })
    ).toBe(false)
    expect(
      isWebGeaApp({
        id: 'web-app',
        root: 'examples/web-app',
        entry: 'index.ts',
        runtime: 'gea',
        targets: { web: { enabled: true } }
      })
    ).toBe(true)
  })
})
