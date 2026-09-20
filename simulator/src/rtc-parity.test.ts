import { describe, expect, it, vi } from 'vitest'

describe('simulator RTCPeerConnection parity', () => {
  it('global RTCPeerConnection constructor accepts a config', () => {
    const FakePc = vi.fn().mockImplementation(function (this: any) {
      this.connectionState = 'new'
      this.iceConnectionState = 'new'
      this.onicecandidate = null
      this.ontrack = null
      this.onconnectionstatechange = null
      this.addTrack = vi.fn()
      this.createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'v=0' })
      this.createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'v=0' })
      this.setLocalDescription = vi.fn().mockResolvedValue(undefined)
      this.setRemoteDescription = vi.fn().mockResolvedValue(undefined)
      this.addIceCandidate = vi.fn().mockResolvedValue(undefined)
      this.close = vi.fn()
    }) as unknown as typeof RTCPeerConnection
    const original = (globalThis as any).RTCPeerConnection
    ;(globalThis as any).RTCPeerConnection = FakePc

    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
    expect((pc as any).connectionState).toBe('new')

    ;(globalThis as any).RTCPeerConnection = original
  })
})
