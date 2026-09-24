// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { PNG } from 'pngjs';
import { interactions } from './interactions.mjs';
import { hoverControl, hoverControls, checkHoverControl } from './hover-control.mjs';
import { rotationListControl, checkRotationListControl } from './rotation-list-control.mjs';
import { threeDContextControl, checkThreeDContextControl } from './three-d-context-control.mjs';
import { firstLineFragmentControls, checkFirstLineFragments } from './first-line-control.mjs';
import { borderReliefControl, checkBorderReliefControl } from './border-relief-control.mjs';
import { scaleZControl, checkScaleZControl } from './scale-z-control.mjs';
import { textClipControl, checkTextClipControl, textEmphasisControl, checkTextEmphasisControl } from './text-clip-control.mjs';
import { Unsupported, parseDocument, comparePixels, reftestPass, failedPrerequisites } from './adapter.mjs';
import { ahemControl, ahemShorthandSource, checkAhemControl, whitespaceControls, lineBreakControls, firstLineControl, checkWhitespaceControl, chControl, lineHeightUnitControls, lineHeightInheritanceControls, backfaceControls, paragraphControls, boxEdgeControls } from './font-control.mjs';
import { sfntFont } from './fonts.mjs';
import { absoluteSizingControl, checkAbsoluteSizingControl, absolutePaddingBoxControl, checkAbsolutePaddingBoxControl, absoluteAutoInsetControl, checkAbsoluteAutoInsetControl } from './absolute-control.mjs';
import { orthogonalSizingControl, checkOrthogonalSizingControl } from './orthogonal-sizing-control.mjs';
import { absoluteDistributedControl, checkAbsoluteDistributedControl, absoluteBlockFlowControl, checkAbsoluteBlockFlowControl, zeroOriginControl, checkZeroOriginControl } from './absolute-control.mjs';
import { floatBreakControl, checkFloatBreakControl } from './float-break-control.mjs';
import { floatClearanceControl, checkFloatClearanceControl } from './float-clearance-control.mjs';
import { nestedFloatControl, checkNestedFloatControl } from './nested-float-control.mjs';
import { blockInInlineControl, checkBlockInInlineControl } from './block-in-inline-control.mjs';
import { borderInheritanceControl, checkBorderInheritanceControl } from './border-inheritance-control.mjs';
import { visibilityControl, checkVisibilityControl } from './visibility-control.mjs';
import { verticalFlowControl, checkVerticalFlowControl } from './vertical-flow-control.mjs';
import { individualTranslateControl, checkIndividualTranslateControl } from './individual-translate-control.mjs';
import { individualLinearControl, checkIndividualLinearControl } from './individual-linear-control.mjs';
import { canvasImageControl, checkCanvasImageControl } from './canvas-image-control.mjs';
import { marginTrimControl, checkMarginTrimControl } from './margin-trim-control.mjs';
import { unbreakableFloatControl, checkUnbreakableFloatControl } from './unbreakable-float-control.mjs';

