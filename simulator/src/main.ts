import './style.css'

import {
  APP_CLICK,
  APP_POINTER_DOWN,
  APP_POINTER_MOVE,
  APP_POINTER_UP,
  dispatchAppFrame,
  dispatchAppKeyDown,
  dispatchAppPointerEvent,
  dispatchAppPointerEvent2,
  dispatchTouchDown,
  dispatchTouchMove,
  dispatchPointerHover,
  dispatchTouchUp,
  hitTestApp,
  initializeAppRuntime,
  setAppTilt,
  setAppWifi,
  setAppWifiScan
} from './app-runtime'
import { loadModule } from './app-loader'
import { clampDevicePixelRatio, DEFAULT_DEVICE_PIXEL_RATIO, DEFAULT_ZOOM } from './defaults'
import { framebufferView, rgb565ToRgba } from './framebuffer'
import { WEB_APP_IDS } from './manifest'
import { createDeviceMirrorRuntime, type DeviceMirrorRuntime } from './mirror-runtime'

const VOICE_NOTES_STORAGE_BLOB_KEY = '__gea_embedded_local_storage_blob_hex_v1'
const VOICE_NOTES_OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions'
const VOICE_NOTES_OPENAI_PROXY_URL = '/voice-notes/openai-transcriptions'

function headerValue(headers: HeadersInit | undefined, name: string) {
  if (!headers) return ''
  const lower = name.toLowerCase()
  if (headers instanceof Headers) return headers.get(name) ?? ''
  if (Array.isArray(headers)) {
    const match = headers.find(([key]) => String(key).toLowerCase() === lower)
    return match ? String(match[1]) : ''
  }
  const record = headers as Record<string, string>
  return record[name] ?? record[lower] ?? ''
}

function bodyBytes(body: BodyInit | null | undefined) {
  if (!body) return 0
  if (typeof body === 'string') return body.length
  if (body instanceof ArrayBuffer) return body.byteLength
  if (body instanceof Blob) return body.size
  if (body instanceof Uint8Array) return body.byteLength
  if (ArrayBuffer.isView(body)) return body.byteLength
  return 0
}

function fetchUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

type VoiceNotesTranscriptionState = {
  calls: number
  lastAuthorization: string
  lastBodyBytes: number
  statuses: number[]
  errors: string[]
}

function decodeGeaStorageBlob(hex: string) {
  const bytes = new Uint8Array(Math.floor(hex.length / 2))
  for (let i = 0; i < bytes.length; i++) {
    const value = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    bytes[i] = Number.isFinite(value) ? value : 0
  }

  const decoder = new TextDecoder()
  const entries: Record<string, string> = {}
  let pos = 0

  function readChunk() {
    if (pos + 4 > bytes.length) return null
    const length = bytes[pos] | (bytes[pos + 1] << 8) | (bytes[pos + 2] << 16) | (bytes[pos + 3] << 24)
    pos += 4
    if (length < 0 || pos + length > bytes.length) return null
    const value = decoder.decode(bytes.slice(pos, pos + length))
    pos += length
    return value
  }

  while (pos < bytes.length) {
    const key = readChunk()
    const value = readChunk()
    if (key === null || value === null) break
    if (!(key in entries)) entries[key] = value
  }

  return entries
}

function publishVoiceNotesSimState(transcriptionState: VoiceNotesTranscriptionState) {
  let node = document.querySelector<HTMLScriptElement>('#voice-notes-sim-state')
  if (!node) {
    node = document.createElement('script')
    node.type = 'application/json'
    node.id = 'voice-notes-sim-state'
    document.documentElement.append(node)
  }

  const entries = decodeGeaStorageBlob(localStorage.getItem(VOICE_NOTES_STORAGE_BLOB_KEY) || '')
  const audioState = (globalThis as { __gea_web_audio?: { lastPlayback?: HTMLAudioElement } }).__gea_web_audio
  const mediaTracks = (globalThis as { __gea_web_media_tracks?: Record<string, unknown> }).__gea_web_media_tracks
  node.textContent = JSON.stringify({
    entries,
    noteRaw: entries.voice_notes_v1 || '',
    transcriptionCalls: transcriptionState.calls,
    transcriptionAuth: transcriptionState.lastAuthorization,
    transcriptionBodyBytes: transcriptionState.lastBodyBytes,
    transcriptionStatuses: transcriptionState.statuses,
    transcriptionErrors: transcriptionState.errors,
    realTranscriptionProxy: true,
    playbackAttempted: !!audioState?.lastPlayback,
    audioTracksRemaining: Object.keys(mediaTracks || {}).length
  })
}

function startVoiceNotesStatePublisher(transcriptionState: VoiceNotesTranscriptionState) {
  const publish = () => publishVoiceNotesSimState(transcriptionState)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', publish, { once: true })
  } else {
    publish()
  }
  window.setInterval(publish, 100)
}

function applyVoiceNotesWebSimBridges() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('fakeMic') === '1') {
    ;(globalThis as { __GEA_FAKE_MIC__?: boolean }).__GEA_FAKE_MIC__ = true
  }

  if (params.get('resetVoiceNotes') === '1') {
    localStorage.removeItem(VOICE_NOTES_STORAGE_BLOB_KEY)
    localStorage.removeItem('voice_notes_v1')
    localStorage.removeItem('voice_notes_sounds')
    localStorage.removeItem('voice_notes_next_number')
  }

  const realProxy = params.get('realTranscription') === '1'
  if (!realProxy) return

  localStorage.setItem('voice_notes_openai_api_key', params.get('openaiKey') || 'simulator-proxy-key')
  localStorage.setItem('voice_notes_transcription_model', params.get('transcriptionModel') || 'whisper-1')

  const nativeFetch = window.fetch.bind(window)
  const state: VoiceNotesTranscriptionState = {
    calls: 0,
    lastAuthorization: '',
    lastBodyBytes: 0,
    statuses: [],
    errors: []
  }
  ;(globalThis as { __gea_voice_notes_transcription_state?: typeof state }).__gea_voice_notes_transcription_state = state
  startVoiceNotesStatePublisher(state)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (fetchUrl(input) !== VOICE_NOTES_OPENAI_URL) return nativeFetch(input, init)
    state.calls += 1
    state.lastAuthorization = headerValue(init?.headers, 'authorization')
    state.lastBodyBytes = bodyBytes(init?.body)
    try {
      const response = await nativeFetch(VOICE_NOTES_OPENAI_PROXY_URL, init)
      state.statuses.push(response.status)
      return response
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      state.errors.push(message)
      throw error
    }
  }
}

