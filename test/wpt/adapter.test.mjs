// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { Unsupported, parseDocument, parseFuzzy, comparePixels, reftestPass, localReference, usesCssUnit, failedPrerequisites } from './adapter.mjs';
import { namedColors, normalizeNamedColors } from './named-colors.mjs';
import { checkAhemControl } from './font-control.mjs';
import { defaultFont, ahemFont } from './fonts.mjs';
import { interactionPoint } from './interactions.mjs';

test('hover automation requires an unambiguous nonempty target and preserves CSS', () => {
  const nodes = [{ id: 3, attributes: [['id', 'square'], ['class', 'green square']], box: [20, 30, 100, 80] }];
  assert.deepEqual(interactionPoint({ type: 'hover', target: '.green' }, nodes), { x: 70, y: 70, nodeId: 3 });
  assert.deepEqual(interactionPoint({ type: 'hover', target: null }, nodes), { x: -1, y: -1 });
  assert.throws(() => interactionPoint({ type: 'hover', target: '#missing' }, nodes), /found 0/);
  assert.throws(() => interactionPoint({ type: 'hover', target: '.green' }, [...nodes, ...nodes]), /found 2/);
  assert.throws(() => interactionPoint({ type: 'hover', target: '.green' }, [{ ...nodes[0], box: [20, 30, 0, 80] }]), /empty box/);
  const doc = parseDocument('<!doctype html><style>.green:hover{transform:scale(2)}</style><div class="green"></div>', 'hover.html');
  assert.deepEqual(doc.rules, [{ selector: '.green:hover', declarations: [['transform', 'scale(2)']] }]);
  const failed = [{ name: 'hover', pass: false, cssPseudo: 'hover' }];
  assert.deepEqual(failedPrerequisites(failed, [doc]), failed);
  assert.deepEqual(failedPrerequisites(failed, [parseDocument('<!doctype html><div></div>', 'plain.html')]), []);
});

test('normalizes standard named colors in color declarations and shorthands', () => {
  assert.equal(Object.keys(namedColors).length, 148);
  assert.equal(normalizeNamedColors('background', 'ReD'), '#ff0000');
  assert.equal(normalizeNamedColors('color', 'green'), '#008000');
  assert.equal(normalizeNamedColors('color', 'lime'), '#00ff00');
  assert.equal(normalizeNamedColors('border', '1px solid blue'), '1px solid #0000ff');
  assert.equal(normalizeNamedColors('border-color', 'gray grey rebeccapurple'), '#808080 #808080 #663399');
  assert.equal(normalizeNamedColors('box-shadow', '0 0 2px red, inset 1px 2px blue'), '0 0 2px #ff0000, inset 1px 2px #0000ff');
  assert.equal(normalizeNamedColors('background-image', 'linear-gradient(red, blue)'), 'linear-gradient(#ff0000, #0000ff)');
});

test('does not rewrite strings, URLs, identifiers, custom properties or existing color syntax', () => {
  for (const [property, value] of [
    ['font-family', 'red'], ['animation-name', 'blue'], ['content', '"red"'],
    ['--theme', 'red'], ['border-style', 'red'], ['border-radius', 'red'],
    ['background', 'url(red)'], ['background', 'url("blue.png")'],
    ['color', 'var(--red, blue)'], ['color', 'currentColor'], ['color', 'transparent'],
    ['color', '#ff0000'], ['color', 'rgb(255, 0, 0)'], ['color', 'rgba(1, 2, 3, 0.5)'],
    ['background', '"red"'], ['color', 'not-red'], ['color', 'redder'],
  ]) assert.equal(normalizeNamedColors(property, value), value);
  assert.equal(normalizeNamedColors('background', 'url(red) red /* blue */'), 'url(red) #ff0000 /* blue */');
});

test('applies the same pre-pass to stylesheet and inline declarations and records it', () => {
  const doc = parseDocument('<!doctype html><style>.red {background:red}</style><div class="red" id="blue" style="border:1px solid blue"></div>', 'test.html');
  assert.equal(doc.rules[0].selector, '.red');
  assert.deepEqual(doc.rules[0].declarations, [['background', '#ff0000']]);
  assert.deepEqual(doc.tree.children[0].children[0].inline, [['border', '1px solid #0000ff']]);
  assert.deepEqual(doc.normalizations, [{ property: 'background', from: 'red', to: '#ff0000' }, { property: 'border', from: '1px solid blue', to: '1px solid #0000ff' }]);
});

