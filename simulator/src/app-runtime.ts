type WasmModule = {
  ccall: (
    ident: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[],
    options?: { async?: boolean }
  ) => number | Promise<number>
  [name: string]: unknown
}

const asyncWasmQueues = new WeakMap<WasmModule, Promise<void>>()

function queuedAsyncWasmCall<T>(module: WasmModule, call: () => T | Promise<T>): Promise<T> {
  const previous = asyncWasmQueues.get(module)
  let next: Promise<T>

  if (previous) {
    next = previous.catch(() => undefined).then(call)
  } else {
    try {
      next = Promise.resolve(call())
    } catch (error) {
      next = Promise.reject(error)
    }
  }

  const tracked = next.then(
    () => undefined,
    () => undefined
  )
  asyncWasmQueues.set(module, tracked)
  void tracked.then(() => {
    if (asyncWasmQueues.get(module) === tracked) {
      asyncWasmQueues.delete(module)
    }
  })

  return next
}

function asyncWasmCcall(
  module: WasmModule,
  ident: string,
  returnType: string | null,
  argTypes: string[],
  args: unknown[]
) {
  return queuedAsyncWasmCall(module, () => module.ccall(ident, returnType, argTypes, args, { async: true }))
}

function syncWasmCcall(
  module: WasmModule,
  ident: string,
  returnType: string | null,
  argTypes: string[],
  args: unknown[]
) {
  const result = module.ccall(ident, returnType, argTypes, args)
  if (result && typeof (result as Promise<number>).then === 'function') {
    throw new Error(`${ident} unexpectedly returned an async result`)
  }
  return result as number
}

export const APP_RUNTIME_WASM_EXPORTS = [
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
] as const

export const APP_POINTER_DOWN = 1
export const APP_POINTER_MOVE = 2
export const APP_POINTER_UP = 3
export const APP_CLICK = 4

export async function initializeAppRuntime(module: WasmModule, width: number, height: number, devicePixelRatio: number) {
  const exitCode = await asyncWasmCcall(
    module,
    'app_init',
    'number',
    ['number', 'number', 'number'],
    [width, height, devicePixelRatio]
  )

  if (exitCode !== 0) {
    throw new Error(`WASM app initialization failed with code ${exitCode}`)
  }
}

export async function dispatchAppFrame(module: WasmModule, timestamp = performance.now()) {
  await asyncWasmCcall(module, 'app_frame', null, ['number'], [timestamp])
}

export async function dispatchAppKeyDown(module: WasmModule, keyCode: number) {
  await asyncWasmCcall(module, 'app_dispatch_key_down', null, ['number'], [keyCode])
  await dispatchAppFrame(module)
}

export async function dispatchAppPointerEvent(module: WasmModule, type: number, pressId: number, x: number, y: number) {
  await asyncWasmCcall(
    module,
    'app_dispatch_pointer_event',
    null,
    ['number', 'number', 'number', 'number'],
    [type, pressId, x, y]
  )
  await dispatchAppFrame(module)
}

// Second finger (pointerId 1) for multi-touch / pinch — same dispatch path with
// a distinct pointer id.
export async function dispatchAppPointerEvent2(module: WasmModule, type: number, pressId: number, x: number, y: number) {
  await asyncWasmCcall(
    module,
    'app_dispatch_pointer_event2',
    null,
    ['number', 'number', 'number', 'number'],
    [type, pressId, x, y]
  )
  await dispatchAppFrame(module)
}

export function hitTestApp(module: WasmModule, x: number, y: number) {
  return syncWasmCcall(module, 'app_hit_test', 'number', ['number', 'number'], [x, y])
}

export function dispatchTouchDown(module: WasmModule, x: number, y: number) {
  module.ccall('app_touch_down', null, ['number', 'number'], [x, y])
}

export function dispatchTouchUp(module: WasmModule) {
  module.ccall('app_touch_up', 'number', [], [])
}

export function dispatchTouchMove(module: WasmModule, x: number, y: number) {
  module.ccall('app_touch_move', null, ['number', 'number'], [x, y])
}

export async function dispatchPointerHover(module: WasmModule, x: number, y: number) {
  // Older prebuilt apps predate hover-capable input.
  if (!hasWasmExport(module, 'app_pointer_hover')) return
  await queuedAsyncWasmCall(module, () => module.ccall('app_pointer_hover', null, ['number', 'number'], [x, y]))
  await dispatchAppFrame(module)
}

function hasWasmExport(module: WasmModule, ident: string) {
  return typeof module[`_${ident}`] === 'function'
}

export function setAppTilt(module: WasmModule, x: number, y: number) {
  if (!hasWasmExport(module, 'gea_embedded_imu_web_set_tilt')) return
  module.ccall('gea_embedded_imu_web_set_tilt', null, ['number', 'number'], [x, y])
}

export function setAppWifi(module: WasmModule, connected: boolean, ssid: string, ip: string, rssi: number) {
  if (!hasWasmExport(module, 'gea_embedded_wifi_web_set_state')) return
  module.ccall(
    'gea_embedded_wifi_web_set_state',
    null,
    ['number', 'string', 'string', 'number'],
    [connected ? 1 : 0, ssid, ip, rssi]
  )
}

export function setAppWifiScan(
  module: WasmModule,
  entries: { ssid: string; rssi: number; secured: number }[]
) {
  if (
    !hasWasmExport(module, 'gea_embedded_wifi_web_set_scan_count') ||
    !hasWasmExport(module, 'gea_embedded_wifi_web_set_scan_entry')
  ) {
    return
  }
  module.ccall('gea_embedded_wifi_web_set_scan_count', null, ['number'], [entries.length])
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    module.ccall(
      'gea_embedded_wifi_web_set_scan_entry',
      null,
      ['number', 'string', 'number', 'number'],
      [i, entry.ssid, entry.rssi, entry.secured]
    )
  }
}

export function setMirrorInt(module: WasmModule, field: number, value: number) {
  module.ccall('app_mirror_set_int', null, ['number', 'number'], [field, value])
}

export function setMirrorString(module: WasmModule, field: number, value: string) {
  module.ccall('app_mirror_set_string', null, ['number', 'string'], [field, value])
}

export function setMirrorArrayLen(module: WasmModule, field: number, len: number) {
  module.ccall('app_mirror_set_array_len', null, ['number', 'number'], [field, len])
}

export function setMirrorArrayInt(module: WasmModule, field: number, index: number, subfield: number, value: number) {
  module.ccall('app_mirror_set_array_int', null, ['number', 'number', 'number', 'number'], [field, index, subfield, value])
}

export function setMirrorScroll(module: WasmModule, node: number, scrollY: number) {
  module.ccall('app_mirror_set_scroll', null, ['number', 'number'], [node, scrollY])
}

export function commitMirrorFrame(module: WasmModule) {
  module.ccall('app_mirror_commit', null, [], [])
}

export function getMirrorSchema(module: WasmModule) {
  return {
    fieldCount: hasWasmExport(module, 'app_mirror_get_field_count')
      ? syncWasmCcall(module, 'app_mirror_get_field_count', 'number', [], [])
      : null,
    schemaHash: hasWasmExport(module, 'app_mirror_get_schema_hash')
      ? syncWasmCcall(module, 'app_mirror_get_schema_hash', 'number', [], []) >>> 0
      : null
  }
}
