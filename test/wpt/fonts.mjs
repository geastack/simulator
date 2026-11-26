// SPDX-License-Identifier: Apache-2.0
import { inflateSync } from 'node:zlib';

export const defaultFont = { family: 'serif', path: 'fonts/GentiumPlus-R.woff' };
export const ahemFont = { family: 'Ahem', path: 'fonts/Ahem.ttf' };
// Rig-owned fonts live in test/wpt/fonts, outside the pinned upstream corpus,
// each pinned by its SHA-256. The CSS monospace family is DejaVu Sans Mono 2.35,
// unmodified, under the Bitstream Vera license in fonts/LICENSE-DejaVu.txt.
export const monospaceFont = {
  family: 'monospace', path: 'DejaVuSansMono.ttf', rig: true,
  sha256: '602ec86b8948cfcd956482fe64f94c36c867770149ef2f791d4613f443bcecb3',
};
const padded = n => Math.ceil(n / 4) * 4;
function checksum(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    let word = 0;
    for (let j = 0; j < 4; j++) word = ((word << 8) | (bytes[i + j] || 0)) >>> 0;
    sum = (sum + word) >>> 0;
  }
  return sum;
}

// WOFF1 only wraps the original SFNT tables in optional zlib compression.
// Reconstruct the directory and checksum; preserve the font's table contents.
// This is test asset decoding, not replacement glyph metrics or rasterization.
export function sfntFont(bytes) {
  if (bytes.length < 12) throw new Error('Truncated font');
  if (bytes.readUInt32BE(0) === 0x00010000) return bytes;
  if (bytes.toString('ascii', 0, 4) !== 'wOFF') throw new Error('Unsupported font container');
  if (bytes.length < 44 || bytes.readUInt32BE(4) !== 0x00010000 || bytes.readUInt32BE(8) !== bytes.length || bytes.readUInt16BE(14) !== 0)
    throw new Error('Invalid TrueType WOFF header');
  const count = bytes.readUInt16BE(12), total = bytes.readUInt32BE(16);
  if (!count || count > 4095 || bytes.length < 44 + count * 20 || total > 32 * 1024 * 1024 || total < 12 + count * 16)
    throw new Error('Invalid WOFF directory size');
  const out = Buffer.alloc(total);
  out.writeUInt32BE(0x00010000, 0);
  out.writeUInt16BE(count, 4);
  const power = Math.floor(Math.log2(count));
  out.writeUInt16BE(16 * 2 ** power, 6);
  out.writeUInt16BE(power, 8);
  out.writeUInt16BE(count * 16 - 16 * 2 ** power, 10);
  let cursor = 12 + count * 16, head = -1, previous = -1;
  const ranges = [];
  for (let i = 0; i < count; i++) {
    const d = 44 + i * 20, tag = bytes.readUInt32BE(d);
    const offset = bytes.readUInt32BE(d + 4), compressed = bytes.readUInt32BE(d + 8), length = bytes.readUInt32BE(d + 12);
    const expected = bytes.readUInt32BE(d + 16);
    if (tag <= previous || offset % 4 || offset < 44 + count * 20 || !length || compressed > length || offset + compressed > bytes.length || cursor + padded(length) > total || ranges.some(([a,b]) => offset < b && offset + compressed > a))
      throw new Error('Invalid WOFF table bounds');
    previous = tag;
    ranges.push([offset, offset + compressed]);
    const input = bytes.subarray(offset, offset + compressed);
    const table = Buffer.from(compressed < length ? inflateSync(input, { maxOutputLength: length }) : input);
    if (table.length !== length) throw new Error('Invalid WOFF decompressed length');
    if (tag === 0x68656164) {
      if (length < 12) throw new Error('Invalid font head table');
      head = cursor;
      table.writeUInt32BE(0, 8);
    }
    if (checksum(table) !== expected) throw new Error('WOFF table checksum mismatch');
    const entry = 12 + i * 16;
    out.writeUInt32BE(tag, entry);
    out.writeUInt32BE(expected, entry + 4);
    out.writeUInt32BE(cursor, entry + 8);
    out.writeUInt32BE(length, entry + 12);
    table.copy(out, cursor);
    cursor += padded(length);
  }
  if (cursor !== total || head < 0) throw new Error('Invalid WOFF reconstructed size or missing head');
  out.writeUInt32BE((0xb1b0afba - checksum(out)) >>> 0, head + 8);
  return out;
}