const root = fileURLToPath(new URL('./', import.meta.url));
const out = fileURLToPath(new URL('../../dist/', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(`${root}/manifest.json`, 'utf8'));
const { values, positionals } = parseArgs({
  options: { limit: { type: 'string', default: 'all' } }, allowPositionals: true,
});
if (positionals.length > 1) throw new Error('Usage: wpt:run [filename substring] [--limit N|all] (default: all)');
if (values.limit !== 'all' && !/^[1-9]\d*$/.test(values.limit)) throw new Error('--limit must be a positive integer or all');
const limit = values.limit === 'all' ? manifest.tests.length : Number(values.limit);
if (!Number.isSafeInteger(limit)) throw new Error('--limit is too large');
const filter = positionals[0];
const selected = manifest.tests.filter(name => name.startsWith('css/') && (!filter || name.includes(filter))).slice(0, limit);
if (!selected.length) throw new Error(`No CSS tests match ${filter || 'the selection'}`);
const scope = { selected: selected.length, available: manifest.tests.filter(name => name.startsWith('css/')).length, limit: values.limit, filter: filter || null };
const build = JSON.parse(fs.readFileSync(`${out}/wpt-build.json`, 'utf8'));
function readBytes(name) {
  if (!Object.hasOwn(manifest.files, name)) throw new Error(`Unpinned resource: ${name}`);
  const bytes = fs.readFileSync(path.join(root, 'upstream', name));
  if (createHash('sha256').update(bytes).digest('hex') !== manifest.files[name]) throw new Error(`Upstream fixture modified: ${name}`);
  return bytes;
}
function read(name) { return readBytes(name).toString('utf8'); }
// Check every imported source before running anything; missing or altered
// fixtures are infrastructure errors, never skips or newly accepted baselines.
for (const name of Object.keys(manifest.files)) readBytes(name);
function render(document, actions = []) {
  const fonts = (document.fonts || []).map(font => ({ family: font.family, bytes: sfntFont(readBytes(font.path)).toString('base64') }));
  const r = spawnSync(process.execPath, [`${root}/render.mjs`], {
    input: JSON.stringify({ document, viewport: manifest.viewport, fonts, interactions: actions }),
    encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) throw new Error(`Renderer failed: ${r.error?.message || `exit ${r.status}, signal ${r.signal}`}\n${r.stderr || '(no worker diagnostics)'}`);
  const result = JSON.parse(r.stdout);
  result.pixels = Buffer.from(result.pixels, 'base64');
  if (result.pixels.length !== manifest.viewport.width * manifest.viewport.height * 4) throw new Error('Invalid framebuffer size');
  return result;
}
function png(name, pixels) {
  fs.writeFileSync(`${out}/${name}`, PNG.sync.write({ ...manifest.viewport, data: pixels }));
}
// A reftest comparing two empty/broken renderings must never turn the run green.
const canary = render(parseDocument('<!doctype html><html style="width:800px;height:600px"><body style="margin:0"><div id="probe" style="position:absolute;left:20px;top:30px;width:40px;height:50px;background:#ff0000"></div></body></html>', 'canary.html'));
const at = (x, y) => [...canary.pixels.subarray((y * manifest.viewport.width + x) * 4, (y * manifest.viewport.width + x) * 4 + 3)];
const probe = canary.nodes.find(n => n.attributes.some(([k, v]) => k === 'id' && v === 'probe'));
if (JSON.stringify(probe?.box) !== '[20,30,40,50]' || String(at(25, 35)) !== '255,0,0' || [[5, 5], [60, 35], [25, 80], [799, 599]].some(([x, y]) => String(at(x, y)) !== '255,255,255')) throw new Error(`Renderer canary failed: ${JSON.stringify({ box: probe?.box, inside: at(25, 35), outside: at(5, 5) })}`);
png('wpt-transport-control.png', canary.pixels);

// Transport works independently of these CSS capabilities. Keep failures as
// first-class results: identical images cannot establish conformance if a
// foundational feature is broken on BOTH sides. The named-color probe validates
// the disclosed adapter pre-pass plus rendering, not runtime keyword parsing.
const prerequisites = [];
{
  const rendered = render(parseDocument(textEmphasisControl, 'text-emphasis-control.html'));
  const result = checkTextEmphasisControl(rendered, manifest.viewport);
  const screenshot = 'wpt-prerequisite-text-emphasis.png';
  png(screenshot, rendered.pixels);
  prerequisites.push({ name:'text-emphasis', cssProperty:'text-emphasis', status:result.pass?'PASS':'FAIL', ...result, screenshot });
  console.log(`PREREQUISITE ${result.pass?'PASS':'FAIL'} text-emphasis: ${JSON.stringify(result.actual)}`);
}
for (const control of firstLineFragmentControls) {
  const rendered = render(parseDocument(control.source, `${control.name}.html`));
  const result = checkFirstLineFragments(rendered, manifest.viewport, control);
  const screenshot = `wpt-prerequisite-${control.name}.png`;
  png(screenshot, rendered.pixels);
  prerequisites.push({ name: control.name, cssPseudo: 'first-line', status: result.pass ? 'PASS' : 'FAIL', ...result, screenshot });
  console.log(`PREREQUISITE ${result.pass ? 'PASS' : 'FAIL'} ${control.name}: ${JSON.stringify(result.actual)}`);
}
for (const control of hoverControls) {
  const rendered = render(parseDocument(hoverControl, `${control.name}.html`), control.actions);
  const result = checkHoverControl(rendered, manifest.viewport, control);
  const screenshot = `wpt-prerequisite-${control.name}.png`;
  png(screenshot, rendered.pixels);
  prerequisites.push({ name: control.name, cssPseudo: 'hover', status: result.pass ? 'PASS' : 'FAIL', ...result, screenshot });
  console.log(`PREREQUISITE ${result.pass ? 'PASS' : 'FAIL'} ${control.name}: ${JSON.stringify(result.actual)}`);
}
for (const [name, source, check] of [
  ['border-relief', borderReliefControl, r => checkBorderReliefControl(r, manifest.viewport)],
  ['transform-scale-z', scaleZControl, r => checkScaleZControl(r, manifest.viewport)],
  ['background-clip-text', textClipControl, r => checkTextClipControl(r, manifest.viewport)],
  ['three-d-context-boundaries', threeDContextControl, r => checkThreeDContextControl(r, manifest.viewport)],
  ['rotation-list-composition', rotationListControl, r => checkRotationListControl(r, manifest.viewport)],
  ['unbreakable-text-and-floats', unbreakableFloatControl, r => checkUnbreakableFloatControl(r, manifest.viewport)],
  ['block-margin-trim', marginTrimControl, r => checkMarginTrimControl(r, manifest.viewport)],
  ['individual-rotate-scale', individualLinearControl, r => checkIndividualLinearControl(r, manifest.viewport)],
  ['canvas-background-images', canvasImageControl, r => checkCanvasImageControl(r, manifest.viewport)],
  ['individual-translate', individualTranslateControl, r => checkIndividualTranslateControl(r, manifest.viewport)],
  ['zero-transform-origin', zeroOriginControl, r => checkZeroOriginControl(r, manifest.viewport)],
  ['absolute-block-static-position', absoluteBlockFlowControl, r => checkAbsoluteBlockFlowControl(r, manifest.viewport)],
  ['block-in-inline-formatting', blockInInlineControl, r => checkBlockInInlineControl(r, manifest.viewport)],
  ['nested-float-clearance', nestedFloatControl, r => checkNestedFloatControl(r, manifest.viewport)],
  ['float-clearance-margins', floatClearanceControl, r => checkFloatClearanceControl(r, manifest.viewport)],
  ['computed-border-inheritance', borderInheritanceControl, r => checkBorderInheritanceControl(r, manifest.viewport)],
  ['visibility-and-flex-collapse', visibilityControl, r => checkVisibilityControl(r, manifest.viewport)],
  ['vertical-block-flow', verticalFlowControl, r => checkVerticalFlowControl(r, manifest.viewport)],
  ['orthogonal-inline-sizing', orthogonalSizingControl, r => checkOrthogonalSizingControl(r, manifest.viewport)],
  ['absolute-distributed-alignment', absoluteDistributedControl, r => checkAbsoluteDistributedControl(r, manifest.viewport)],
  ['float-clearing-line-breaks', floatBreakControl, r => checkFloatBreakControl(r, manifest.viewport)],
  ['absolute-static-position-sizing', absoluteSizingControl, r => checkAbsoluteSizingControl(r, manifest.viewport)],
  ['absolute-padding-box', absolutePaddingBoxControl, r => checkAbsolutePaddingBoxControl(r, manifest.viewport)],
  ['absolute-auto-inset-alignment', absoluteAutoInsetControl, r => checkAbsoluteAutoInsetControl(r, manifest.viewport)],
  ['float-formatting-context-height', `<!doctype html><style>
    body{margin:0}.holder{position:absolute;top:30px;width:50px}
    .box{width:40px;padding:5px;background:#000}.f{float:left;width:10px;height:40px;margin:7px 0 11px}
    #absolute{position:absolute;left:20px;top:30px}#fixed{position:fixed;left:100px;top:30px}
    #floated{float:left}#flex-holder{display:flex;align-items:start}#grid-holder{display:grid;align-items:start}
    .nested{position:absolute;top:30px}.wrapper{margin-top:10px;position:relative;top:30px}
    .nested .f{margin-top:0;margin-bottom:7px;position:relative;top:20px}
    </style><div id="absolute" class="box"><div class="f"></div></div>
    <div id="fixed" class="box"><div class="f"></div></div>
    <div class="holder" style="left:180px"><div id="floated" class="box"><div class="f"></div></div></div>
    <div id="flex-holder" class="holder" style="left:260px"><div id="flex-item" class="box"><div class="f"></div></div></div>
    <div id="grid-holder" class="holder" style="left:340px"><div id="grid-item" class="box"><div class="f"></div></div></div>
    <div class="holder" style="left:420px"><div id="ordinary" class="box"><div class="f"></div></div></div>
    <div id="nested" class="box nested" style="left:500px"><div class="wrapper"><div class="f"></div></div></div>
    <div id="isolated" class="box nested" style="left:580px"><div class="wrapper" style="overflow:hidden;height:15px"><div class="f"></div></div></div>
    <div id="limited" class="box nested" style="left:660px;max-height:25px"><div class="wrapper"><div class="f"></div></div></div>`, r => {
    const boxes = ['absolute', 'fixed', 'floated', 'flex-item', 'grid-item', 'ordinary', 'nested', 'isolated', 'limited'].map(id => r.nodes.find(n => n.attributes.some(([k, v]) => k === 'id' && v === id))?.box);
    const expectedBoxes = [20, 100, 180, 260, 340, 420, 500, 580, 660].map((x, i) => [x, 30, 50, [68, 68, 68, 68, 68, 10, 67, 35, 35][i]]);
    let differingPixels = 0;
    for (let y = 0; y < manifest.viewport.height; ++y) for (let x = 0; x < manifest.viewport.width; ++x) {
      const expected = expectedBoxes.some(([bx, by, bw, bh]) => x >= bx && x < bx + bw && y >= by && y < by + bh) ? 0 : 255;
      const i = (y * manifest.viewport.width + x) * 4;
      if ([0, 1, 2].some(c => r.pixels[i + c] !== expected)) ++differingPixels;
    }
    return { pass: JSON.stringify(boxes) === JSON.stringify(expectedBoxes) && differingPixels === 0,
      expected: { boxes: expectedBoxes, differingPixels: 0 }, actual: { boxes, differingPixels } };
  }],
  ['paint-order', '<!doctype html><style>body{margin:0}.parent{position:absolute;top:30px;width:80px;height:80px}.parent>div{width:60px;height:60px;grid-area:1/1/2/2}.grid{display:grid;grid-template:80px / 80px}.front{background:#000}.back{background:#f00}#positioned{left:20px}#positioned>.front{position:absolute}#floated{left:120px}#floated>.front{float:left}#zero{left:220px}#zero>.front{z-index:0}#hoisted{left:320px}</style><div id="positioned" class="parent grid"><div class="front"></div><div class="back"></div></div><div id="floated" class="parent"><div class="front"></div><div class="back"></div></div><div id="zero" class="parent grid"><div class="front"></div><div class="back"></div></div><div id="hoisted" class="parent"><div class="back" style="position:absolute;left:0;top:0"></div><div><div class="front" style="position:absolute;left:0;top:0;width:60px;height:60px"></div></div></div>', r => {
    let differingPixels = 0;
    for (let y = 0; y < manifest.viewport.height; ++y) for (let x = 0; x < manifest.viewport.width; ++x) {
      const expected = y >= 30 && y < 90 && ((x >= 20 && x < 80) || (x >= 120 && x < 180) || (x >= 220 && x < 280) || (x >= 320 && x < 380)) ? 0 : 255;
      const i = (y * manifest.viewport.width + x) * 4;
      if ([0, 1, 2].some(c => r.pixels[i + c] !== expected)) ++differingPixels;
    }
    return { pass: differingPixels === 0, expected: { differingPixels: 0 }, actual: { differingPixels } };
  }],
  ['absolute-containing-block-size', '<!doctype html><style>body{margin:0}.parent{position:absolute;top:30px;width:200px;height:200px}.absolute{position:absolute;width:50%;height:50%;background:#000}#grid{display:grid;left:20px;grid-template:100px 100px / 100px 100px}#grid>.wrapper{grid-area:1/1/2/2}#grid .absolute{grid-area:1/1/3/3}#block{left:140px}#block>.wrapper{width:40px;height:30px}#rtl{left:300px;direction:rtl}#rtl>.wrapper{width:40px;height:30px;padding:0 7px 0 3px}#rtl-child{margin-right:5px}</style><div id="grid" class="parent"><div class="wrapper"><div id="grid-child" class="absolute"></div></div></div><div id="block" class="parent"><div class="wrapper"><div id="block-child" class="absolute"></div></div></div><div id="rtl" class="parent"><div class="wrapper"><div id="rtl-child" class="absolute"></div></div></div>', r => {
    const boxes = ['grid-child', 'block-child', 'rtl-child'].map(id => r.nodes.find(n => n.attributes.some(([key, value]) => key === 'id' && value === id))?.box);
    const expectedBoxes = [[20, 30, 100, 100], [140, 30, 100, 100], [388, 30, 100, 100]];
    let differingPixels = 0;
    for (let y = 0; y < manifest.viewport.height; ++y) for (let x = 0; x < manifest.viewport.width; ++x) {
      const expected = y >= 30 && y < 130 && ((x >= 20 && x < 120) || (x >= 140 && x < 240) || (x >= 388 && x < 488)) ? 0 : 255;
      const i = (y * manifest.viewport.width + x) * 4;
      if ([0, 1, 2].some(c => r.pixels[i + c] !== expected)) ++differingPixels;
    }
    return { pass: JSON.stringify(boxes) === JSON.stringify(expectedBoxes) && differingPixels === 0,
      expected: { boxes: expectedBoxes, differingPixels: 0 }, actual: { boxes, differingPixels } };
  }],
  ['percentage-flex-basis', '<!doctype html><html style="width:800px;height:600px"><body style="margin:0"><div style="position:absolute;left:20px;top:30px;width:100px;height:40px;display:flex;background:red"><div id="row-first" style="flex-basis:50%;border-left:5px solid lime;background:lime"></div><div id="row-second" style="flex-basis:50%;border-right:6px solid lime;background:lime"></div></div><div style="position:absolute;left:20px;top:100px;width:40px;height:100px;display:flex;flex-direction:column;background:red"><div id="column-first" style="flex:0 0 calc(50% - 5px);padding-top:5px;height:1px;background:lime"></div><div id="column-second" style="flex:0 0 50%;height:1px;background:lime"></div></div></body></html>', r => {
    const ids = ['row-first', 'row-second', 'column-first', 'column-second'];
    const boxes = ids.map(id => r.nodes.find(n => n.attributes.some(([key, value]) => key === 'id' && value === id))?.box);
    const expectedBoxes = [[20, 30, 50, 40], [70, 30, 50, 40], [20, 100, 40, 50], [20, 150, 40, 50]];
    let differingPixels = 0;
    for (let y = 0; y < manifest.viewport.height; ++y) for (let x = 0; x < manifest.viewport.width; ++x) {
      const green = (x >= 20 && x < 120 && y >= 30 && y < 70) || (x >= 20 && x < 60 && y >= 100 && y < 200);
      const expected = green ? [0, 255, 0] : [255, 255, 255];
      const offset = (y * manifest.viewport.width + x) * 4;
      if (expected.some((channel, i) => r.pixels[offset + i] !== channel)) ++differingPixels;
    }
    return { pass: JSON.stringify(boxes) === JSON.stringify(expectedBoxes) && differingPixels === 0,
      expected: { boxes: expectedBoxes, differingPixels: 0 }, actual: { boxes, differingPixels } };
  }],
  ['empty-wrapper-float-position', '<!doctype html><html style="width:800px;height:600px"><body style="margin:0"><div style="position:absolute;left:20px;top:30px;width:200px"><div><div style="height:20px;margin-bottom:16px;background:red"></div><div><div id="probe" style="float:left;width:30px;height:40px;background:lime"></div></div></div></div></body></html>', r => {
    const box = r.nodes.find(n => n.attributes.some(([key, value]) => key === 'id' && value === 'probe'))?.box;
    let differingPixels = 0;
    for (let y = 0; y < manifest.viewport.height; ++y) for (let x = 0; x < manifest.viewport.width; ++x) {
      const expected = x >= 20 && x < 50 && y >= 66 && y < 106 ? [0, 255, 0]
        : x >= 20 && x < 220 && y >= 30 && y < 50 ? [255, 0, 0] : [255, 255, 255];
      const offset = (y * manifest.viewport.width + x) * 4;
      if (expected.some((channel, i) => r.pixels[offset + i] !== channel)) ++differingPixels;
    }
    return { pass: JSON.stringify(box) === '[20,66,30,40]' && differingPixels === 0,
      expected: { box: [20, 66, 30, 40], differingPixels: 0 }, actual: { box, differingPixels } };
  }],
  ['float-shrink-to-fit', '<!doctype html><html style="width:800px;height:600px"><body style="margin:0"><div style="position:absolute;left:20px;top:30px;width:200px;height:100px"><div id="probe" style="float:left;border:3px solid blue"><div style="float:left;width:40px;height:20px;background:red"></div><div style="float:right;width:40px;height:20px;background:lime"></div></div></div></body></html>', r => {
    const box = r.nodes.find(n => n.attributes.some(([key, value]) => key === 'id' && value === 'probe'))?.box;
    let differingPixels = 0;
    for (let y = 0; y < manifest.viewport.height; ++y) for (let x = 0; x < manifest.viewport.width; ++x) {
      const expected = x >= 23 && x < 103 && y >= 33 && y < 53 ? (x < 63 ? [255, 0, 0] : [0, 255, 0])
        : x >= 20 && x < 106 && y >= 30 && y < 56 ? [0, 0, 255] : [255, 255, 255];
      const offset = (y * manifest.viewport.width + x) * 4;
      if (expected.some((channel, i) => r.pixels[offset + i] !== channel)) ++differingPixels;
    }
    return { pass: JSON.stringify(box) === '[20,30,86,26]' && differingPixels === 0,
      expected: { box: [20, 30, 86, 26], differingPixels: 0 }, actual: { box, differingPixels } };
  }],
  ['background-curved-clip', '<!doctype html><html style="width:800px;height:600px"><body style="margin:0"><div style="position:absolute;left:20px;top:30px;width:50px;height:50px;border:25px solid transparent;border-radius:100% 0 0 0;background-color:red;background-clip:content-box"></div></body></html>', r => {
    let differingPixels = 0, checkedPixels = 0;
    for (let y = 0; y < manifest.viewport.height; ++y) for (let x = 0; x < manifest.viewport.width; ++x) {
      const inBox = x >= 45 && x < 95 && y >= 55 && y < 105;
      const distance = Math.hypot(x + 0.5 - 120, y + 0.5 - 130);
      // Independently check the geometric interior/exterior; the one-pixel
      // curve boundary is left to upstream's unchanged antialias tolerances.
      if (inBox && Math.abs(distance - 75) < 1) continue;
      ++checkedPixels;
      const expected = inBox && distance < 75 ? [255, 0, 0] : [255, 255, 255];
      const offset = (y * manifest.viewport.width + x) * 4;
      if (expected.some((channel, i) => r.pixels[offset + i] !== channel)) ++differingPixels;
    }
    return { pass: differingPixels === 0, expected: { differingPixels: 0 }, actual: { differingPixels, checkedPixels } };
  }],
  ['background-color-clipping', '<!doctype html><html style="width:800px;height:600px"><body style="margin:0"><div style="position:absolute;left:20px;top:30px;width:40px;height:40px;padding:10px;border:5px solid transparent;background-color:red;background-image:none,none;background-clip:border-box,content-box,border-box"></div><div style="position:absolute;left:120px;top:30px;width:40px;height:40px;padding:10px;border:5px solid transparent;background-color:lime;background-clip:padding-box"></div></body></html>', r => {
    let differingPixels = 0;
    for (let y = 0; y < manifest.viewport.height; ++y) for (let x = 0; x < manifest.viewport.width; ++x) {
      const expected = x >= 35 && x < 75 && y >= 45 && y < 85 ? [255, 0, 0]
        : x >= 125 && x < 185 && y >= 35 && y < 95 ? [0, 255, 0] : [255, 255, 255];
      const offset = (y * manifest.viewport.width + x) * 4;
      if (expected.some((channel, i) => r.pixels[offset + i] !== channel)) ++differingPixels;
    }
    return { pass: differingPixels === 0, expected: { differingPixels: 0 }, actual: { differingPixels } };
  }],
  ['contained-body-background', '<!doctype html><html style="width:800px;height:600px"><body style="position:absolute;left:20px;top:30px;width:40px;height:40px;margin:0;contain:paint;background:lime"></body></html>', r => {
    let differingPixels = 0;
    for (let y = 0; y < manifest.viewport.height; ++y) for (let x = 0; x < manifest.viewport.width; ++x) {
      const expected = x >= 20 && x < 60 && y >= 30 && y < 70 ? [0, 255, 0] : [255, 255, 255];
      const offset = (y * manifest.viewport.width + x) * 4;
      if (expected.some((channel, i) => r.pixels[offset + i] !== channel)) ++differingPixels;
    }
    return { pass: differingPixels === 0, expected: { differingPixels: 0 }, actual: { differingPixels } };
  }],
  ['document-canvas-background', '<!doctype html><html style="width:100px;height:0;margin:30px;background-color:transparent;background-image:none"><body style="width:40px;height:0;margin:20px;background-color:lime"></body></html>', r => {
    let differingPixels = 0;
    for (let offset = 0; offset < r.pixels.length; offset += 4)
      if (r.pixels[offset] !== 0 || r.pixels[offset + 1] !== 255 || r.pixels[offset + 2] !== 0) ++differingPixels;
    return { pass: differingPixels === 0, expected: { differingPixels: 0 }, actual: { differingPixels } };
  }],
  ['independent-background-layers', '<!doctype html><html style="width:800px;height:600px"><body style="margin:0"><div style="position:absolute;left:20px;top:30px;width:40px;height:40px;background-color:red;background-image:none"></div><div style="position:absolute;left:60px;top:30px;width:40px;height:40px;background-color:lime;background-image:linear-gradient(transparent,transparent)"></div><div style="position:absolute;left:100px;top:30px;width:40px;height:40px;background-image:linear-gradient(blue,blue);background-color:red"></div><div style="position:absolute;left:140px;top:30px;width:40px;height:40px;background-color:red;background:none"></div></body></html>', r => {
    let differingPixels = 0;
    for (let y = 0; y < manifest.viewport.height; ++y) for (let x = 0; x < manifest.viewport.width; ++x) {
      const expected = y >= 30 && y < 70 && x >= 20 && x < 140
        ? (x < 60 ? [255, 0, 0] : x < 100 ? [0, 255, 0] : [0, 0, 255]) : [255, 255, 255];
      const offset = (y * manifest.viewport.width + x) * 4;
      if (expected.some((channel, i) => r.pixels[offset + i] !== channel)) ++differingPixels;
    }
    return { pass: differingPixels === 0, expected: { differingPixels: 0 }, actual: { differingPixels } };
  }],
  ['alignment-shorthand-distribution', '<!doctype html><html style="width:800px;height:600px"><body style="margin:0"><div style="position:absolute;left:20px;top:30px;display:grid;grid:200px / 200px;width:400px;height:400px;background:blue;place-content:end space-evenly;place-items:center"><div id="probe" style="width:40px;height:20px;background:lime"></div></div></body></html>', r => {
    const box = r.nodes.find(n => n.attributes.some(([key, value]) => key === 'id' && value === 'probe'))?.box;
    let differingPixels = 0;
    for (let y = 0; y < manifest.viewport.height; ++y) for (let x = 0; x < manifest.viewport.width; ++x) {
      const expected = x >= 200 && x < 240 && y >= 320 && y < 340 ? [0, 255, 0]
        : x >= 20 && x < 420 && y >= 30 && y < 430 ? [0, 0, 255] : [255, 255, 255];
      const offset = (y * manifest.viewport.width + x) * 4;
      if (expected.some((channel, i) => r.pixels[offset + i] !== channel)) ++differingPixels;
    }
    return { pass: JSON.stringify(box) === '[200,320,40,20]' && differingPixels === 0,
      expected: { box: [200, 320, 40, 20], differingPixels: 0 }, actual: { box, differingPixels } };
  }],
  ['named-color-red', '<!doctype html><html style="width:800px;height:600px"><body style="margin:0"><div id="probe" style="position:absolute;left:20px;top:30px;width:40px;height:50px;background:red"></div></body></html>', r => {
    const offset = (35 * manifest.viewport.width + 25) * 4;
    const actual = [...r.pixels.subarray(offset, offset + 3)];
    return { pass: String(actual) === '255,0,0', expected: [255, 0, 0], actual };
  }],
  ['asymmetric-border-widths', '<!doctype html><html style="width:800px;height:600px"><body style="margin:0"><div id="probe" style="position:absolute;left:20px;top:30px;width:20px;height:20px;background:#ff0000;border:solid #0000ff;border-width:1.9px 2.9px 3.9px 4.9px"></div></body></html>', r => {
    let differingPixels = 0;
    for (let y = 0; y < manifest.viewport.height; y++) for (let x = 0; x < manifest.viewport.width; x++) {
      const border = x >= 20 && x < 46 && y >= 30 && y < 54;
      const content = x >= 24 && x < 44 && y >= 31 && y < 51;
      const expected = content ? [255, 0, 0] : border ? [0, 0, 255] : [255, 255, 255];
      const offset = (y * manifest.viewport.width + x) * 4;
      if (expected.some((value, channel) => r.pixels[offset + channel] !== value)) differingPixels++;
    }
    const box = r.nodes.find(n => n.attributes.some(([k, v]) => k === 'id' && v === 'probe'))?.box;
    return { pass: differingPixels === 0 && String(box) === '20,30,26,24', expected: { box: [20, 30, 26, 24], differingPixels: 0 }, actual: { box, differingPixels } };
  }],
  ['body-author-margin', '<!doctype html><style>body { margin:0 }</style><html style="width:800px;height:600px"><body><div style="width:20px;height:20px;background:#ff0000"></div></body></html>', r => {
    const actual = r.nodes.find(n => n.tag === 'body')?.box.slice(0, 2);
    return { pass: String(actual) === '0,0', expected: [0, 0], actual };
  }],
  ['border-current-color', '<!doctype html><style>.box { position:absolute; top:30px; width:20px; height:20px; border:4px solid; } .explicit { border-color:#0000ff; border-color:currentColor; }</style><html style="width:800px;height:600px"><body style="margin:0;color:#ff0000"><div class="box" style="left:20px"></div><div class="box explicit" style="left:60px;color:#00ff00"></div></body></html>', r => {
    let differingPixels = 0;
    for (let y = 0; y < manifest.viewport.height; y++) for (let x = 0; x < manifest.viewport.width; x++) {
      let expected = [255, 255, 255];
      for (const left of [20, 60]) {
        const outer = x >= left && x < left + 28 && y >= 30 && y < 58;
        const inner = x >= left + 4 && x < left + 24 && y >= 34 && y < 54;
        if (outer && !inner) expected = left === 20 ? [255, 0, 0] : [0, 255, 0];
      }
      const offset = (y * manifest.viewport.width + x) * 4;
      if (expected.some((value, channel) => r.pixels[offset + channel] !== value)) differingPixels++;
    }
    return { pass: differingPixels === 0, expected: { differingPixels: 0 }, actual: { differingPixels } };
  }],
  ['inset-shadow-padding-contour', '<!doctype html><html style="width:800px;height:600px"><body style="margin:0"><div style="position:absolute;left:20px;top:30px;width:20px;height:16px;padding:2px;border:4px solid transparent;box-shadow:inset 5px -3px 0 2px #ff0000"></div></body></html>', r => {
    let differingPixels = 0;
    for (let y = 0; y < manifest.viewport.height; y++) for (let x = 0; x < manifest.viewport.width; x++) {
      const paddingBox = x >= 24 && x < 48 && y >= 34 && y < 54;
      const hole = x >= 31 && x < 51 && y >= 33 && y < 49;
      const expected = paddingBox && !hole ? [255, 0, 0] : [255, 255, 255];
      const offset = (y * manifest.viewport.width + x) * 4;
      if (expected.some((value, channel) => r.pixels[offset + channel] !== value)) differingPixels++;
    }
    return { pass: differingPixels === 0, expected: { differingPixels: 0 }, actual: { differingPixels } };
  }],
]) {
  const rendered = render(parseDocument(source, `${name}.html`));
  const result = check(rendered);
  const screenshot = `wpt-prerequisite-${name}.png`;
  png(screenshot, rendered.pixels);
  prerequisites.push({ name, status: result.pass ? 'PASS' : 'FAIL', ...result, screenshot });
  console.log(`PREREQUISITE ${result.pass ? 'PASS' : 'FAIL'} ${name}: expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(result.actual)}`);
}
for (const [name, document] of [
  ['pinned-ahem-font', ahemControl],
  ['html-font-shorthand', parseDocument(ahemShorthandSource, 'ahem-shorthand.html', { readResource: read })],
]) {
  const rendered = render(document);
  const result = checkAhemControl(rendered, manifest.viewport, name === 'html-font-shorthand');
  const screenshot = `wpt-prerequisite-${name}.png`;
  png(screenshot, rendered.pixels);
  prerequisites.push({ name, status: result.pass ? 'PASS' : 'FAIL', ...result, screenshot });
  console.log(`PREREQUISITE ${result.pass ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(result.actual)}`);
}
for (const control of [...whitespaceControls, ...lineBreakControls, firstLineControl, chControl, ...lineHeightUnitControls, ...lineHeightInheritanceControls, ...backfaceControls, ...paragraphControls, ...boxEdgeControls]) {
  const rendered = render(parseDocument(control.source, `${control.name}.html`, { readResource: read }));
  const result = checkWhitespaceControl(rendered, manifest.viewport, control);
  const screenshot = `wpt-prerequisite-${control.name}.png`;
  png(screenshot, rendered.pixels);
  prerequisites.push({ name: control.name, cssUnit: control.cssUnit, cssPseudo: control.cssPseudo, htmlTag: control.htmlTag, status: result.pass ? 'PASS' : 'FAIL', ...result, screenshot });
  console.log(`PREREQUISITE ${result.pass ? 'PASS' : 'FAIL'} ${control.name}: expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(result.actual)}`);
}
const invalidReferenceFoundation = failedPrerequisites(prerequisites, []).length > 0;

const results = [];
for (const name of selected) {
  const result = { test: name, status: 'ERROR' };
  try {
    const doc = parseDocument(read(name), name, { readResource: read });
    if (!doc.references.length) throw new Unsupported('Not a reftest');
    // Preflight all references before executing either side.
    const references = doc.references.map(ref => ({ ...ref, document: parseDocument(read(ref.path), ref.path, { readResource: read }) }));
    const failures = failedPrerequisites(prerequisites, [doc, ...references.map(ref => ref.document)]);
    Object.assign(result, { title: doc.title, specs: doc.specs, properties: doc.properties, normalizations: doc.normalizations, fonts: doc.fonts });
    const actual = render(doc, interactions[name]);
    if (actual.interactions.length) result.interactions = actual.interactions;
    const stem = `wpt-${manifest.tests.indexOf(name)}`;
    result.actual = `${stem}-actual.png`;
    png(result.actual, actual.pixels);
    fs.writeFileSync(`${out}/${stem}-actual.json`, JSON.stringify(actual.nodes, null, 2));
    result.geometry = `${stem}-actual.json`;
    result.comparisons = references.map((ref, i) => {
      const expected = render(ref.document);
      const { diff, ...comparison } = comparePixels(actual.pixels, expected.pixels, doc.fuzzy);
      const reference = `${stem}-reference-${i}.png`, difference = `${stem}-diff-${i}.png`;
      png(reference, expected.pixels);
      png(difference, diff);
      const geometry = `${stem}-reference-${i}.json`;
      fs.writeFileSync(`${out}/${geometry}`, JSON.stringify(expected.nodes, null, 2));
      return { ...comparison, relation: ref.relation, path: ref.path, reference, difference, geometry, fuzzy: doc.fuzzy, normalizations: ref.document.normalizations, fonts: ref.document.fonts };
    });
    result.status = reftestPass(result.comparisons) ? (failures.length ? 'BLOCKED' : 'PASS') : 'FAIL';
    if (failures.length) {
      result.failedPrerequisites = failures.map(p => p.name);
      result.reason = `CSS prerequisites failed (${result.failedPrerequisites.join(', ')}): matching test/reference images may share the same defect. Fix prerequisites before interpreting feature conformance.`;
    }
  } catch (error) {
    result.status = error instanceof Unsupported ? 'SKIP' : 'ERROR';
    result.reason = error.message;
  }
  results.push(result);
  console.log(`${result.status} ${name}${result.reason ? ` — ${result.reason}` : ''}${result.comparisons ? ` — ${result.comparisons.map(c => `${c.totalPixels} differing pixels`).join(', ')}` : ''}`);
}
const summary = Object.fromEntries(['PASS', 'FAIL', 'BLOCKED', 'SKIP', 'ERROR'].map(s => [s, results.filter(r => r.status === s).length]));
const preprocessing = { namedColors: 'CSS Color 4 named colors to RGB hex in the test adapter; runtime keyword parsing is not tested' };
const report = { revision: manifest.revision, scope, viewport: manifest.viewport, build, preprocessing, prerequisites, summary, results };
fs.writeFileSync(`${out}/wpt-results.json`, JSON.stringify(report, null, 2) + '\n');
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const upstream = name => `https://github.com/web-platform-tests/wpt/blob/${manifest.revision}/${name}`;
fs.writeFileSync(`${out}/wpt-report.html`, `<!doctype html><meta charset="utf-8"><title>Gea · WPT CSS reftests</title>
<style>body{font:16px system-ui;margin:32px;color:#17202a;background:#f5f6f8}h1{margin-bottom:8px}article{background:white;padding:20px;margin:20px 0;border:1px solid #ccd2d8}section{display:flex;gap:12px;overflow:auto}figure{margin:0;min-width:260px;flex:1}img{width:100%;image-rendering:pixelated;border:1px solid #ddd}a{color:#154d91}code{overflow-wrap:anywhere}.FAIL,.ERROR{color:#b12020}.PASS{color:#17602e}.SKIP,.BLOCKED{color:#795300}</style>
<h1>Gea · WPT CSS reftests</h1><p>Simulator RGB565 · ${manifest.viewport.width} × ${manifest.viewport.height} CSS pixels · DPR 1</p>
<p>${scope.selected} selected CSS tests out of ${scope.available} imported. Selection follows corpus order, before rendering; skipped tests count toward the selection.${filter ? ` Filename filter: <code>${escape(filter)}</code>.` : ''}</p>
<p>Upstream revision <code>${manifest.revision}</code></p><p>${escape(JSON.stringify(summary))}</p>
<p>Color pre-pass: standard named colors are converted to equivalent RGB hex values in the test adapter. Upstream files and runtime are unchanged. Results do not test runtime color-name parsing; the JSON report records every converted declaration.</p>
<p>HTML subset with explicit pointer actions for registered manual tests and pinned fonts and ASCII/degree text. Default serif uses upstream Gentium Plus. Basic paragraph defaults and block margin collapsing are exercised; font variants, other scripts, and further HTML/display modes remain unfinished. Both test and reference use Gea. These are subset results, not a claim of full CSS conformance. Magenta marks differing pixels. <a href="wpt-results.json">Machine-readable report and build provenance</a></p>
<h2>CSS prerequisites</h2><p>These independent probes prevent shared test/reference bugs from producing false passes. The Ahem checks exercise native fonts, inheritance, shorthand, whitespace and font-relative sizing. A failed scoped probe blocks matching comparisons only when the test or a reference uses that CSS unit, property, pseudo-element, or HTML element; unequal images still fail. <a href="wpt-transport-control.png">Verified transport control (hexadecimal red)</a></p>${prerequisites.map(p => `<p class="${p.status}">${p.status} · <a href="${p.screenshot}">${p.name}</a>${p.cssUnit ? ` · applies to ${escape(p.cssUnit)} dependencies` : ''}${p.cssPseudo ? ` · applies to ${p.cssPseudo === 'hover' ? ':' : '::'}${escape(p.cssPseudo)} dependencies` : ''}${p.cssProperty ? ` · applies to ${escape(p.cssProperty)} declarations` : ''}${p.htmlTag ? ` · applies to &lt;${escape(p.htmlTag)}&gt; dependencies` : ''} · expected ${escape(JSON.stringify(p.expected))}, actual ${escape(JSON.stringify(p.actual))}</p>`).join('')}
${results.map(r => `<article><h2 class="${r.status}">${r.status} · <a href="${upstream(r.test)}">${escape(path.basename(r.test))}</a></h2>${r.reason ? `<p>${escape(r.reason)}</p>` : ''}${r.interactions ? `<p>Automated interactions: <code>${escape(JSON.stringify(r.interactions))}</code></p>` : ''}${r.geometry ? `<p><a href="${r.geometry}">Actual node geometry</a></p>` : ''}${(r.comparisons || []).map(c => `<p>${escape(c.relation)} · ${c.totalPixels} differing pixels · maximum channel difference ${c.maxDifference} · <a href="${upstream(c.path)}">Upstream reference</a> · <a href="${c.geometry}">Reference geometry</a></p><section>${[['Actual', r.actual], ['Reference', c.reference], ['Difference', c.difference]].map(([label, src]) => `<figure><figcaption>${label}</figcaption><a href="${src}"><img src="${src}" alt="${label}"></a></figure>`).join('')}</section>`).join('')}</article>`).join('')}`);
console.log(JSON.stringify(summary));
console.log(`${out}/wpt-report.html`);
process.exitCode = summary.ERROR ? 2 : summary.FAIL || summary.BLOCKED || invalidReferenceFoundation || !summary.PASS ? 1 : 0;
