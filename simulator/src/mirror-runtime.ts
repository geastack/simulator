import {
  commitMirrorFrame,
  getMirrorSchema,
  initializeAppRuntime,
  setMirrorArrayInt,
  setMirrorArrayLen,
  setMirrorInt,
  setMirrorScroll,
  setMirrorString
} from './app-runtime'
import { loadModule } from './app-loader'
import { framebufferView, rgb565ToRgba } from './framebuffer'

type WasmModule = Awaited<ReturnType<typeof loadModule>>

type MirrorRecord =
  | { kind: 'begin'; messageType: 'snapshot' | 'diff'; appId: string; fieldCount?: number; schemaHash?: number }
  | { kind: 'int'; field: number; value: number }
  | { kind: 'string'; field: number; value: string }
  | { kind: 'array_len'; field: number; len: number }
  | { kind: 'array_int'; field: number; index: number; subfield: number; value: number }
  | { kind: 'scroll'; node: number; scrollY: number }
  | { kind: 'end' }
  | { kind: 'error'; message: string }

type MirrorStatus = {
  connected: boolean
  host: string
  port: number
  message: string
}

type MirrorFramebufferCache = {
  imageData: ImageData | null
  rgba: Uint8ClampedArray<ArrayBuffer> | null
  width: number
  height: number
}

function getMirrorRuntimeDebugEnabled() {
  try {
    return (
      new URLSearchParams(window.location.search).get('mirrorDebug') === '1' ||
      window.localStorage.getItem('geaMirrorDebug') === '1'
    )
  } catch {
    return false
  }
}

const MIRROR_RUNTIME_DEBUG = getMirrorRuntimeDebugEnabled()

function mirrorRuntimeDebug(message: string) {
  if (MIRROR_RUNTIME_DEBUG) console.info(message)
}

function describeMirrorRecord(record: MirrorRecord): string {
  if (record.kind === 'begin') {
    const schema =
      record.fieldCount == null && record.schemaHash == null
        ? ''
        : ` fields=${record.fieldCount ?? '?'} schema=0x${(record.schemaHash ?? 0).toString(16)}`
    return `begin type=${record.messageType} app=${record.appId}${schema}`
  }
  if (record.kind === 'int') return `int field=${record.field} value=${record.value}`
  if (record.kind === 'string') return `string field=${record.field} bytes=${record.value.length}`
  if (record.kind === 'array_len') return `array_len field=${record.field} len=${record.len}`
  if (record.kind === 'array_int')
    return `array_int field=${record.field} index=${record.index} subfield=${record.subfield} value=${record.value}`
  if (record.kind === 'scroll') return `scroll node=${record.node} y=${record.scrollY}`
  if (record.kind === 'error') return `error message=${record.message}`
  return 'end'
}

export interface DeviceMirrorStats {
  type: 'snapshot' | 'diff' | 'error'
  fieldCount: number
  itemCount: number
}

export interface DeviceMirrorRuntime {
  appId: string
  width: number
  height: number
  devicePixelRatio: number
  teardown: () => void
}

export interface CreateDeviceMirrorRuntimeOptions {
  appId: string
  width: number
  height: number
  devicePixelRatio: number
  ctx: CanvasRenderingContext2D
  host: string
  port: number
  onStatus?: (status: MirrorStatus) => void
  onStats?: (stats: DeviceMirrorStats) => void
  onAppIdChange?: (appId: string) => void
}

