import { describe, expect, it, vi } from 'vitest'

describe('simulator WebSocket parity', () => {
  it('global WebSocket constructor accepts a url string', () => {
    const original = globalThis.WebSocket
    const FakeWs = vi.fn().mockImplementation(function (this: any, url: string) {
      this.url = url
      this.readyState = 0
      this.onopen = null
      this.onmessage = null
      this.onclose = null
      this.onerror = null
      this.send = vi.fn()
      this.close = vi.fn()
    }) as unknown as typeof WebSocket
    ;(globalThis as any).WebSocket = FakeWs

    const ws = new WebSocket('ws://signaling.test/room')
    expect((ws as any).url).toBe('ws://signaling.test/room')
    expect((ws as any).readyState).toBe(0)

    ws.send('hi')
    expect((ws as any).send).toHaveBeenCalledWith('hi')
    ws.close()
    expect((ws as any).close).toHaveBeenCalled()

    ;(globalThis as any).WebSocket = original
  })
})
