export function rgb565ToRgba(
  input: Uint16Array,
  output?: Uint8ClampedArray<ArrayBuffer>
): Uint8ClampedArray<ArrayBuffer> {
  const out =
    output && output.length >= input.length * 4
      ? output
      : new Uint8ClampedArray(new ArrayBuffer(input.length * 4))
  const out32 = new Uint32Array(out.buffer, out.byteOffset, input.length)

  for (let i = 0; i < input.length; i++) {
    const pixel = input[i]
    const r = (pixel >> 11) & 0x1f
    const g = (pixel >> 5) & 0x3f
    const b = pixel & 0x1f

    out32[i] = 0xff000000 | (((b << 3) | (b >> 2)) << 16) | (((g << 2) | (g >> 4)) << 8) | ((r << 3) | (r >> 2))
  }

  return out
}

export function framebufferView(bytes: Uint8Array, ptr: number, width: number, height: number): Uint16Array {
  return new Uint16Array(bytes.buffer, ptr, width * height)
}