test('passes original selectors, ordered duplicate declarations and inline values to Gea', () => {
  const doc = parseDocument('<!doctype html><link rel="match" href="ref.html"><style>#a > div { width:10px; width:50%; }</style><div id="a" style="height:20px"><div></div></div>', 'css/test.html');
  assert.deepEqual(doc.rules, [{ selector: '#a > div', declarations: [['width', '10px'], ['width', '50%']] }]);
  assert.deepEqual(doc.references, [{ relation: 'match', path: 'css/ref.html' }]);
  assert.deepEqual(doc.tree.children[0].children[0].inline, [['height', '20px']]);
});

test('fails closed on unsupported document semantics instead of weakening the test', () => {
  for (const body of ['<script>doSomething()</script>', '<div onclick="run()"></div>', '<img src="a.png">', '<style>@media print {div{width:1px}}</style>', '<style>div{display:inline-block}</style>', '<style>div{color:red!important}</style>', '<html class="reftest-wait"></html>', '<link rel="stylesheet" href="a.css">', '<style>div{background:url(a.png)}</style>']) {
    assert.throws(() => parseDocument(`<!doctype html>${body}`, 'test.html'), Unsupported, body);
  }
  assert.throws(() => parseDocument('<div></div>', 'test.html'), /Quirks/);
  assert.throws(() => localReference('css/a.html', 'https://example.com/a.html'), Unsupported);
});

test('splits selector lists for the native one-selector-per-rule API', () => {
  const doc = parseDocument('<!doctype html><style>html, body {margin:0}</style>', 'test.html');
  assert.deepEqual(doc.rules.map(r => r.selector), ['html', 'body']);
  assert.deepEqual(doc.rules.map(r => r.declarations), [[['margin', '0']], [['margin', '0']]]);
});

test('pixel comparison counts a changed pixel once and honors BOTH fuzzy ranges', () => {
  const a = Buffer.from([0, 0, 0, 255, 20, 20, 20, 255]);
  const b = Buffer.from([0, 0, 0, 255, 22, 23, 24, 255]);
  assert.equal(comparePixels(a, a).matches, true);
  const result = comparePixels(a, b);
  assert.equal(result.matches, false);
  assert.equal(result.totalPixels, 1);
  assert.equal(result.maxDifference, 4);
  assert.equal(comparePixels(a, b, parseFuzzy('maxDifference=0-4;totalPixels=0-1')).matches, true);
  assert.equal(comparePixels(a, b, parseFuzzy('0-3;0-1')).matches, false);
  assert.equal(comparePixels(a, b, parseFuzzy('0-4;0')).matches, false);
  assert.equal(comparePixels(a, a, parseFuzzy('1-4;1')).matches, false);
  assert.throws(() => comparePixels(a, b.subarray(4)), /dimensions/);
});

test('WPT multiple-reference semantics: any match and every mismatch', () => {
  assert.equal(reftestPass([{ relation: 'match', matches: false }, { relation: 'match', matches: true }, { relation: 'mismatch', matches: false }]), true);
  assert.equal(reftestPass([{ relation: 'match', matches: true }, { relation: 'mismatch', matches: true }]), false);
  assert.equal(reftestPass([{ relation: 'mismatch', matches: false }]), true);
  assert.throws(() => reftestPass([]), /No references/);
});

// Grid uses the same native stylesheet and layout path as application nodes.
test('transports grid layout declarations without resolving their geometry', () => {
  const doc = parseDocument('<!doctype html><div style="display:grid;grid-template-columns:40px 1fr;gap:10px 20px"><div></div><div></div></div>', 'grid.html');
  assert.deepEqual(doc.tree.children[0].children[0].inline, [
    ['display', 'grid'], ['grid-template-columns', '40px 1fr'], ['gap', '10px 20px'],
  ]);
});

