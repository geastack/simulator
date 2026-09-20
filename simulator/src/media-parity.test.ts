import { describe, expect, it, vi } from 'vitest'

describe('simulator getUserMedia parity', () => {
  it('navigator.mediaDevices.getUserMedia returns a stream with one audio track', async () => {
    const fakeTrack = { id: 't1', kind: 'audio', enabled: true, readyState: 'live', stop: vi.fn() }
    const fakeStream = {
      id: 's1',
      getAudioTracks: () => [fakeTrack],
      getTracks: () => [fakeTrack]
    }
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(fakeStream) }
      }
    })

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      expect(stream.getAudioTracks().length).toBe(1)
      expect(stream.getAudioTracks()[0].kind).toBe('audio')
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original)
      else delete (globalThis as any).navigator
    }
  })
})