function presentFramebuffer(
  module: WasmModule,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cache: MirrorFramebufferCache
) {
  const framebufferPtr = module.ccall('get_framebuffer_ptr', 'number', [], [])
  const framebufferWidth = module.ccall('get_framebuffer_width', 'number', [], [])
  const framebufferHeight = module.ccall('get_framebuffer_height', 'number', [], [])

  if (framebufferWidth !== width || framebufferHeight !== height) {
    throw new Error(`Mirror framebuffer geometry changed to ${framebufferWidth}x${framebufferHeight}`)
  }

  const pixels = framebufferView(module.HEAPU8, framebufferPtr, width, height)
  if (cache.width !== width || cache.height !== height || !cache.rgba || !cache.imageData) {
    cache.rgba = new Uint8ClampedArray(new ArrayBuffer(width * height * 4))
    cache.imageData = new ImageData(cache.rgba, width, height)
    cache.width = width
    cache.height = height
  }
  rgb565ToRgba(pixels, cache.rgba)
  ctx.putImageData(cache.imageData, 0, 0)
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0
}

export async function createDeviceMirrorRuntime(
  options: CreateDeviceMirrorRuntimeOptions
): Promise<DeviceMirrorRuntime> {
  const { width, height, devicePixelRatio, ctx, host, port, onStatus, onStats, onAppIdChange } = options
  let currentAppId = options.appId
  let module = await loadModule(currentAppId)
  await initializeAppRuntime(module, width, height, devicePixelRatio)
  const framebufferCache: MirrorFramebufferCache = { imageData: null, rgba: null, width: 0, height: 0 }
  presentFramebuffer(module, ctx, width, height, framebufferCache)

  const events = new EventSource('/mirror/events')
  const frameQueue: MirrorRecord[] = []
  let frameQueueOffset = 0
  let processing = false
  let disposed = false

  let activeMessageType: DeviceMirrorStats['type'] | null = null
  let activeFieldCount = 0
  let activeItemCount = 0

  async function swapModule(nextAppId: string) {
    onStatus?.({ connected: true, host, port, message: `Loading ${nextAppId}...` })
    const nextModule = await loadModule(nextAppId)
    await initializeAppRuntime(nextModule, width, height, devicePixelRatio)
    module = nextModule
    currentAppId = nextAppId
    onAppIdChange?.(nextAppId)
  }

  function validateMirrorSchema(record: Extract<MirrorRecord, { kind: 'begin' }>) {
    if (record.fieldCount == null && record.schemaHash == null) return null

    const local = getMirrorSchema(module)
    if (local.fieldCount == null || local.schemaHash == null) {
      return `Mirror schema metadata is missing from the web module for ${record.appId}. Rebuild the web app module.`
    }
    const fieldMismatch =
      record.fieldCount != null && record.fieldCount !== local.fieldCount
    const hashMismatch =
      record.schemaHash != null && record.schemaHash !== local.schemaHash

    if (!fieldMismatch && !hashMismatch) return null

    const deviceHash = record.schemaHash == null ? '?' : `0x${record.schemaHash.toString(16)}`
    const localHash = local.schemaHash == null ? '?' : `0x${local.schemaHash.toString(16)}`
    return `Mirror schema mismatch for ${record.appId}: device fields=${record.fieldCount ?? '?'}, schema=${deviceHash}; web fields=${local.fieldCount ?? '?'}, schema=${localHash}. Rebuild the web app module.`
  }

  async function processFrames() {
    if (processing || disposed) return
    processing = true
    try {
      while (frameQueueOffset < frameQueue.length && !disposed) {
        const record = frameQueue[frameQueueOffset++]!
        mirrorRuntimeDebug(`[mirror-runtime] apply ${describeMirrorRecord(record)}`)

        if (record.kind === 'error') {
          activeMessageType = null
          activeFieldCount = 0
          activeItemCount = 0
          onStatus?.({ connected: false, host, port, message: record.message || 'Device mirror error' })
          onStats?.({ type: 'error', fieldCount: 0, itemCount: 0 })
          continue
        }

        if (record.kind === 'begin') {
          activeMessageType = record.messageType
          activeFieldCount = 0
          activeItemCount = 0
          if (record.appId && record.appId !== currentAppId) {
            if (record.messageType !== 'snapshot') {
              activeMessageType = null
              onStatus?.({
                connected: true,
                host,
                port,
                message: `Waiting for ${record.appId} snapshot...`
              })
              continue
            }
            try {
              await swapModule(record.appId)
            } catch (error) {
              onStatus?.({
                connected: false,
                host,
                port,
                message: `Cannot mirror ${record.appId}: ${error instanceof Error ? error.message : String(error)}`
              })
              activeMessageType = null
              continue
            }
          }
          const schemaError = validateMirrorSchema(record)
          if (schemaError) {
            onStatus?.({ connected: false, host, port, message: schemaError })
            onStats?.({ type: 'error', fieldCount: 0, itemCount: 0 })
            activeMessageType = null
          }
          continue
        }

        if (!activeMessageType) continue

        if (record.kind === 'int') {
          setMirrorInt(module, record.field, asNumber(record.value))
          activeFieldCount += 1
          activeItemCount += 1
          continue
        }
        if (record.kind === 'string') {
          setMirrorString(module, record.field, String(record.value ?? ''))
          activeFieldCount += 1
          activeItemCount += 1
          continue
        }
        if (record.kind === 'array_len') {
          setMirrorArrayLen(module, record.field, asNumber(record.len))
          activeFieldCount += 1
          activeItemCount += 1
          continue
        }
        if (record.kind === 'array_int') {
          setMirrorArrayInt(
            module,
            record.field,
            asNumber(record.index),
            asNumber(record.subfield),
            asNumber(record.value)
          )
          activeItemCount += 1
          continue
        }
        if (record.kind === 'scroll') {
          setMirrorScroll(module, asNumber(record.node), asNumber(record.scrollY))
          activeItemCount += 1
          continue
        }
        if (record.kind === 'end') {
          commitMirrorFrame(module)
          presentFramebuffer(module, ctx, width, height, framebufferCache)
          onStats?.({
            type: activeMessageType,
            fieldCount: activeFieldCount,
            itemCount: activeItemCount
          })
          activeMessageType = null
          activeFieldCount = 0
          activeItemCount = 0
        }
      }
    } finally {
      if (frameQueueOffset > 0) {
        frameQueue.splice(0, frameQueueOffset)
        frameQueueOffset = 0
      }
      processing = false
    }
  }

  function scheduleProcessing() {
    if (disposed) return
    void processFrames()
  }

  function enqueueMirrorRecords(records: MirrorRecord[]) {
    if (disposed || records.length === 0) return
    for (const record of records) mirrorRuntimeDebug(`[mirror-runtime] rx ${describeMirrorRecord(record)}`)
    frameQueue.push(...records)
    scheduleProcessing()
  }

  events.addEventListener('status', event => {
    onStatus?.(JSON.parse((event as MessageEvent).data) as MirrorStatus)
  })

  events.addEventListener('mirror', event => {
    try {
      const data = JSON.parse((event as MessageEvent).data) as MirrorRecord | MirrorRecord[]
      enqueueMirrorRecords(Array.isArray(data) ? data : [data])
    } catch (error) {
      onStatus?.({
        connected: false,
        host,
        port,
        message: error instanceof Error ? error.message : 'Device mirror received invalid record'
      })
    }
  })

  events.addEventListener('mirror-batch', event => {
    try {
      const records = JSON.parse((event as MessageEvent).data) as MirrorRecord[]
      enqueueMirrorRecords(Array.isArray(records) ? records : [])
    } catch (error) {
      onStatus?.({
        connected: false,
        host,
        port,
        message: error instanceof Error ? error.message : 'Device mirror received invalid record'
      })
    }
  })

  const response = await fetch('/mirror/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host, port })
  })
  if (!response.ok) {
    events.close()
    throw new Error(await response.text())
  }

  return {
    get appId() {
      return currentAppId
    },
    width,
    height,
    devicePixelRatio,
    teardown() {
      disposed = true
      frameQueue.length = 0
      frameQueueOffset = 0
      events.close()
      void fetch('/mirror/disconnect', { method: 'POST' })
    }
  }
}
