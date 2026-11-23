#!/usr/bin/env node
// Instantiates a web-skia bundle, runs app_init and a few app_frame calls, and
// prints the decoded display list (SKIA-TARGET.md, version 1), one op per line.
//
//   node dump-list.mjs <bundle-dir> [--width 410] [--height 502] [--dpr 1.5] [--frames 3] [--every] [--images <out-dir>] [--census]
//
// <bundle-dir> holds module.js and module.wasm (build-skia.mjs output). By
// default only the last frame's list is printed; --every prints each frame's.
// --images reads every image the printed lists reference through the
// skia_image_* exports, prints its size and an FNV-1a checksum of the RGBA
// bytes, and writes it to <out-dir>/image-<id>-g<generation>.png. --census
// prints, per printed frame, the engine commands the list skipped (count and
// clipped bounding-box area per command type) and the screen area covered by
// translated and skipped commands.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import zlib from 'node:zlib'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : fallback
}
const bundleDir = path.resolve(args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? '.')
const width = Number(option('width', 410))
const height = Number(option('height', 502))
const dpr = Number(option('dpr', 1.5))
const frames = Number(option('frames', 3))
const every = args.includes('--every')
const imagesDir = option('images')
const census = args.includes('--census')

const OPS = { 1: 'Save', 2: 'Restore', 3: 'Translate', 4: 'ClipRect', 5: 'ClipRRect', 6: 'FillRRect', 7: 'Border', 8: 'TextLine', 9: 'SaveLayerAlpha', 10: 'Image', 11: 'Concat', 12: 'Vertices', 13: 'LinearGradient', 14: 'RadialGradient', 17: 'Path', 18: 'SaveLayerBlur' }
const referencedImages = new Map()

const { default: createModule } = await import(pathToFileURL(path.join(bundleDir, 'module.js')).href)
const module = await createModule({
  locateFile: (file) => URL.createObjectURL(new Blob([fs.readFileSync(path.join(bundleDir, file))], { type: 'application/wasm' })),
  print: (text) => process.stderr.write(`[wasm] ${text}\n`),
  printErr: (text) => process.stderr.write(`[wasm] ${text}\n`)
})
if (typeof module._get_skia_list_ptr !== 'function') throw new Error('Not a Skia bundle: get_skia_list_ptr is not exported')

if (census) module._skia_census_enable(1)
const status = module._app_init(width, height, dpr)
if (status !== 0) throw new Error(`app_init returned ${status}`)
for (let frame = 0; frame < frames; frame++) {
  module._app_frame(Math.round(frame * 16.67))
  if (every || frame === frames - 1) {
    const ptr = module._get_skia_list_ptr()
    const size = module._get_skia_list_size()
    console.log(`# frame ${frame}`)
    console.log(decode(module.HEAPU8.slice(ptr, ptr + size)).join('\n'))
    if (imagesDir) dumpImages()
    if (census) console.log(`# census ${cString(module._get_skia_census())}`)
  }
}

function cString(ptr) {
  return new TextDecoder().decode(module.HEAPU8.subarray(ptr, module.HEAPU8.indexOf(0, ptr)))
}

function dumpImages() {
  fs.mkdirSync(imagesDir, { recursive: true })
  for (const [id, generation] of referencedImages) {
    const width = module._skia_image_width(id)
    const height = module._skia_image_height(id)
    const ptr = module._skia_image_pixels(id)
    if (!ptr) {
      console.log(`# image ${id} g${generation} ${width}x${height} unavailable`)
      continue
    }
    const rgba = module.HEAPU8.slice(ptr, ptr + width * height * 4)
    let hash = 0x811c9dc5
    for (const byte of rgba) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0
    const file = path.join(imagesDir, `image-${id}-g${generation}.png`)
    fs.writeFileSync(file, png(width, height, rgba))
    console.log(`# image ${id} g${generation} ${width}x${height} fnv=${hash.toString(16).padStart(8, '0')} -> ${file}`)
  }
  referencedImages.clear()
}

