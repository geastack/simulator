// SPDX-License-Identifier: Apache-2.0
// One process and one WASM instance per document: bounded memory, no stale tree.
import fs from 'node:fs';
import { text as readText } from 'node:stream/consumers';
import createRenderer from '../../dist/wpt-renderer.mjs';
import { interactionPoint } from './interactions.mjs';
const started = performance.now();
const trace = stage => fs.writeSync(2, `[wpt-render ${Math.round(performance.now() - started)}ms] ${stage}\n`);
trace('reading-input');
// Large pinned fonts travel over a pipe. Drain it through libuv instead of a
// synchronous fd read: intermittent macOS stalls were traced to that read,
// before WASM initialization. Keep the parent's timeout and error reporting.
const { document, viewport, fonts = [], interactions = [] } = JSON.parse(await readText(process.stdin));
trace('initializing-wasm');
const module = await createRenderer({ print: console.error, printErr: console.error });
trace('wasm-ready');
const call = (name, type, types, args) => module.ccall(`wpt_${name}`, type, types, args);
if (!call('init', 'number', ['number', 'number'], [viewport.width, viewport.height])) throw new Error('Framebuffer allocation failed');
for (const font of fonts) {
  const bytes = Buffer.from(font.bytes, 'base64');
  const pointer = module._malloc(bytes.length);
  if (!pointer) throw new Error('Font allocation failed');
  try {
    module.HEAPU8.set(bytes, pointer);
    if (call('font', 'number', ['string', 'number', 'number'], [font.family, pointer, bytes.length]) < 0)
      throw new Error(`Font loading failed: ${font.family}`);
  } finally { module._free(pointer); }
}
const nodes = [];
trace('fonts-ready');
function create(n, parent) {
  const id = n.tag === '#text'
    ? call('text', 'number', ['string', 'number'], [n.text, parent])
    : call('element', 'number', ['string', 'number'], [n.tag, parent]);
  if (id < 0) throw new Error('Node allocation failed');
  nodes.push({ id, tag: n.tag, attributes: n.attributes });
  for (const [name, value] of n.attributes) call('attribute', null, ['number', 'string', 'string'], [id, name, value]);
  for (const [property, value] of n.inline) call('inline', null, ['number', 'string', 'string'], [id, property, value]);
  for (const child of n.children) create(child, id);
  return id;
}
const root = create(document.tree, -1);
for (const rule of document.rules) for (const [property, value] of rule.declarations) call('rule', null, ['string', 'string', 'string'], [rule.selector, property, value]);
trace('painting');
call('render', null, ['number', 'number', 'number'], [root, viewport.width, viewport.height]);
trace('painted');
const performed = [];
for (const action of interactions) {
  for (const n of nodes) n.box = [0, 1, 2, 3].map(field => call('geometry', 'number', ['number', 'number'], [n.id, field]));
  const point = interactionPoint(action, nodes);
  const hit = call('hover', 'number', ['number', 'number', 'number', 'number', 'number'],
    [root, viewport.width, viewport.height, point.x, point.y]);
  if (point.nodeId !== undefined && hit !== point.nodeId) throw new Error(`Hover missed ${action.target}: hit node ${hit}, expected ${point.nodeId}`);
  performed.push({ ...action, ...point, hit });
}
const ptr = call('pixels', 'number', [], []);
if (!ptr) throw new Error('Missing framebuffer');
const pixels = new Uint16Array(module.HEAPU8.buffer, ptr, viewport.width * viewport.height);
const rgba = Buffer.alloc(pixels.length * 4);
for (let i = 0; i < pixels.length; i++) {
  const p = pixels[i], r = (p >> 11) & 31, g = (p >> 5) & 63, b = p & 31;
  rgba[i * 4] = (r << 3) | (r >> 2);
  rgba[i * 4 + 1] = (g << 2) | (g >> 4);
  rgba[i * 4 + 2] = (b << 3) | (b >> 2);
  rgba[i * 4 + 3] = 255;
}
for (const n of nodes) n.box = [0, 1, 2, 3].map(field => call('geometry', 'number', ['number', 'number'], [n.id, field]));
trace('writing-output');
process.stdout.write(JSON.stringify({ pixels: rgba.toString('base64'), nodes, interactions: performed }), () => trace('output-flushed'));
process.once('beforeExit', () => trace('before-exit'));
// This diagnostic timer cannot keep a completed worker alive. If the worker
// stalls after rendering, capture the resources preventing normal exit.
setTimeout(() => trace(`still-alive resources=${JSON.stringify(process.getActiveResourcesInfo())}`), 25000).unref();