applyVoiceNotesWebSimBridges()

const nativeRAF = window.requestAnimationFrame.bind(window)
const nativeCAF = window.cancelAnimationFrame.bind(window)

type WifiState = {
  connected: boolean
  ssid: string
  ip: string
  rssi: number
}

type WifiScanEntry = {
  ssid: string
  rssi: number
  secured: number
}

type TiltState = {
  x: number
  y: number
}

type SimulatedOscillator = {
  oscillator: OscillatorNode
  connected: boolean
  started: boolean
  stopped: boolean
}

let simulatorAudioContext: AudioContext | undefined
let simulatorAudioGain: GainNode | undefined
let simulatorAudioVolume = 100
let simulatorDisplayBrightness = 100
let simulatorFrameIntervalMs = 16
type SimulatedDisplayOrientation =
  | 'portrait-primary'
  | 'portrait-secondary'
  | 'landscape-primary'
  | 'landscape-secondary'
type SimulatedDisplayOrientationSupport = SimulatedDisplayOrientation | 'portrait' | 'landscape' | 'all'
let simulatorDisplayOrientation: SimulatedDisplayOrientation = 'portrait-primary'
let simulatorDisplaySupportedOrientations: SimulatedDisplayOrientationSupport[] = ['portrait-primary']
let simulatorDisplayAutoRotate = false
const simulatorOscillators: SimulatedOscillator[] = []

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)))
}

function embeddedAudioContext() {
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext
  if (!AudioContextCtor) return undefined
  simulatorAudioContext ||= new AudioContextCtor()
  return simulatorAudioContext
}

function embeddedAudioGain() {
  const ctx = embeddedAudioContext()
  if (!ctx) return undefined
  if (!simulatorAudioGain) {
    simulatorAudioGain = ctx.createGain()
    simulatorAudioGain.gain.value = simulatorAudioVolume / 100
    simulatorAudioGain.connect(ctx.destination)
  }
  return simulatorAudioGain
}

function setEmbeddedAudioVolume(volume: number) {
  simulatorAudioVolume = clampPercent(volume)
  const ctx = simulatorAudioContext
  if (ctx && simulatorAudioGain) simulatorAudioGain.gain.setValueAtTime(simulatorAudioVolume / 100, ctx.currentTime)
}

function setEmbeddedDisplayBrightness(brightness: number) {
  simulatorDisplayBrightness = clampPercent(brightness)
  ;(globalThis as { __gea_embedded_display_brightness?: number }).__gea_embedded_display_brightness =
    simulatorDisplayBrightness
  applyCanvasBrightness()
}

function nativeDisplayWidth() {
  return activeAppRuntime?.width ?? Math.max(1, Math.round(Number(widthInput?.value) || 410))
}

function nativeDisplayHeight() {
  return activeAppRuntime?.height ?? Math.max(1, Math.round(Number(heightInput?.value) || 502))
}

function isLandscapeOrientation(orientation: SimulatedDisplayOrientation) {
  return orientation === 'landscape-primary' || orientation === 'landscape-secondary'
}

function displayWidth() {
  return isLandscapeOrientation(simulatorDisplayOrientation) ? nativeDisplayHeight() : nativeDisplayWidth()
}

function displayHeight() {
  return isLandscapeOrientation(simulatorDisplayOrientation) ? nativeDisplayWidth() : nativeDisplayHeight()
}

function orientationAllowed(orientation: SimulatedDisplayOrientation) {
  return simulatorDisplaySupportedOrientations.some((supported) => {
    if (supported === 'all') return true
    if (supported === 'portrait') return !isLandscapeOrientation(orientation)
    if (supported === 'landscape') return isLandscapeOrientation(orientation)
    return supported === orientation
  })
}

function setDisplayOrientation(orientation: SimulatedDisplayOrientation) {
  if (orientationAllowed(orientation)) simulatorDisplayOrientation = orientation
}

function firstConcreteDisplayOrientation(): SimulatedDisplayOrientation {
  for (const supported of simulatorDisplaySupportedOrientations) {
    if (supported === 'all' || supported === 'portrait' || supported === 'portrait-primary') return 'portrait-primary'
    if (supported === 'portrait-secondary') return 'portrait-secondary'
    if (supported === 'landscape' || supported === 'landscape-primary') return 'landscape-primary'
    if (supported === 'landscape-secondary') return 'landscape-secondary'
  }
  return 'portrait-primary'
}

function setDisplaySupportedOrientations(orientations: SimulatedDisplayOrientationSupport | SimulatedDisplayOrientationSupport[]) {
  const values = Array.isArray(orientations) ? orientations : [orientations]
  const valid = values.filter((orientation): orientation is SimulatedDisplayOrientationSupport =>
    ['portrait-primary', 'portrait-secondary', 'landscape-primary', 'landscape-secondary', 'portrait', 'landscape', 'all'].includes(orientation)
  )
  simulatorDisplaySupportedOrientations = valid.length > 0 ? [...new Set(valid)] : ['portrait-primary']
  if (!orientationAllowed(simulatorDisplayOrientation)) simulatorDisplayOrientation = firstConcreteDisplayOrientation()
}

function createEmbeddedOscillator() {
  try {
    const ctx = embeddedAudioContext()
    if (!ctx) return -1
    const id = simulatorOscillators.length
    simulatorOscillators.push({
      oscillator: ctx.createOscillator(),
      connected: false,
      started: false,
      stopped: false
    })
    return id
  } catch {
    return -1
  }
}

