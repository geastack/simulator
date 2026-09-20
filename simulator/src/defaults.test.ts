import { describe, expect, it } from 'vitest'
import { clampDevicePixelRatio, DEFAULT_DEVICE_PIXEL_RATIO, DEFAULT_ZOOM } from './defaults'

describe('simulator defaults', () => {
  it('uses 1x as the default zoom', () => {
    expect(DEFAULT_ZOOM).toBe(1)
  })

  it('uses 1.5x as the default device pixel ratio', () => {
    expect(DEFAULT_DEVICE_PIXEL_RATIO).toBe(1.5)
  })

  it('keeps simulator device pixel ratio between 1x and 3x', () => {
    expect(clampDevicePixelRatio(0.75)).toBe(1)
    expect(clampDevicePixelRatio(2.25)).toBe(2.25)
    expect(clampDevicePixelRatio(4)).toBe(3)
  })

  it('falls back to the default device pixel ratio for invalid values', () => {
    expect(clampDevicePixelRatio(Number.NaN)).toBe(DEFAULT_DEVICE_PIXEL_RATIO)
  })
})
