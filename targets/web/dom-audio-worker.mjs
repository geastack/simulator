// Browser worker side of Gea's PCM host. Browser microphone and speaker APIs
// live on Window; protocol handling and WebSocket upload stay in this worker.
const channel = 'gea-browser-audio'
const pending = new Map()
const players = new Map()
let sequence = 0

function send(operation, fields = {}) {
  self.postMessage({ channel, operation, ...fields })
}

self.addEventListener('message', (event) => {
  const data = event.data
  if (data?.channel !== channel) return
  event.stopImmediatePropagation()
  if (data.operation === 'media-result') {
    const request = pending.get(data.id)
    if (!request) return
    pending.delete(data.id)
    if (data.error) request.reject(new Error(data.error))
    else request.resolve({
      __geaStreamId: data.id,
      getTracks: () => [{ kind: 'audio', stop: () => send('media-stop', { id: data.id }) }],
    })
  } else {
    const player = players.get(data.id)
    if (!player) return
    if (data.operation === 'stats' && data.epoch === player.epoch) Object.assign(player, data.stats)
    else if (data.operation === 'capture' && player.socket?.readyState === 1) {
      player.socket.send(player.prefix + data.audio + player.suffix)
    } else if (data.operation === 'failure') {
      // Deliver host failures through the worker's normal error path.
      setTimeout(() => { throw new Error(data.error) }, 0)
    }
  }
})

Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: {
    getUserMedia(constraints) {
      const id = ++sequence
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        send('media', { id, constraints })
      })
    },
  },
})

class PcmAudioStream {
  constructor(sampleRate) {
    this.id = ++sequence
    this.epoch = 0
    this.playedMs = this.queuedMs = this.audioLevel = 0
    this.capturePackets = this.capturePendingMs = this.captureDroppedSamples = 0
    this.drained = true
    this.socket = null
    players.set(this.id, this)
    send('create', { id: this.id, sampleRate })
  }

  setInput(stream) { send('input', { id: this.id, streamId: stream.__geaStreamId }) }
  pipeTo(socket, prefix, suffix) { this.socket = socket; this.prefix = prefix; this.suffix = suffix }
  writeBase64(audio) {
    this.drained = false
    send('write', { id: this.id, epoch: this.epoch, audio })
  }
  resetPlayback() {
    this.epoch++
    this.playedMs = this.queuedMs = this.audioLevel = 0
    this.drained = true
    send('reset', { id: this.id, epoch: this.epoch })
  }
  close() {
    send('close', { id: this.id })
    players.delete(this.id)
    this.socket = null
  }
}

Object.assign(globalThis, { PcmAudioStream })
