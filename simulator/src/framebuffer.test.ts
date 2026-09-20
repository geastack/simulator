import { describe, expect, it } from 'vitest'
import { rgb565ToRgba } from './framebuffer'

describe('rgb565ToRgba', () => {
  it('converts white exactly', () => {
    expect(Array.from(rgb565ToRgba(new Uint16Array([0xffff])))).toEqual([255, 255, 255, 255])
  })
})