function createEmbeddedOscillatorNode() {
  const id = createEmbeddedOscillator()
  return {
    get type() {
      return simulatorOscillators[id]?.oscillator.type ?? 'sine'
    },
    set type(value: OscillatorType) {
      const entry = simulatorOscillators[id]
      if (entry) entry.oscillator.type = value
    },
    frequency: {
      get value() {
        return simulatorOscillators[id]?.oscillator.frequency.value ?? 0
      },
      set value(frequencyHz: number) {
        const entry = simulatorOscillators[id]
        if (entry) entry.oscillator.frequency.value = frequencyHz
      },
      setValueAtTime(frequencyHz: number, startTime: number) {
        simulatorOscillators[id]?.oscillator.frequency.setValueAtTime(frequencyHz, startTime)
      }
    },
    connect(destination: AudioDestinationNode) {
      const gain = embeddedAudioGain()
      const entry = simulatorOscillators[id]
      if (gain && entry && !entry.connected) {
        entry.oscillator.connect(gain)
        entry.connected = true
      }
      return destination
    },
    start(when = embeddedAudioContext()?.currentTime ?? 0) {
      const ctx = embeddedAudioContext()
      const entry = simulatorOscillators[id]
      if (!ctx || !entry || entry.started) return
      if (ctx.state === 'suspended') void ctx.resume()
      entry.oscillator.start(when)
      entry.started = true
    },
    stop(when = embeddedAudioContext()?.currentTime ?? 0) {
      const entry = simulatorOscillators[id]
      if (!entry || entry.stopped) return
      entry.oscillator.stop(when)
      entry.stopped = true
    }
  }
}

const root = document.querySelector<HTMLDivElement>('#app')

if (!root) {
  throw new Error('Missing root element')
}

root.innerHTML = `
  <main class="page">
    <section class="controls">
      <h1>Gea Embedded WASM Simulator</h1>
      <label>
        App
        <select id="app-select">
          ${WEB_APP_IDS.map(appId => `<option value="${appId}">${appId}</option>`).join('')}
        </select>
      </label>
      <label>
        Width
        <input id="width-input" type="number" min="1" step="1" value="410" />
      </label>
      <label>
        Height
        <input id="height-input" type="number" min="1" step="1" value="502" />
      </label>
      <label>
        DPR
        <input id="dpr-input" type="number" min="1" max="3" step="0.1" value="${DEFAULT_DEVICE_PIXEL_RATIO}" />
      </label>
      <label>
        Zoom
        <input id="zoom-input" type="number" min="1" step="1" value="${DEFAULT_ZOOM}" />
      </label>
      <label>
        Transport
        <select id="transport-select">
          <option value="direct">Direct framebuffer</option>
          <option value="device-mirror">Device mirror</option>
        </select>
      </label>
      <p class="mode-copy">Device mirror receives store diffs from ESP32 hardware and renders them locally.</p>
      <fieldset class="sim-fieldset">
        <legend>Device Mirror</legend>
        <label>
          Board IP
          <input id="mirror-host-input" type="text" value="192.168.4.22" />
        </label>
        <label>
          Port
          <input id="mirror-port-input" type="number" min="1" max="65535" step="1" value="8081" />
        </label>
      </fieldset>
      <fieldset class="sim-fieldset">
        <legend>Wi-Fi</legend>
        <label class="inline-control">
          <input id="wifi-connected-input" type="checkbox" checked />
          Connected
        </label>
        <label>
          SSID
          <input id="wifi-ssid-input" type="text" maxlength="32" value="Gea Lab" />
        </label>
        <label>
          IP
          <input id="wifi-ip-input" type="text" maxlength="15" value="192.168.4.22" />
        </label>
        <label>
          RSSI
          <input id="wifi-rssi-input" type="number" step="1" value="-48" />
        </label>
        <label>
          Available networks
          <textarea id="wifi-scan-input" rows="6" spellcheck="false" placeholder="One per line: SSID:rssi:secured (e.g. Home Wi-Fi:-45:1)">Gea Lab:-48:1
Cafe Free:-62:0
Living Room:-71:1
Studio Mesh:-58:1
Guest Network:-78:0
Neighbor 5G:-82:1
Pixel Hotspot:-67:1
Coffee 2.4:-74:0</textarea>
        </label>
      </fieldset>
      <button id="render-button" type="button">Render</button>
      <p id="status-line" class="status">Idle</p>
    </section>
    <section class="viewer">
      <div class="canvas-shell">
        <div class="device">
          <canvas id="preview-canvas" width="410" height="502"></canvas>
          <button id="side-button" type="button" title="BOOT — return to app launcher" aria-label="Return to app launcher"></button>
        </div>
      </div>
    </section>
  </main>
`

const appSelect = document.querySelector<HTMLSelectElement>('#app-select')!
const widthInput = document.querySelector<HTMLInputElement>('#width-input')!
const heightInput = document.querySelector<HTMLInputElement>('#height-input')!
const dprInput = document.querySelector<HTMLInputElement>('#dpr-input')!
const zoomInput = document.querySelector<HTMLInputElement>('#zoom-input')!
const transportSelect = document.querySelector<HTMLSelectElement>('#transport-select')!
const mirrorHostInput = document.querySelector<HTMLInputElement>('#mirror-host-input')!
const mirrorPortInput = document.querySelector<HTMLInputElement>('#mirror-port-input')!
const wifiConnectedInput = document.querySelector<HTMLInputElement>('#wifi-connected-input')!
const wifiSsidInput = document.querySelector<HTMLInputElement>('#wifi-ssid-input')!
const wifiIpInput = document.querySelector<HTMLInputElement>('#wifi-ip-input')!
const wifiRssiInput = document.querySelector<HTMLInputElement>('#wifi-rssi-input')!
const wifiScanInput = document.querySelector<HTMLTextAreaElement>('#wifi-scan-input')!
const renderButton = document.querySelector<HTMLButtonElement>('#render-button')!
const sideButton = document.querySelector<HTMLButtonElement>('#side-button')!
const statusLine = document.querySelector<HTMLParagraphElement>('#status-line')!
const canvas = document.querySelector<HTMLCanvasElement>('#preview-canvas')!
const context = canvas.getContext('2d')

if (!context) {
  throw new Error('Missing 2D canvas context')
}

type SimulatorCanvasContext = CanvasRenderingContext2D & { clear(): void }

const ctx = context as SimulatorCanvasContext
ctx.imageSmoothingEnabled = false
ctx.clear = () => ctx.clearRect(0, 0, canvas.width, canvas.height)

