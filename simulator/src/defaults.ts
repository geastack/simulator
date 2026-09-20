export const DEFAULT_ZOOM = 1
export const DEFAULT_DEVICE_PIXEL_RATIO = 1.5
export const MIN_DEVICE_PIXEL_RATIO = 1
export const MAX_DEVICE_PIXEL_RATIO = 3

export function clampDevicePixelRatio(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_DEVICE_PIXEL_RATIO
  return Math.max(MIN_DEVICE_PIXEL_RATIO, Math.min(MAX_DEVICE_PIXEL_RATIO, value))
}
