// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inflateSync } from 'node:zlib';
import { sfntFont } from './fonts.mjs';

const woff = fs.readFileSync(new URL('./upstream/fonts/GentiumPlus-R.woff', import.meta.url));
test('WOFF decoding preserves every pinned font table and rebuilds a valid SFNT checksum', () => {
  const sfnt = sfntFont(woff);
  const count = woff.readUInt16BE(12);
  assert.equal(sfnt.length, woff.readUInt32BE(16));
  assert.equal(sfnt.readUInt16BE(4), count);
  let checksum = 0;
  for (let i = 0; i < sfnt.length; i += 4) checksum = (checksum + sfnt.readUInt32BE(i)) >>> 0;
  assert.equal(checksum, 0xb1b0afba);
  for (let i = 0; i < count; i++) {
    const src = 44 + i * 20, dst = 12 + i * 16;
    assert.equal(sfnt.readUInt32BE(dst), woff.readUInt32BE(src));
    const offset = woff.readUInt32BE(src + 4), compressed = woff.readUInt32BE(src + 8), length = woff.readUInt32BE(src + 12);
    const raw = woff.subarray(offset, offset + compressed);
    const original = Buffer.from(compressed < length ? inflateSync(raw) : raw);
    const actual = Buffer.from(sfnt.subarray(sfnt.readUInt32BE(dst + 8), sfnt.readUInt32BE(dst + 8) + length));
    // checkSumAdjustment depends on reconstructed directory/table offsets.
    if (woff.toString('ascii', src, src + 4) === 'head') { original.fill(0, 8, 12); actual.fill(0, 8, 12); }
    assert.deepEqual(actual, original);
  }
});

test('font decoder rejects malformed WOFF tables and unsupported containers', () => {
  assert.throws(() => sfntFont(Buffer.alloc(4)), /Truncated/);
  assert.throws(() => sfntFont(Buffer.alloc(12)), /Unsupported/);
  for (const mutate of [
    b => b.writeUInt32BE(0, 8),
    b => b.writeUInt32BE(0xffffffff, 16),
    b => b.writeUInt32BE(b.length, 48),
    b => b.writeUInt32BE(0, 60),
  ]) { const corrupt = Buffer.from(woff); mutate(corrupt); assert.throws(() => sfntFont(corrupt)); }
  const ttf = fs.readFileSync(new URL('./upstream/fonts/Ahem.ttf', import.meta.url));
  assert.equal(sfntFont(ttf), ttf);
});