function currentDisplayBrightness() {
  const published = Number(
    (globalThis as { __gea_embedded_display_brightness?: number }).__gea_embedded_display_brightness
  )
  return Number.isFinite(published) ? clampPercent(published) : simulatorDisplayBrightness
}

function applyCanvasBrightness() {
  const brightness = currentDisplayBrightness()
  canvas.style.filter = brightness >= 100 ? '' : `brightness(${brightness}%)`
}

let activeDeviceMirrorRuntime: DeviceMirrorRuntime | null = null
let activeAppRuntime: {
  appId: string
  module: Awaited<ReturnType<typeof loadModule>>
  width: number
  height: number
  devicePixelRatio: number
  zoom: number
} | null = null
let appRafHandle = 0
const tiltKeys = new Set<string>()
let deviceTiltX = 0
let deviceTiltY = 0
let simulatedMouseButtons = 0

function clampTilt(v: number) {
  if (!Number.isFinite(v)) return 0
  return Math.max(-100, Math.min(100, Math.round(v)))
}

function currentKeyboardTilt() {
  let x = 0
  let y = 0
  if (tiltKeys.has('ArrowLeft') || tiltKeys.has('KeyA')) x += 80
  if (tiltKeys.has('ArrowRight') || tiltKeys.has('KeyD')) x -= 80
  if (tiltKeys.has('ArrowUp') || tiltKeys.has('KeyW')) y -= 80
  if (tiltKeys.has('ArrowDown') || tiltKeys.has('KeyS')) y += 80
  return { x, y }
}

function syncTiltToActiveApp() {
  if (!activeAppRuntime) return
  const keyTilt = currentKeyboardTilt()
  const x = keyTilt.x || deviceTiltX
  const y = keyTilt.y || deviceTiltY
  const tilt = { x: clampTilt(x), y: clampTilt(y) }
  setAppTilt(activeAppRuntime.module, tilt.x, tilt.y)
}

function currentTiltState(): TiltState {
  const keyTilt = currentKeyboardTilt()
  return { x: clampTilt(keyTilt.x || deviceTiltX), y: clampTilt(keyTilt.y || deviceTiltY) }
}

function tiltToG(tilt: number) {
  return Math.max(-1, Math.min(1, tilt / 70))
}

function currentAccelerationState() {
  const tilt = currentTiltState()
  const xg = -tiltToG(tilt.y)
  const yg = tiltToG(tilt.x)
  const zg = Math.sqrt(Math.max(0, 1 - xg * xg - yg * yg))
  const g = 9.80665
  return { x: xg * g, y: yg * g, z: zg * g }
}

function currentWifiState(): WifiState {
  const rssi = Number(wifiRssiInput.value)
  return {
    connected: wifiConnectedInput.checked,
    ssid: wifiSsidInput.value.slice(0, 32),
    ip: wifiIpInput.value.slice(0, 15),
    rssi: Number.isFinite(rssi) ? Math.round(rssi) : 0
  }
}

function syncWifiToActiveApp() {
  if (!activeAppRuntime) return
  const wifi = currentWifiState()
  setAppWifi(activeAppRuntime.module, wifi.connected, wifi.ssid, wifi.ip, wifi.rssi)
}

const simulatedWifiMac = '02:00:00:00:00:01'
const simulatedBleMac = '02:00:00:00:00:02'
const simulatedBleDeviceName = 'Gea Embedded BLE'
const simulatedBleBatteryLevel = 82

function getWifiConnected() {
  return currentWifiState().connected ? 1 : 0
}

function getWifiRssi() {
  return currentWifiState().connected ? currentWifiState().rssi : 0
}

function getWifiSsid() {
  return currentWifiState().connected ? currentWifiState().ssid : ''
}

function getWifiIp() {
  return currentWifiState().connected ? currentWifiState().ip : '0.0.0.0'
}

function configureWifi(ssid: string, _password: string) {
  wifiSsidInput.value = String(ssid).slice(0, 32)
  wifiConnectedInput.checked = wifiSsidInput.value.length > 0
  wifiIpInput.value = wifiConnectedInput.checked ? '192.168.4.22' : '0.0.0.0'
  wifiRssiInput.value = wifiConnectedInput.checked ? '-45' : '0'
  syncWifiToActiveApp()
}

function parseScanEntries(text: string): WifiScanEntry[] {
  const out: WifiScanEntry[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const parts = line.split(':')
    const ssid = parts[0]?.trim().slice(0, 32) ?? ''
    if (!ssid) continue
    const rssiPart = parts[1]?.trim()
    const securedPart = parts[2]?.trim()
    let rssi = rssiPart ? Number(rssiPart) : -55
    if (!Number.isFinite(rssi)) rssi = -55
    rssi = Math.max(-100, Math.min(0, Math.round(rssi)))
    const secured = securedPart === '0' || securedPart === 'open' ? 0 : 1
    out.push({ ssid, rssi, secured })
  }
  return out
}

function currentScanEntries(): WifiScanEntry[] {
  const entries = parseScanEntries(wifiScanInput.value)
  return entries.map(e => ({
    ssid: e.ssid,
    rssi: Math.max(-100, Math.min(0, e.rssi + Math.round((Math.random() - 0.5) * 4))),
    secured: e.secured
  }))
}

let lastScanSnapshot: WifiScanEntry[] = []

function refreshScanSnapshot() {
  lastScanSnapshot = currentScanEntries()
}

function syncWifiScanToActiveApp() {
  if (!activeAppRuntime) return
  setAppWifiScan(activeAppRuntime.module, lastScanSnapshot)
}

refreshScanSnapshot()

