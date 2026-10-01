import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

function host() {
  const sent = []
  let receive
  const scope = {
    navigator: {},
    self: { postMessage: (data) => sent.push(data), addEventListener: (_name, listener) => { receive = listener } },
    setTimeout,
  }
  runInNewContext(readFileSync(new URL('../dom-audio-worker.mjs', import.meta.url), 'utf8'), scope)
  return {
    scope, sent,
    deliver(data) { receive({ data: { channel: 'gea-browser-audio', ...data }, stopImmediatePropagation() {} }) },
  }
}

test('microphone acquisition is delegated to Window and its tracks release the host stream', async () => {
  const { scope, sent, deliver } = host()
  const result = scope.navigator.mediaDevices.getUserMedia({ audio: true })
  assert.equal(sent[0].operation, 'media')
  const id = sent[0].id
  deliver({ operation: 'media-result', id })
  const stream = await result
  stream.getTracks()[0].stop()
  assert.equal(sent.at(-1).operation, 'media-stop')
  assert.equal(sent.at(-1).id, id)
})

test('capture uploads in the worker and old playback metrics cannot revive an interrupted queue', () => {
  const { scope, sent, deliver } = host()
  const audio = new scope.PcmAudioStream(24000)
  const outbound = []
  audio.pipeTo({ readyState: 1, send: (data) => outbound.push(data) }, '{"audio":"', '"}')
  deliver({ operation: 'capture', id: audio.id, audio: 'AAAA' })
  assert.equal(outbound[0], '{"audio":"AAAA"}')
  audio.writeBase64('AAAA')
  assert.equal(audio.drained, false)
  audio.resetPlayback(true)
  assert.equal(audio.drained, true)
  deliver({ operation: 'stats', id: audio.id, epoch: 0, stats: { drained: false, queuedMs: 1000 } })
  assert.equal(audio.queuedMs, 0)
  deliver({ operation: 'stats', id: audio.id, epoch: 1, stats: { playedMs: 40 } })
  assert.equal(audio.playedMs, 40)
  audio.close()
  deliver({ operation: 'capture', id: audio.id, audio: 'BBBB' })
  assert.equal(outbound.length, 1)
  assert.equal(sent.at(-1).operation, 'close')
})