test('loads pinned external CSS in document order without rewriting declarations', () => {
  const reads = [];
  const doc = parseDocument('<!doctype html><style>div{width:10px}</style><link rel="stylesheet" href="../support/box.css"><style>div{width:30px}</style><div></div>', 'css/tests/box.html', {
    readResource(name) { reads.push(name); return 'div { width:20px; background: red }'; },
  });
  assert.deepEqual(reads, ['css/support/box.css']);
  assert.deepEqual(doc.rules.map(r => r.declarations[0]), [['width', '10px'], ['width', '20px'], ['width', '30px']]);
  assert.deepEqual(doc.rules[1].declarations[1], ['background', '#ff0000']);
  assert.throws(() => parseDocument('<!doctype html><link rel="stylesheet" href="a.css" media="print"><div></div>', 'box.html', { readResource() { assert.fail('Must reject before loading'); } }), /Stylesheet media condition/);
});

test('font-face resolves font URLs relative to the declaring stylesheet and deduplicates identical families', () => {
  const doc = parseDocument('<!doctype html><link rel="stylesheet" href="../fonts/font.css"><style>@font-face {font-family: Test; src:url(../fonts/Test.ttf) format("truetype")}</style><div></div>', 'css/tests/test.html', {
    readResource(name) {
      assert.equal(name, 'css/fonts/font.css');
      return '@font-face {font-family:"Test"; src:url(Test.ttf); font-weight:400; font-style:normal}';
    },
  });
  assert.deepEqual(doc.fonts, [defaultFont, { family: 'Test', path: 'css/fonts/Test.ttf' }, ahemFont]);
  assert.deepEqual(doc.rules, []);
  const woff = parseDocument('<!doctype html><style>@font-face{font-family:Other;src:url(other.woff) format("woff")}</style>', 'test.html');
  assert.ok(woff.fonts.some(font => font.family === 'Other' && font.path === 'other.woff'));
  for (const declaration of [
    'src:url(a.woff2)', 'src:local(Ahem)', 'src:url(a.ttf),url(b.ttf)',
    'src:url(a.ttf);font-weight:700', 'src:url(a.ttf);font-style:italic',
    'src:url(a.ttf);unicode-range:U+20-7f', 'src:url(https://example.org/a.ttf)',
  ]) assert.throws(() => parseDocument(`<!doctype html><style>@font-face{font-family:Ahem;${declaration}}</style>`, 'test.html'), Unsupported);
});

test('Ahem control rejects blank output and wrong metrics independently of reftest equality', () => {
  const viewport = { width: 100, height: 60 };
  const pixels = Buffer.alloc(100 * 60 * 4, 255);
  const nodes = [{ tag: '#text', box: [20, 30, 60, 20] }];
  assert.equal(checkAhemControl({ pixels, nodes }, viewport).pass, false);
  for (let y = 30; y < 50; y++) for (const start of [20, 60]) for (let x = start; x < start + 20; x++)
    pixels.fill(0, (y * 100 + x) * 4, (y * 100 + x) * 4 + 3);
  assert.equal(checkAhemControl({ pixels, nodes }, viewport).pass, true);
  nodes[0].box[2] = 59;
  assert.equal(checkAhemControl({ pixels, nodes }, viewport).pass, false);
});

test('failed unit prerequisites apply to test or reference dependencies, without blocking unrelated comparisons', () => {
  const plain = parseDocument('<!doctype html><style>.ch{font-family:"5ch";width:20px}</style><div class="ch"></div>', 'plain.html');
  const ch = parseDocument('<!doctype html><div style="width:calc(2px + var(--size, 5CH))"></div>', 'ch.html');
  assert.equal(usesCssUnit(plain, 'ch'), false);
  assert.equal(usesCssUnit(ch, 'ch'), true);
  const scoped = { name: 'ch', cssUnit: 'ch', pass: false };
  const global = { name: 'font', pass: false };
  assert.deepEqual(failedPrerequisites([scoped], [plain]), []);
  assert.deepEqual(failedPrerequisites([scoped], [plain, ch]), [scoped]);
  assert.deepEqual(failedPrerequisites([scoped], [ch, plain]), [scoped]);
  assert.deepEqual(failedPrerequisites([{ ...scoped, pass: true }], [ch]), []);
  assert.deepEqual(failedPrerequisites([global, scoped], [plain]), [global]);
  assert.deepEqual(failedPrerequisites([global, scoped], []), [global]);
  const paragraph = parseDocument('<!doctype html><p>Text</p>', 'paragraph.html');
  const tagProbe = { name: 'paragraph', htmlTag: 'p', pass: false };
  assert.deepEqual(failedPrerequisites([tagProbe], [plain]), []);
  assert.deepEqual(failedPrerequisites([tagProbe], [plain, paragraph]), [tagProbe]);
  assert.deepEqual(failedPrerequisites([tagProbe], []), []);
  const percent = parseDocument('<!doctype html><div style="padding:calc(10px + var(--edge, 5%))"></div>', 'percent.html');
  const percentProbe = { name: 'percentage-box-edges', cssUnit: '%', pass: false };
  assert.equal(usesCssUnit(percent, '%'), true);
  assert.deepEqual(failedPrerequisites([percentProbe], [plain]), []);
  assert.deepEqual(failedPrerequisites([percentProbe], [plain, percent]), [percentProbe]);
});