const simulatedWifiController = {
  enabled: () => 1,
  setEnabled: (_enabled: boolean | number) => undefined,
  connected: getWifiConnected,
  rssi: getWifiRssi,
  ssid: getWifiSsid,
  ip: getWifiIp,
  mac: () => simulatedWifiMac,
  configure: configureWifi,
  startScan: () => {
    refreshScanSnapshot()
    syncWifiScanToActiveApp()
  },
  scanning: () => 0,
  scanCount: () => lastScanSnapshot.length,
  scanSsidAt: (index: number) => lastScanSnapshot[index]?.ssid ?? '',
  scanRssiAt: (index: number) => lastScanSnapshot[index]?.rssi ?? 0,
  scanSecuredAt: (index: number) => lastScanSnapshot[index]?.secured ?? 0,
  isConnected: getWifiConnected,
  getRSSI: getWifiRssi,
  getRssi: getWifiRssi,
  getSSID: getWifiSsid,
  getSsid: getWifiSsid,
  getIP: getWifiIp,
  getIp: getWifiIp,
  getMAC: () => simulatedWifiMac,
  getMac: () => simulatedWifiMac,
  isScanning: () => 0,
  getScanCount: () => lastScanSnapshot.length,
  getScanSsidAt: (index: number) => lastScanSnapshot[index]?.ssid ?? '',
  getScanRssiAt: (index: number) => lastScanSnapshot[index]?.rssi ?? 0,
  getScanSecuredAt: (index: number) => lastScanSnapshot[index]?.secured ?? 0
}

const simulatedBluetoothController = {
  keyboard: {
    tap: (_hidCode: number) => undefined,
    down: (_modifier: number, _hidCode: number) => undefined,
    up: () => undefined
  },
  mouse: {
    move: (_dx: number, _dy: number, _buttons = 0, _wheel = 0) => undefined,
    click: (_button: number) => undefined
  },
  enabled: () => 1,
  setEnabled: (_enabled: boolean | number) => undefined,
  connected: () => 0,
  bound: () => 0,
  batteryLevel: () => simulatedBleBatteryLevel,
  mac: () => simulatedBleMac,
  deviceName: () => simulatedBleDeviceName,
  init: (_deviceName: string, _appearance = 0, _macAddress = '') => undefined,
  startAdvertising: () => undefined,
  stopAdvertising: () => undefined,
  isConnected: () => 0,
  isBound: () => 0,
  getBatteryLevel: () => simulatedBleBatteryLevel,
  getMAC: () => simulatedBleMac,
  getMac: () => simulatedBleMac,
  getDeviceName: () => simulatedBleDeviceName
}

const simulatedDisplayController = {
  ctx,
  get width() {
    return displayWidth()
  },
  get height() {
    return displayHeight()
  },
  get nativeWidth() {
    return nativeDisplayWidth()
  },
  get nativeHeight() {
    return nativeDisplayHeight()
  },
  get orientation() {
    return simulatorDisplayOrientation
  },
  set orientation(value: SimulatedDisplayOrientation) {
    setDisplayOrientation(value)
  },
  get supportedOrientations() {
    return simulatorDisplaySupportedOrientations
  },
  set supportedOrientations(value: SimulatedDisplayOrientationSupport | SimulatedDisplayOrientationSupport[]) {
    setDisplaySupportedOrientations(value)
  },
  get autoRotate() {
    return simulatorDisplayAutoRotate
  },
  set autoRotate(value: boolean | number) {
    simulatorDisplayAutoRotate = Boolean(value)
  },
  getBrightness: () => simulatorDisplayBrightness,
  setBrightness: setEmbeddedDisplayBrightness,
  getOrientation: () => simulatorDisplayOrientation,
  setOrientation: setDisplayOrientation,
  getSupportedOrientations: () => simulatorDisplaySupportedOrientations,
  setSupportedOrientations: setDisplaySupportedOrientations,
  getAutoRotate: () => simulatorDisplayAutoRotate,
  setAutoRotate: (enabled: boolean | number) => {
    simulatorDisplayAutoRotate = Boolean(enabled)
  },
  getFrameIntervalMs: () => simulatorFrameIntervalMs,
  setFrameIntervalMs: (intervalMs: number) => {
    simulatorFrameIntervalMs = Math.max(1, Math.min(1000, Math.round(Number(intervalMs) || 0)))
  },
  getFrameRate: () => 1000 / simulatorFrameIntervalMs,
  setFrameRate: (fps: number) => {
    const numericFps = Number(fps)
    if (numericFps > 0) simulatorFrameIntervalMs = Math.max(1, Math.min(1000, Math.round(1000 / numericFps)))
  },
  setFlushConfig: (_config: { rows: number; depth: number }) => {}
}

const simulatedAudioController = {
  getVolume: () => simulatorAudioVolume,
  setVolume: setEmbeddedAudioVolume
}

Object.defineProperties(globalThis.navigator as any, {
  wifi: {
    value: simulatedWifiController,
    configurable: true
  },
  bluetooth: {
    value: simulatedBluetoothController,
    configurable: true
  }
})

function readAccelerometer() {
  const acceleration = currentAccelerationState()
  const tilt = currentTiltState()
  return {
    x: acceleration.x,
    y: acceleration.y,
    z: acceleration.z,
    tiltX: tilt.x,
    tiltY: tilt.y,
    gyroscopeX: 0,
    gyroscopeY: 0,
    gyroscopeZ: 0,
    timestamp: performance.now()
  }
}