function png(width, height, rgba) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(zlib.crc32(body), body.length + 4)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function decode(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u32 = (offset) => view.getUint32(offset, true)
  const f32 = (offset) => view.getFloat32(offset, true)
  const lines = []
  if (u32(0) !== 0x4c4b5347) throw new Error(`bad magic 0x${u32(0).toString(16)}`)
  const header = {
    version: view.getUint16(4, true),
    flags: view.getUint16(6, true),
    width: u32(8),
    height: u32(12),
    opsOffset: u32(16),
    opsSize: u32(20),
    stringsOffset: u32(24),
    stringsSize: u32(28),
    fontsOffset: u32(32),
    fontsCount: u32(36)
  }
  const utf8 = new TextDecoder()
  const string = (offset, length) => utf8.decode(bytes.subarray(header.stringsOffset + offset, header.stringsOffset + offset + length))
  lines.push(
    `header version=${header.version} flags=${header.flags}${header.flags & 1 ? ' (unchanged)' : ''} viewport=${header.width}x${header.height} ` +
      `ops=${header.opsSize}B strings=${header.stringsSize}B fonts=${header.fontsCount} total=${bytes.byteLength}B`
  )
  for (let i = 0; i < header.fontsCount; i++) {
    const at = header.fontsOffset + i * 16
    lines.push(`font id=${u32(at)} file=${JSON.stringify(string(u32(at + 4), u32(at + 8)))}`)
  }
  const n = (value) => (Number.isInteger(value) ? String(value) : value.toFixed(2))
  const rect = (at) => `[${n(f32(at))},${n(f32(at + 4))} ${n(f32(at + 8))},${n(f32(at + 12))}]`
  const radii = (at) => {
    const values = [0, 4, 8, 12].map((k) => f32(at + k))
    return values.every((v) => v === 0) ? '' : ` radii=${values.map(n).join(',')}`
  }
  const color = (value) => `#${value.toString(16).padStart(8, '0')}`
  let at = header.opsOffset
  const end = header.opsOffset + header.opsSize
  let depth = 0
  let maxDepth = 0
  let count = 0
  const counts = {}
  while (at < end) {
    const opcode = view.getUint16(at, true)
    const size = u32(at + 4)
    if (size < 8 || size % 4 !== 0 || at + size > end) throw new Error(`bad op size ${size} at ${at}`)
    const p = at + 8
    const name = OPS[opcode] ?? `Unknown(${opcode})`
    counts[name] = (counts[name] ?? 0) + 1
    if (opcode === 2) depth--
    let detail = ''
    if (opcode === 3) detail = `dx=${n(f32(p))} dy=${n(f32(p + 4))}`
    else if (opcode === 4) detail = rect(p)
    else if (opcode === 5) detail = `${rect(p)}${radii(p + 16)}`
    else if (opcode === 6) detail = `${rect(p)}${radii(p + 16)} ${color(u32(p + 32))}`
    else if (opcode === 7) {
      const widths = [0, 4, 8, 12].map((k) => n(f32(p + 32 + k)))
      const colors = [0, 4, 8, 12].map((k) => color(u32(p + 48 + k)))
      detail = `${rect(p)}${radii(p + 16)} widths=${new Set(widths).size === 1 ? widths[0] : widths.join(',')} colors=${new Set(colors).size === 1 ? colors[0] : colors.join(',')}`
    } else if (opcode === 8)
      detail = `x=${n(f32(p))} baseline=${n(f32(p + 4))} font=${u32(p + 8)} size=${n(f32(p + 12))} ${color(u32(p + 16))} ${JSON.stringify(string(u32(p + 20), u32(p + 24)))}`
    else if (opcode === 9) detail = `${rect(p)} alpha=${n(f32(p + 16))}`
    else if (opcode === 10) {
      referencedImages.set(u32(p), u32(p + 4))
      detail = `id=${u32(p)} gen=${u32(p + 4)} src=${rect(p + 8)} dst=${rect(p + 24)}`
    } else if (opcode === 11) {
      const m = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => f32(p + k * 4))
      const affine = m[6] === 0 && m[7] === 0 && m[8] === 1
      const cell = (v) => String(+v.toPrecision(5))
      detail = `[${cell(m[0])} ${cell(m[1])} ${cell(m[2])} | ${cell(m[3])} ${cell(m[4])} ${cell(m[5])} | ${cell(m[6])} ${cell(m[7])} ${cell(m[8])}] ${affine ? 'affine' : 'perspective'}`
    } else if (opcode === 12) {
      const count = u32(p)
      const box = [Infinity, Infinity, -Infinity, -Infinity]
      for (let i = 0; i < count; i++) {
        const x = f32(p + 8 + i * 8)
        const y = f32(p + 12 + i * 8)
        box[0] = Math.min(box[0], x)
        box[1] = Math.min(box[1], y)
        box[2] = Math.max(box[2], x)
        box[3] = Math.max(box[3], y)
      }
      const first = [0, 1, 2].map((i) => `(${n(f32(p + 8 + i * 8))},${n(f32(p + 12 + i * 8))} ${color(u32(p + 8 + count * 8 + i * 4))})`).join(' ')
      detail = `triangles=${count / 3} blend=${view.getUint8(p + 4) ? 'add' : 'over'} alpha=${view.getUint8(p + 5)} bbox=[${box.map(n).join(',')}] first=${first}`
    } else if (opcode === 13 || opcode === 14) {
      const stops = Array.from({ length: u32(p + 48) }, (_, i) => `${n(f32(p + 52 + i * 8))}:${color(u32(p + 56 + i * 8))}`).join(' ')
      const geometry = opcode === 13 ? `from=(${n(f32(p + 32))},${n(f32(p + 36))}) to=(${n(f32(p + 40))},${n(f32(p + 44))})` : `centre=(${n(f32(p + 32))},${n(f32(p + 36))}) r=${n(f32(p + 40))},${n(f32(p + 44))}`
      detail = `${rect(p)}${radii(p + 16)} ${geometry} stops=${stops}`
    } else if (opcode === 17) {
      const contours = u32(p + 8)
      const box = [Infinity, Infinity, -Infinity, -Infinity]
      let points = 0
      for (let i = 0, q = p + 12; i < contours; i++) {
        const count = u32(q)
        q += 4
        for (let k = 0; k < count; k++, q += 8) {
          box[0] = Math.min(box[0], f32(q))
          box[1] = Math.min(box[1], f32(q + 4))
          box[2] = Math.max(box[2], f32(q))
          box[3] = Math.max(box[3], f32(q + 4))
        }
        points += count
      }
      detail = `${u32(p) ? 'evenodd' : 'nonzero'} ${color(u32(p + 4))} contours=${contours} points=${points} bbox=[${box.map(n).join(',')}]`
    } else if (opcode === 18) detail = `${rect(p)} sigma=${n(f32(p + 16))},${n(f32(p + 20))}`
    lines.push(`${'  '.repeat(Math.max(depth, 0))}${name}${detail ? ' ' + detail : ''}`)
    if (opcode === 1 || opcode === 9 || opcode === 18) maxDepth = Math.max(maxDepth, ++depth)
    at += size
    count++
  }
  lines.push(
    `# ${count} ops (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}); save/restore ${depth === 0 ? 'balanced' : `UNBALANCED (depth ${depth})`}, max depth ${maxDepth}`
  )
  return lines
}
