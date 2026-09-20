import { describe, expect, it, vi } from 'vitest'

import {
  APP_RUNTIME_WASM_EXPORTS,
  APP_POINTER_DOWN,
  dispatchAppFrame,
  dispatchAppPointerEvent,
  getMirrorSchema,
  hitTestApp,
  initializeAppRuntime,
  setMirrorScroll,
  setAppWifi,
  setAppWifiScan
} from './app-runtime'

describe('app runtime', () => {
  it('exposes the wasm entrypoints used by the simulator', () => {
    expect(APP_RUNTIME_WASM_EXPORTS).toEqual([
      'app_init',
      'app_frame',
      'app_dispatch_key_down',
      'app_dispatch_pointer_event',
      'app_dispatch_pointer_event2',
      'app_hit_test',
      'app_touch_down',
      'app_touch_up',
      'app_touch_move',
      'app_mirror_set_int',
      'app_mirror_set_string',
      'app_mirror_set_array_len',
      'app_mirror_set_array_int',
      'app_mirror_set_scroll',
      'app_mirror_commit',
      'app_mirror_get_field_count',
      'app_mirror_get_schema_hash',
      'gea_embedded_imu_web_set_tilt',
      'gea_embedded_wifi_web_set_state',
      'gea_embedded_wifi_web_set_scan_count',
      'gea_embedded_wifi_web_set_scan_entry'
    ])
  })

  it('initializes the wasm app through asyncified app_init', async () => {
    const ccall = vi.fn(() => 0)

    await initializeAppRuntime({ ccall }, 410, 502, 1.5)

    expect(ccall).toHaveBeenCalledWith(
      'app_init',
      'number',
      ['number', 'number', 'number'],
      [410, 502, 1.5],
      { async: true }
    )
  })

  it('throws when asyncified app_init reports an initialization error', async () => {
    const ccall = vi.fn(() => 3)

    await expect(initializeAppRuntime({ ccall }, 410, 502, 1.5)).rejects.toThrow(
      'WASM app initialization failed with code 3'
    )
  })

  it('dispatches animation frames through asyncified app_frame', async () => {
    const ccall = vi.fn(() => 0)

    await dispatchAppFrame({ ccall })

    expect(ccall).toHaveBeenCalledWith(
      'app_frame',
      null,
      ['number'],
      [expect.any(Number)],
      { async: true }
    )
  })

  it('dispatches pointer events through asyncified wasm entrypoints', async () => {
    const ccall = vi.fn(() => 0)

    await dispatchAppPointerEvent({ ccall }, APP_POINTER_DOWN, 8, 120, 220)

    expect(ccall).toHaveBeenNthCalledWith(
      1,
      'app_dispatch_pointer_event',
      null,
      ['number', 'number', 'number', 'number'],
      [APP_POINTER_DOWN, 8, 120, 220],
      { async: true }
    )
    const calls = ccall.mock.calls as unknown as Array<[string, string | null, string[], unknown[], { async?: boolean }]>
    expect(calls[1]?.[0]).toBe('app_frame')
    expect(calls[1]?.[4]).toEqual({ async: true })
  })

  it('waits for an async pointer handler before dispatching the follow-up frame', async () => {
    let resolvePointer: ((value: number) => void) | undefined
    const ccall = vi.fn((ident: string) => {
      if (ident === 'app_dispatch_pointer_event') {
        return new Promise<number>(resolve => {
          resolvePointer = resolve
        })
      }
      return 0
    })

    const dispatched = dispatchAppPointerEvent({ ccall }, APP_POINTER_DOWN, 8, 120, 220)

    expect(ccall).toHaveBeenCalledTimes(1)
    resolvePointer?.(0)
    await dispatched

    expect(ccall).toHaveBeenNthCalledWith(
      2,
      'app_frame',
      null,
      ['number'],
      [expect.any(Number)],
      { async: true }
    )
  })

  it('serializes async frame dispatches for the same wasm module', async () => {
    let resolveFrame: ((value: number) => void) | undefined
    const ccall = vi.fn(() => {
      if (ccall.mock.calls.length === 1) {
        return new Promise<number>(resolve => {
          resolveFrame = resolve
        })
      }
      return 0
    })
    const module = { ccall }

    const firstFrame = dispatchAppFrame(module)
    const secondFrame = dispatchAppFrame(module)

    expect(ccall).toHaveBeenCalledTimes(1)
    resolveFrame?.(0)
    await Promise.all([firstFrame, secondFrame])

    expect(ccall).toHaveBeenCalledTimes(2)
  })

  it('preserves non-sequential press ids returned by hit testing', () => {
    const ccall = vi.fn((ident: string) => (ident === 'app_hit_test' ? 65 : 0))

    const pressId = hitTestApp({ ccall }, 120, 220)

    expect(pressId).toBe(65)
    expect(ccall).toHaveBeenCalledWith('app_hit_test', 'number', ['number', 'number'], [120, 220])
  })

  it('applies mirrored scroll offsets to the wasm app', () => {
    const ccall = vi.fn(() => 0)

    setMirrorScroll({ ccall }, 12, 96)

    expect(ccall).toHaveBeenCalledWith('app_mirror_set_scroll', null, ['number', 'number'], [12, 96])
  })

  it('syncs simulator wifi state into the wasm app', () => {
    const ccall = vi.fn(() => 0)

    setAppWifi({ ccall, _gea_embedded_wifi_web_set_state: vi.fn() }, true, 'Gea Lab', '192.168.4.22', -48)

    expect(ccall).toHaveBeenCalledWith(
      'gea_embedded_wifi_web_set_state',
      null,
      ['number', 'string', 'string', 'number'],
      [1, 'Gea Lab', '192.168.4.22', -48]
    )
  })

  it('pushes the simulator wifi scan list into the wasm app', () => {
    const ccall = vi.fn(() => 0)

    setAppWifiScan(
      {
        ccall,
        _gea_embedded_wifi_web_set_scan_count: vi.fn(),
        _gea_embedded_wifi_web_set_scan_entry: vi.fn()
      },
      [
        { ssid: 'Home', rssi: -45, secured: 1 },
        { ssid: 'Cafe', rssi: -72, secured: 0 }
      ]
    )

    expect(ccall).toHaveBeenNthCalledWith(1, 'gea_embedded_wifi_web_set_scan_count', null, ['number'], [2])
    expect(ccall).toHaveBeenNthCalledWith(
      2,
      'gea_embedded_wifi_web_set_scan_entry',
      null,
      ['number', 'string', 'number', 'number'],
      [0, 'Home', -45, 1]
    )
    expect(ccall).toHaveBeenNthCalledWith(
      3,
      'gea_embedded_wifi_web_set_scan_entry',
      null,
      ['number', 'string', 'number', 'number'],
      [1, 'Cafe', -72, 0]
    )
  })

  it('skips wifi scan sync for older wasm apps without scan shims', () => {
    const ccall = vi.fn(() => 0)

    setAppWifiScan({ ccall }, [{ ssid: 'Home', rssi: -45, secured: 1 }])

    expect(ccall).not.toHaveBeenCalled()
  })

  it('reads mirror schema metadata when exported by the wasm app', () => {
    const ccall = vi.fn((ident: string) => {
      if (ident === 'app_mirror_get_field_count') return 3
      if (ident === 'app_mirror_get_schema_hash') return 0x89abcdef
      return 0
    })

    expect(
      getMirrorSchema({
        ccall,
        _app_mirror_get_field_count: vi.fn(),
        _app_mirror_get_schema_hash: vi.fn()
      })
    ).toEqual({ fieldCount: 3, schemaHash: 0x89abcdef })
  })
})