Object.defineProperties(globalThis, {
  Accelerometer: {
    value: {
      get x() {
        return currentAccelerationState().x
      },
      get y() {
        return currentAccelerationState().y
      },
      get z() {
        return currentAccelerationState().z
      },
      get tiltX() {
        return currentTiltState().x
      },
      get tiltY() {
        return currentTiltState().y
      },
      get gyroscopeX() {
        return 0
      },
      get gyroscopeY() {
        return 0
      },
      get gyroscopeZ() {
        return 0
      },
      get activated() {
        return true
      },
      get hasReading() {
        return true
      },
      get timestamp() {
        return performance.now()
      },
      read: readAccelerometer,
      start: () => undefined,
      stop: () => undefined,
      calibrate: () => undefined,
      calibrateBias: () => undefined
    },
    configurable: true
  },
  readAccelerometer: {
    value: readAccelerometer,
    configurable: true
  },
  BLE: {
    value: simulatedBluetoothController,
    configurable: true
  },
  WiFi: {
    value: simulatedWifiController,
    configurable: true
  },
  Display: {
    value: simulatedDisplayController,
    configurable: true
  },
  display: {
    value: simulatedDisplayController,
    configurable: true
  },
  __gea_Audio: {
    value: simulatedAudioController,
    configurable: true
  },
  __gea_Display: {
    value: simulatedDisplayController,
    configurable: true
  },
  __gea_audioContext: {
    value: {
      get currentTime() {
        return embeddedAudioContext()?.currentTime ?? 0
      },
      get destination() {
        return embeddedAudioContext()?.destination ?? 0
      },
      createOscillator: createEmbeddedOscillatorNode
    },
    configurable: true
  },
  gea_embedded_imu_init: {
    value: () => undefined,
    configurable: true
  },
  gea_embedded_imu_close: {
    value: () => undefined,
    configurable: true
  },
  gea_embedded_imu_calibrate_bias: {
    value: () => undefined,
    configurable: true
  },
  gea_embedded_imu_start_mouse: {
    value: () => undefined,
    configurable: true
  },
  gea_embedded_imu_stop_mouse: {
    value: () => undefined,
    configurable: true
  },
  gea_embedded_imu_get_tilt_x: {
    value: () => currentTiltState().x,
    configurable: true
  },
  gea_embedded_imu_get_tilt_y: {
    value: () => currentTiltState().y,
    configurable: true
  },
  gea_embedded_imu_get_acceleration_x: {
    value: () => currentAccelerationState().x,
    configurable: true
  },
  gea_embedded_imu_get_acceleration_y: {
    value: () => currentAccelerationState().y,
    configurable: true
  },
  gea_embedded_imu_get_acceleration_z: {
    value: () => currentAccelerationState().z,
    configurable: true
  },
  gea_embedded_imu_set_mouse_buttons: {
    value: (buttons: number) => {
      simulatedMouseButtons = buttons
    },
    configurable: true
  },
  gea_embedded_imu_get_mouse_buttons: {
    value: () => simulatedMouseButtons,
    configurable: true
  },
  gea_embedded_wifi_is_connected: {
    value: getWifiConnected,
    configurable: true
  },
  gea_embedded_wifi_get_rssi: {
    value: getWifiRssi,
    configurable: true
  },
  gea_embedded_wifi_get_ssid: {
    value: getWifiSsid,
    configurable: true
  },
  gea_embedded_wifi_get_ip: {
    value: getWifiIp,
    configurable: true
  },
  gea_embedded_wifi_get_mac: {
    value: () => simulatedWifiMac,
    configurable: true
  },
  gea_embedded_wifi_configure: {
    value: configureWifi,
    configurable: true
  },
  gea_embedded_wifi_start_scan: {
    value: () => {
      refreshScanSnapshot()
      syncWifiScanToActiveApp()
    },
    configurable: true
  },
  gea_embedded_wifi_is_scanning: {
    value: () => 0,
    configurable: true
  },
  gea_embedded_wifi_get_scan_count: {
    value: () => lastScanSnapshot.length,
    configurable: true
  },
  gea_embedded_wifi_get_scan_ssid_at: {
    value: (index: number) => lastScanSnapshot[index]?.ssid ?? '',
    configurable: true
  },
  gea_embedded_wifi_get_scan_rssi_at: {
    value: (index: number) => lastScanSnapshot[index]?.rssi ?? 0,
    configurable: true
  },
  gea_embedded_wifi_get_scan_secured_at: {
    value: (index: number) => lastScanSnapshot[index]?.secured ?? 0,
    configurable: true
  },
  gea_embedded_ble_is_connected: {
    value: () => 0,
    configurable: true
  },
  gea_embedded_ble_is_bound: {
    value: () => 0,
    configurable: true
  },
  gea_embedded_ble_get_battery_level: {
    value: () => simulatedBleBatteryLevel,
    configurable: true
  },
  gea_embedded_ble_get_mac: {
    value: () => simulatedBleMac,
    configurable: true
  },
  gea_embedded_ble_get_device_name: {
    value: () => simulatedBleDeviceName,
    configurable: true
  },
  gea_embedded_display_get_brightness: {
    value: () => simulatorDisplayBrightness,
    configurable: true
  },
  gea_embedded_display_set_brightness: {
    value: setEmbeddedDisplayBrightness,
    configurable: true
  },
})

function teardownPreviousRuntime() {
  if (activeDeviceMirrorRuntime) {
    activeDeviceMirrorRuntime.teardown()
    activeDeviceMirrorRuntime = null
  }

  if (appRafHandle) {
    nativeCAF(appRafHandle)
    appRafHandle = 0
  }
  activeAppRuntime = null
}

function updateCanvasPresentation(width: number, height: number, zoom: number) {
  canvas.width = width
  canvas.height = height
  canvas.style.width = `${width * zoom}px`
  canvas.style.height = `${height * zoom}px`
}

function presentFramebuffer(module: Awaited<ReturnType<typeof loadModule>>, width: number, height: number) {
  const framebufferPtr = module.ccall('get_framebuffer_ptr', 'number', [], [])
  const framebufferWidth = module.ccall('get_framebuffer_width', 'number', [], [])
  const framebufferHeight = module.ccall('get_framebuffer_height', 'number', [], [])
  const strideBytes = module.ccall('get_framebuffer_stride_bytes', 'number', [], [])

  if (framebufferWidth !== width || framebufferHeight !== height || strideBytes !== width * 2) {
    throw new Error('Unexpected framebuffer geometry returned from WASM module')
  }

  const pixels = framebufferView(module.HEAPU8, framebufferPtr, framebufferWidth, framebufferHeight)
  const rgba = rgb565ToRgba(new Uint16Array(pixels))
  const imageData = new ImageData(new Uint8ClampedArray(rgba), framebufferWidth, framebufferHeight)
  ctx.putImageData(imageData, 0, 0)
  applyCanvasBrightness()
}

async function runAppRender(appId: string, width: number, height: number, zoom: number, devicePixelRatio: number) {
  const module = await loadModule(appId)
  await initializeAppRuntime(module, width, height, devicePixelRatio)
  presentFramebuffer(module, width, height)

  activeAppRuntime = { appId, module, width, height, devicePixelRatio, zoom }
  syncWifiToActiveApp()
  refreshScanSnapshot()
  syncWifiScanToActiveApp()

  async function frameLoop(timestampMs: number) {
    const runtime = activeAppRuntime
    if (!runtime) return
    syncTiltToActiveApp()
    await dispatchAppFrame(runtime.module, timestampMs)
    if (activeAppRuntime !== runtime) return
    presentFramebuffer(runtime.module, runtime.width, runtime.height)
    appRafHandle = nativeRAF(frameLoop)
  }
  appRafHandle = nativeRAF(frameLoop)

  statusLine.textContent = `Running ${appId} at ${width}x${height}, DPR ${devicePixelRatio}, with ${zoom}x zoom.`
}