test('pseudo-element prerequisites block shared false matches without blocking unrelated selectors', () => {
  const probe = { name: 'first-line-background', cssPseudo: 'first-line', pass: false };
  const plain = parseDocument('<!doctype html><style>[data-label="::first-line"]{color:red}.first-line{color:red}div::first-letter{color:red}</style><div>X</div>', 'plain.html');
  for (const selector of ['div::first-line', 'div:first-line', 'div::FIRST-LINE']) {
    const doc = parseDocument(`<!doctype html><style>${selector}{background:black}</style><div>X X</div>`, 'pseudo.html');
    assert.deepEqual(failedPrerequisites([probe], [plain, doc]), [probe]);
    assert.deepEqual(failedPrerequisites([probe], [doc, plain]), [probe]);
    assert.deepEqual(failedPrerequisites([{ ...probe, pass: true }], [doc]), []);
  }
  assert.deepEqual(failedPrerequisites([probe], [plain]), []);
  assert.deepEqual(failedPrerequisites([probe], []), []);
});

test('property prerequisites scope false-match guards to declarations on either side', () => {
  const probe = {name:'text-emphasis',cssProperty:'text-emphasis',pass:false};
  const plain = parseDocument('<!doctype html><div class="text-emphasis" style="font-family:text-emphasis">X</div>', 'plain.html');
  for (const css of ['text-emphasis:filled dot', 'text-emphasis-style:filled dot']) {
    const doc = parseDocument(`<!doctype html><div style="${css}">X</div>`, 'emphasis.html');
    assert.deepEqual(failedPrerequisites([probe], [plain,doc]), [probe]);
    assert.deepEqual(failedPrerequisites([probe], [doc,plain]), [probe]);
    assert.deepEqual(failedPrerequisites([{...probe,pass:true}], [doc]), []);
  }
  assert.deepEqual(failedPrerequisites([probe], [plain]), []);
  assert.deepEqual(failedPrerequisites([probe], []), []);
});

test('text transport preserves text and whitespace in source order with a pinned default font', () => {
  const doc = parseDocument('<!doctype html><div> <!--comment--> X <span>Y</span>\n Z </div>', 'text.html');
  const children = doc.tree.children[0].children[0].children;
  assert.equal(children[0].tag, '#text');
  assert.equal(children[0].text, '  X ');
  assert.equal(children[1].tag, 'span');
  assert.equal(children[1].children[0].text, 'Y');
  assert.equal(children[2].text, '\n Z ');
  assert.deepEqual(children[0].inline, []);
  assert.deepEqual(doc.fonts, [defaultFont, ahemFont]);
  assert.throws(() => parseDocument('<!doctype html><div>\u4e00</div>', 'text.html'), /codepoint/);
});


test('transports BR elements and their styles without rewriting text or synthesizing layout', () => {
  const doc = parseDocument('<!doctype html><div>X<br id="break" style="display:none"> Y<br><br></div>', 'breaks.html');
  const children = doc.tree.children[0].children[0].children;
  assert.deepEqual(children.map(n => n.tag), ['#text', 'br', '#text', 'br', 'br']);
  assert.equal(children[0].text, 'X');
  assert.equal(children[2].text, ' Y');
  assert.deepEqual(children[1].attributes, [['id', 'break']]);
  assert.deepEqual(children[1].inline, [['display', 'none']]);
  const prerequisite = { name: 'br-between-text', htmlTag: 'br', pass: false };
  assert.deepEqual(failedPrerequisites([prerequisite], [doc]), [prerequisite]);
  assert.deepEqual(failedPrerequisites([prerequisite], [parseDocument('<!doctype html><div>X</div>', 'plain.html')]), []);
});
