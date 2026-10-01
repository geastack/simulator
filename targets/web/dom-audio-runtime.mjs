// Browser implementation of the PCM host used by native Gea applications.
// Workers request Window-only audio operations over a private control channel.
const channel = 'gea-browser-audio'
const NativeWorker = globalThis.Worker
let context

function audioContext() {
  context ??= new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' })
  return context
}

// Unlock the speaker on the same user gesture that starts an agent. A worker
// message arrives later and cannot by itself satisfy browser autoplay policy.
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', () => { void audioContext().resume() }, { capture: true })
}

const processor = `class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.samples = new Float32Array(1200); this.used = 0; this.port.onmessage = () => { this.active = false }; this.active = true }
  process(inputs) {
    if (!this.active) return false;
    const input = inputs[0]?.[0];
    if (input) for (const sample of input) {
      this.samples[this.used++] = sample;
      if (this.used === this.samples.length) {
        this.port.postMessage(this.samples, [this.samples.buffer]);
        this.samples = new Float32Array(1200); this.used = 0;
      }
    }
    return true;
  }
}
registerProcessor('gea-pcm-capture', Capture)`
let processorReady

async function prepareProcessor(ctx) {
  if (!processorReady) {
    const url = URL.createObjectURL(new Blob([processor], { type: 'text/javascript' }))
    processorReady = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url))
  }
  await processorReady
}

function encode(samples) {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
  }
  return btoa(String.fromCharCode(...bytes))
}

class BrowserPlayback {
  constructor(worker, id, sampleRate) {
    this.worker = worker
    this.id = id
    this.sampleRate = sampleRate
    this.ctx = audioContext()
    this.epoch = 0
    this.sources = new Set()
    this.total = 0
    this.origin = this.end = 0
    this.capturePackets = 0
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 256
    this.analyser.connect(this.ctx.destination)
    this.meter = new Float32Array(256)
    this.timer = setInterval(() => this.report(), 20)
  }

  report() {
    const played = this.origin ? Math.min(this.total, Math.max(0, this.ctx.currentTime - this.origin)) : 0
    this.analyser.getFloatTimeDomainData(this.meter)
    const energy = this.meter.reduce((sum, value) => sum + value * value, 0)
    this.worker.postMessage({ channel, operation: 'stats', id: this.id, epoch: this.epoch, stats: {
      playedMs: played * 1000, queuedMs: Math.max(0, this.total - played) * 1000,
      drained: this.sources.size === 0, audioLevel: Math.sqrt(energy / this.meter.length),
      capturePackets: this.capturePackets, capturePendingMs: 0, captureDroppedSamples: 0,
    } })
  }

  write(audio, epoch) {
    if (epoch !== this.epoch) return
    const bytes = Uint8Array.from(atob(audio), (value) => value.charCodeAt(0))
    const view = new DataView(bytes.buffer)
    const frames = Math.floor(bytes.length / 2)
    if (!frames) return
    const buffer = this.ctx.createBuffer(1, frames, this.sampleRate)
    const samples = buffer.getChannelData(0)
    for (let i = 0; i < frames; i++) samples[i] = view.getInt16(i * 2, true) / 32768
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.analyser)
    const start = Math.max(this.end, this.ctx.currentTime + 0.02)
    if (!this.origin) this.origin = start
    // Account for gaps too; the audible clock must never run past an item.
    if (this.end && start > this.end) this.origin += start - this.end
    this.end = start + buffer.duration
    this.total += buffer.duration
    this.sources.add(source)
    source.onended = () => { this.sources.delete(source); source.disconnect(); this.report() }
    source.start(start)
    void this.ctx.resume()
  }

  async input(stream) {
    if (this.capture) return
    await prepareProcessor(this.ctx)
    if (this.closed) return
    this.capture = new AudioWorkletNode(this.ctx, 'gea-pcm-capture')
    this.capture.port.onmessage = (event) => {
      this.capturePackets++
      this.worker.postMessage({ channel, operation: 'capture', id: this.id, audio: encode(event.data) })
    }
    this.microphone = this.ctx.createMediaStreamSource(stream)
    this.microphone.connect(this.capture)
    // The processor emits silence, keeping it scheduled without monitoring mic.
    this.capture.connect(this.ctx.destination)
  }

  reset(epoch) {
    this.epoch = epoch
    for (const source of this.sources) { source.onended = null; source.stop(); source.disconnect() }
    this.sources.clear()
    this.total = this.origin = this.end = 0
    this.report()
  }

  close() {
    this.closed = true
    clearInterval(this.timer)
    this.reset(this.epoch + 1)
    this.capture?.port.postMessage('stop')
    this.capture?.disconnect()
    this.microphone?.disconnect()
    this.analyser.disconnect()
  }
}

if (NativeWorker && typeof document !== 'undefined') {
  globalThis.Worker = class extends NativeWorker {
    constructor(url, options = {}) {
      let bootstrap
      if (options.type === 'module') {
        const host = new URL('./dom-audio-worker.mjs', import.meta.url).href
        const entry = new URL(url, document.baseURI).href
        bootstrap = URL.createObjectURL(new Blob([
          `import ${JSON.stringify(host)}; import ${JSON.stringify(entry)};`,
        ], { type: 'text/javascript' }))
      }
      super(bootstrap || url, options)
      if (bootstrap) URL.revokeObjectURL(bootstrap)
      this.streams = new Map()
      this.players = new Map()
      this.disposed = false
      this.addEventListener('message', (event) => {
        const data = event.data
        if (data?.channel !== channel) return
        event.stopImmediatePropagation()
        void this.audioCommand(data).catch((error) => {
          this.postMessage({ channel, operation: data.operation === 'media' ? 'media-result' : 'failure', id: data.id, error: error.message })
        })
      })
    }

    async audioCommand(data) {
      if (data.operation === 'media') {
        const stream = await navigator.mediaDevices.getUserMedia({ ...data.constraints,
          audio: { ...(typeof data.constraints.audio === 'object' ? data.constraints.audio : {}), echoCancellation: true },
        })
        if (this.disposed) { stream.getTracks().forEach((track) => track.stop()); return }
        this.streams.set(data.id, stream)
        this.postMessage({ channel, operation: 'media-result', id: data.id })
      } else if (data.operation === 'media-stop') {
        this.streams.get(data.id)?.getTracks().forEach((track) => track.stop())
        this.streams.delete(data.id)
      } else if (data.operation === 'create') {
        this.players.set(data.id, new BrowserPlayback(this, data.id, data.sampleRate))
      } else {
        const player = this.players.get(data.id)
        if (!player) return
        if (data.operation === 'input') await player.input(this.streams.get(data.streamId))
        else if (data.operation === 'write') player.write(data.audio, data.epoch)
        else if (data.operation === 'reset') player.reset(data.epoch)
        else if (data.operation === 'close') { player.close(); this.players.delete(data.id) }
      }
    }

    terminate() {
      this.disposed = true
      for (const player of this.players.values()) player.close()
      for (const stream of this.streams.values()) stream.getTracks().forEach((track) => track.stop())
      this.players.clear()
      this.streams.clear()
      super.terminate()
    }
  }
}