async function runDeviceMirrorAppRender(
  appId: string,
  width: number,
  height: number,
  zoom: number,
  devicePixelRatio: number
) {
  const host = mirrorHostInput.value.trim()
  const port = Math.round(Number(mirrorPortInput.value || 8081))
  if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) {
    statusLine.textContent = 'Device mirror needs a board IP and valid port.'
    return
  }

  let activeAppId = appId
  statusLine.textContent = `Starting device mirror for ${activeAppId} from ${host}:${port}...`
  activeDeviceMirrorRuntime = await createDeviceMirrorRuntime({
    appId,
    width,
    height,
    devicePixelRatio,
    ctx,
    host,
    port,
    onStatus(status) {
      statusLine.textContent = `Device mirror ${activeAppId}: ${status.message}`
    },
    onStats(stats) {
      if (stats.type === 'error') return
      statusLine.textContent = `Device mirror ${activeAppId}: ${stats.type}, ${stats.fieldCount} field${stats.fieldCount === 1 ? '' : 's'}, ${stats.itemCount} item${stats.itemCount === 1 ? '' : 's'}.`
    },
    onAppIdChange(nextAppId) {
      activeAppId = nextAppId
      if (WEB_APP_IDS.includes(nextAppId)) appSelect.value = nextAppId
      statusLine.textContent = `Device mirror tracking ${nextAppId} on ${host}:${port}.`
    }
  })
  statusLine.textContent = `Device mirror ${activeAppId} waiting for ${host}:${port}...`
}

async function renderSelectedApp() {
  const appId = appSelect.value
  const width = Number(widthInput.value)
  const height = Number(heightInput.value)
  const zoom = Math.max(1, Number(zoomInput.value))
  const devicePixelRatio = clampDevicePixelRatio(Number(dprInput.value))

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    statusLine.textContent = 'Viewport must be positive.'
    return
  }

  dprInput.value = String(devicePixelRatio)
  teardownPreviousRuntime()

  statusLine.textContent = `Loading ${appId}...`
  updateCanvasPresentation(width, height, zoom)

  const transport = transportSelect.value

  if (transport === 'device-mirror') {
    await runDeviceMirrorAppRender(appId, width, height, zoom, devicePixelRatio)
  } else {
    await runAppRender(appId, width, height, zoom, devicePixelRatio)
  }
}

renderButton.addEventListener('click', () => {
  void renderSelectedApp()
})

function readPositiveNumberParam(params: URLSearchParams, names: string[], fallback: string) {
  for (const name of names) {
    const value = params.get(name)
    if (value === null) continue
    const number = Number(value)
    if (Number.isFinite(number) && number > 0) return String(number)
  }
  return fallback
}

function applyInitialSearchParams() {
  const params = new URLSearchParams(window.location.search)
  const requestedApp = params.get('app')
  if (requestedApp && WEB_APP_IDS.includes(requestedApp)) appSelect.value = requestedApp

  widthInput.value = readPositiveNumberParam(params, ['width', 'w'], widthInput.value)
  heightInput.value = readPositiveNumberParam(params, ['height', 'h'], heightInput.value)
  dprInput.value = readPositiveNumberParam(params, ['dpr'], dprInput.value)
  zoomInput.value = readPositiveNumberParam(params, ['zoom', 'z'], zoomInput.value)

  if (params.has('app') || params.has('autorender')) {
    void renderSelectedApp()
  }
}

sideButton.addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('gea-embedded-launch-app', { detail: { appId: 'app-launcher' } }))
})

window.addEventListener('gea-embedded-launch-app', event => {
  const appId = (event as CustomEvent<{ appId?: string }>).detail?.appId
  if (!appId || !WEB_APP_IDS.includes(appId)) {
    statusLine.textContent = appId ? `Unknown app "${appId}".` : 'Launch request did not include an app id.'
    return
  }

  statusLine.textContent = `Loading ${appId}...`
  window.setTimeout(() => {
    appSelect.value = appId
    void renderSelectedApp()
  }, 0)
})

applyInitialSearchParams()

function getActiveAppViewport() {
  if (activeAppRuntime) return { width: activeAppRuntime.width, height: activeAppRuntime.height }
  return null
}

let pointerLastX = 0
let pointerLastY = 0
let pointerStartX = 0
let pointerStartY = 0
let pointerIsDown = false
let pointerActivePressId = -1
let pointerDragged = false
// Second simultaneous finger (non-primary pointer) for pinch — dispatched to the
// app as pointerId 1 via app_dispatch_pointer_event2.
let secondaryPointerId: number | null = null
let secondaryPressId = -1

function toDeviceCoords(event: PointerEvent, viewport: { width: number; height: number }) {
  const rect = canvas.getBoundingClientRect()
  return {
    x: Math.floor((event.clientX - rect.left) * (viewport.width / rect.width)),
    y: Math.floor((event.clientY - rect.top) * (viewport.height / rect.height))
  }
}

canvas.addEventListener('pointerdown', async event => {
  const viewport = getActiveAppViewport()
  if (!viewport) return
  if (!event.isPrimary) {
    const runtime = activeAppRuntime
    if (!runtime || secondaryPointerId !== null) return
    const p = toDeviceCoords(event, viewport)
    secondaryPressId = hitTestApp(runtime.module, p.x, p.y)
    if (secondaryPressId < 0) return
    secondaryPointerId = event.pointerId
    await dispatchAppPointerEvent2(runtime.module, APP_POINTER_DOWN, secondaryPressId, p.x, p.y)
    if (activeAppRuntime !== runtime) return
    presentFramebuffer(runtime.module, runtime.width, runtime.height)
    return
  }
  syncTiltToActiveApp()
  pointerIsDown = true
  const rect = canvas.getBoundingClientRect()
  pointerLastX = Math.floor((event.clientX - rect.left) * (viewport.width / rect.width))
  pointerLastY = Math.floor((event.clientY - rect.top) * (viewport.height / rect.height))
  pointerStartX = pointerLastX
  pointerStartY = pointerLastY
  pointerDragged = false
  const runtime = activeAppRuntime
  if (!runtime) return
  dispatchTouchDown(runtime.module, pointerLastX, pointerLastY)
  const pressId = hitTestApp(runtime.module, pointerLastX, pointerLastY)
  if (pressId >= 0) {
    pointerActivePressId = pressId
    await dispatchAppPointerEvent(runtime.module, APP_POINTER_DOWN, pressId, pointerLastX, pointerLastY)
  }
  if (activeAppRuntime !== runtime) return
  presentFramebuffer(runtime.module, runtime.width, runtime.height)
})

