import { describe, expect, it, vi } from 'vitest'

describe('simulator fetch parity', () => {
  it('passes method + headers + body through to the runtime fetch', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )

    const response = await fetch('http://signaling.test/offer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sdp: 'v=0...' })
    })

    expect(spy).toHaveBeenCalledWith(
      'http://signaling.test/offer',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"sdp":"v=0..."}'
      })
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.text()).toBe('{}')

    spy.mockRestore()
  })
})