canvas.addEventListener('pointermove', async event => {
  const viewport = getActiveAppViewport()
  if (!viewport) return
  if (event.pointerType === 'mouse' && event.isPrimary && activeAppRuntime) {
    const runtime = activeAppRuntime
    const p = toDeviceCoords(event, viewport)
    await dispatchPointerHover(runtime.module, p.x, p.y)
    if (activeAppRuntime !== runtime) return
    presentFramebuffer(runtime.module, runtime.width, runtime.height)
  }
  if (!event.isPrimary && event.pointerId === secondaryPointerId && secondaryPressId >= 0) {
    const runtime = activeAppRuntime
    if (!runtime) return
    const p = toDeviceCoords(event, viewport)
    await dispatchAppPointerEvent2(runtime.module, APP_POINTER_MOVE, secondaryPressId, p.x, p.y)
    if (activeAppRuntime !== runtime) return
    presentFramebuffer(runtime.module, runtime.width, runtime.height)
    return
  }
  if (!pointerIsDown) return
  syncTiltToActiveApp()
  const rect = canvas.getBoundingClientRect()
  const x = Math.floor((event.clientX - rect.left) * (viewport.width / rect.width))
  const y = Math.floor((event.clientY - rect.top) * (viewport.height / rect.height))
  if (x !== pointerLastX || y !== pointerLastY) {
    if (!pointerDragged && (Math.abs(x - pointerStartX) > 10 || Math.abs(y - pointerStartY) > 10)) pointerDragged = true
    pointerLastX = x
    pointerLastY = y
    const runtime = activeAppRuntime
    if (!runtime) return
    dispatchTouchMove(runtime.module, x, y)
    if (pointerActivePressId >= 0) {
      await dispatchAppPointerEvent(runtime.module, APP_POINTER_MOVE, pointerActivePressId, x, y)
    }
    if (activeAppRuntime !== runtime) return
    presentFramebuffer(runtime.module, runtime.width, runtime.height)
  }
})

canvas.addEventListener('pointerleave', async event => {
  if (event.pointerType !== 'mouse' || !activeAppRuntime) return
  const runtime = activeAppRuntime
  await dispatchPointerHover(runtime.module, -1, -1)
  if (activeAppRuntime === runtime) presentFramebuffer(runtime.module, runtime.width, runtime.height)
})

canvas.addEventListener('pointerup', async event => {
  const runtime = activeAppRuntime
  if (!runtime) return
  if (!event.isPrimary && event.pointerId === secondaryPointerId) {
    secondaryPointerId = null
    const viewport = getActiveAppViewport()
    const p = viewport ? toDeviceCoords(event, viewport) : { x: pointerLastX, y: pointerLastY }
    if (secondaryPressId >= 0) await dispatchAppPointerEvent2(runtime.module, APP_POINTER_UP, secondaryPressId, p.x, p.y)
    secondaryPressId = -1
    if (activeAppRuntime !== runtime) return
    presentFramebuffer(runtime.module, runtime.width, runtime.height)
    return
  }
  syncTiltToActiveApp()
  pointerIsDown = false
  try {
    dispatchTouchUp(runtime.module)
    await dispatchAppFrame(runtime.module)
    if (activeAppRuntime !== runtime) return
    if (pointerActivePressId >= 0) {
      await dispatchAppPointerEvent(runtime.module, APP_POINTER_UP, pointerActivePressId, pointerLastX, pointerLastY)
      if (activeAppRuntime !== runtime) return
    }
    if (!pointerDragged) {
      const pressId = hitTestApp(runtime.module, pointerLastX, pointerLastY)
      if (pressId >= 0) {
        await dispatchAppPointerEvent(runtime.module, APP_CLICK, pressId, pointerLastX, pointerLastY)
        if (activeAppRuntime !== runtime) return
      }
    }
  } finally {
    pointerActivePressId = -1
    pointerDragged = false
  }
  presentFramebuffer(runtime.module, runtime.width, runtime.height)
})

appSelect.addEventListener('change', () => {
  void renderSelectedApp()
})

transportSelect.addEventListener('change', () => {
  void renderSelectedApp()
})

for (const input of [wifiConnectedInput, wifiSsidInput, wifiIpInput, wifiRssiInput]) {
  input.addEventListener('input', syncWifiToActiveApp)
  input.addEventListener('change', syncWifiToActiveApp)
}

function applyScanSidebar() {
  refreshScanSnapshot()
  syncWifiScanToActiveApp()
}
wifiScanInput.addEventListener('input', applyScanSidebar)
wifiScanInput.addEventListener('change', applyScanSidebar)

window.addEventListener('keydown', event => {
  const runtime = activeAppRuntime
  if (runtime && event.keyCode) {
    void dispatchAppKeyDown(runtime.module, event.keyCode).then(() => {
      if (activeAppRuntime !== runtime) return
      presentFramebuffer(runtime.module, runtime.width, runtime.height)
    })
  }

  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS'].includes(event.code)) {
    tiltKeys.add(event.code)
    syncTiltToActiveApp()
  }
})

window.addEventListener('keyup', event => {
  if (tiltKeys.delete(event.code)) {
    syncTiltToActiveApp()
  }
})

window.addEventListener('deviceorientation', event => {
  if (typeof event.gamma === 'number') deviceTiltX = clampTilt(event.gamma * 3)
  if (typeof event.beta === 'number') deviceTiltY = clampTilt((event.beta - 35) * 2)
  syncTiltToActiveApp()
})

void renderSelectedApp()
