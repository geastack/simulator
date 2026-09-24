// SPDX-License-Identifier: Apache-2.0
// Independent Ahem control: two 20px squares separated by one 20px space.
// Uses the same font registry and native text renderer as imported documents.
export const ahemControl = {
  fonts: [{ family: 'Ahem', path: 'fonts/Ahem.ttf' }],
  rules: [],
  tree: {
    tag: 'html', attributes: [], inline: [], children: [{
      tag: '#text', text: 'X X', attributes: [['id', 'ahem-probe']], children: [],
      inline: [
        ['position', 'absolute'], ['left', '20px'], ['top', '30px'],
        ['font-family', 'Ahem'], ['font-size', '20px'], ['line-height', '20px'],
      ],
    }],
  },
};

// Exercise the HTML adapter, native inheritance, shorthand and family fallback.
// Its image has the same independently specified pixels as the direct control.
export const ahemShorthandSource = '<!doctype html><link rel="stylesheet" href="/fonts/ahem.css"><style>body{margin:0}div{position:absolute;left:20px;top:30px;width:100px;font:20px/1 "Missing font", Ahem}</style><div>X X</div>';

// Expected glyph rectangles are specified independently of layout/reftests.
// Keep these literal: deriving them from native measurements would hide bugs.
export const whitespaceControls = [
  { name: 'normal-collapse', mode: 'normal', text: 'X \n\t  X', width: 100, height: 20, squares: [[20, 30], [60, 30]] },
  { name: 'nowrap-collapse', mode: 'nowrap', text: 'X \n\t  X', width: 100, height: 20, squares: [[20, 30], [60, 30]] },
  { name: 'pre-preserve', mode: 'pre', text: 'X  X\nX', width: 100, height: 40, squares: [[20, 30], [80, 30], [20, 50]] },
  { name: 'pre-overflow', mode: 'pre', text: 'XX\nX', width: 20, height: 40, squares: [[20, 30], [40, 30], [20, 50]] },
  { name: 'pre-line-collapse', mode: 'pre-line', text: 'X  X\n   X', width: 100, height: 40, squares: [[20, 30], [60, 30], [20, 50]] },
  { name: 'normal-wrap', mode: 'normal', text: 'X X', width: 20, height: 40, squares: [[20, 30], [20, 50]] },
].map(control => ({
  ...control,
  source: `<!doctype html><style>body{margin:0}div{position:absolute;left:20px;top:30px;width:${control.width}px;font:20px/1 Ahem;white-space:${control.mode}}</style><div>${control.text}</div>`,
}));

// BR is transported as an element. Native inline layout owns the forced break.
export const lineBreakControls = [
  { name: 'br-between-text', height: 40, content: 'X<br>X', squares: [[20, 30], [20, 50]] },
  { name: 'br-consecutive', height: 60, content: 'X<br><br>X', squares: [[20, 30], [20, 70]] },
  { name: 'br-leading', height: 40, content: '<br>X', squares: [[20, 50]] },
  { name: 'br-trailing', height: 20, content: 'X<br>', squares: [[20, 30]] },
  { name: 'br-nowrap', height: 40, content: 'XX<br>X', css: 'white-space:nowrap', squares: [[20, 30], [40, 30], [20, 50]] },
  { name: 'br-center', height: 40, content: 'X<br>X', css: 'text-align:center', squares: [[60, 30], [60, 50]] },
  { name: 'br-hidden', height: 20, content: 'X<br style="display:none">X', squares: [[20, 30], [40, 30]] },
].map(control => ({
  width: 100, htmlTag: 'br', ...control,
  source: `<!doctype html><style>body{margin:0}div{position:absolute;left:20px;top:30px;width:100px;font:20px/1 Ahem;${control.css || ''}}</style><div>${control.content}</div>`,
}));

// Matching reftests can share missing pseudo-element paint on both sides.
// The first line's background must fill the space between these Ahem glyphs.
export const firstLineControl = {
  name: 'first-line-background', cssPseudo: 'first-line', width: 100, height: 40,
  squares: [[20, 30], [40, 30], [60, 30], [20, 50]],
  source: '<!doctype html><style>body{margin:0}div{position:absolute;left:20px;top:30px;width:100px;font:20px/1 Ahem;color:#000}div::first-line{background:#000}</style><div>X X<br>X</div>',
};

export function checkWhitespaceControl(rendered, viewport, control) {
  const result = checkTextPixels(rendered, viewport, 'div', [20, 30, control.width, control.height], control.squares);
  if (control.childBox) {
    result.expected.childBox = control.childBox;
    result.actual.childBox = rendered.nodes.find(n => n.tag === 'section')?.box;
    result.pass &&= String(result.actual.childBox) === String(control.childBox);
  }
  return result;
}

// Ahem's zero advance is 20px, so 5ch must occupy exactly 100px. A broken
// font-relative unit can shrink a fixture until its differing text falls below
// the viewport and silently turns a missing layout feature into a match.
export const chControl = {
  name: 'font-relative-ch', cssUnit: 'ch', width: 100, height: 20,
  squares: [[20, 30], [40, 30], [60, 30], [80, 30], [100, 30]],
  source: '<!doctype html><style>body{margin:0}div{position:absolute;left:20px;top:30px;width:5ch;height:20px;font:20px/1 Ahem;background:#000}</style><div></div>',
};

// An unsupported lh must not collapse both sides of a reftest into a match.
export const lhControl = {
  name: 'line-height-relative-lh', cssUnit: 'lh', width: 40, height: 20,
  squares: [[20, 30], [40, 30]],
  source: '<!doctype html><style>body{margin:0}div{position:absolute;left:20px;top:30px;width:2lh;height:1lh;font:20px/1 Ahem;background:#000}</style><div></div>',
};

export const lineHeightInheritanceControls = [
  { name: 'unitless-line-height-inheritance', value: '1.5', height: 120, squares: [[20, 40, 40, 40], [20, 100, 40, 40]] },
  { name: 'pixel-line-height-inheritance', value: '30px', height: 60, squares: [[20, 25, 40, 40], [20, 55, 40, 40]] },
  { name: 'percent-line-height-inheritance', value: '150%', height: 60, squares: [[20, 25, 40, 40], [20, 55, 40, 40]] },
  { name: 'em-line-height-inheritance', value: '1.5em', height: 60, squares: [[20, 25, 40, 40], [20, 55, 40, 40]] },
].map(control => ({
  ...control, width: 100,
  source: `<!doctype html><link rel="stylesheet" href="/fonts/ahem.css"><style>body{margin:0;font:20px/${control.value} Ahem}div{position:absolute;left:20px;top:30px;width:100px;font-size:40px;white-space:pre}</style><div>X\nX</div>`,
}));

export const lineHeightUnitControls = [
  lhControl,
  {
    name: 'root-line-height-relative-rlh', cssUnit: 'rlh', width: 40, height: 20,
    squares: [[20, 30], [40, 30]],
    source: '<!doctype html><style>html{font:20px/20px Ahem}body{margin:0}div{position:absolute;left:20px;top:30px;width:2rlh;height:1rlh;line-height:40px;background:#000}</style><div></div>',
  },
  {
    name: 'root-self-relative-rlh', cssUnit: 'rlh', width: 48, height: 24,
    squares: [[20, 30, 48, 24]],
    // Initial 16px serif uses the pinned Gentium font's 24px line metrics,
    // even though the root author chooses a different family and size.
    source: '<!doctype html><style>html{font:40px/1rlh Ahem}body{margin:0}div{position:absolute;left:20px;top:30px;width:2rlh;height:1rlh;background:#000}</style><div></div>',
  },
  {
    name: 'normal-line-height-relative-lh', cssUnit: 'lh', width: 40, height: 20,
    squares: [[20, 30], [40, 30]],
    source: '<!doctype html><style>body{margin:0}div{position:absolute;left:20px;top:30px;width:2lh;height:1lh;font:20px/normal Ahem;background:#000}</style><div></div>',
  },
  {
    name: 'font-size-parent-lh', cssUnit: 'lh', width: 40, height: 20,
    squares: [[20, 30], [40, 30]],
    source: '<!doctype html><style>body{margin:0;font:12px/20px Ahem}div{position:absolute;left:20px;top:30px;width:2em;height:1em;font-size:1lh;line-height:7px;background:#000}</style><div></div>',
  },
  {
    name: 'line-height-parent-lh', cssUnit: 'lh', width: 40, height: 40,
    squares: [[20, 30], [40, 30], [20, 50], [40, 50]],
    source: '<!doctype html><style>body{margin:0;font:20px/20px Ahem}div{position:absolute;left:20px;top:30px;width:1lh;height:1lh;font:12px/2lh Ahem;background:#000}</style><div></div>',
  },
];

const paragraphSource = (content, author = '') => `<!doctype html><style>body{margin:0}div{position:absolute;left:20px;top:30px;width:100px;padding:1px;font:20px/1 Ahem}${author}</style><div>${content}</div>`;
export const paragraphControls = [
  { name: 'paragraph-default-margin', height: 62, squares: [[21, 51]], source: paragraphSource('<p>X</p>') },
  { name: 'paragraph-author-reset', height: 22, squares: [[21, 31]], source: paragraphSource('<p>X</p>', '*{margin:0}') },
  { name: 'paragraph-sibling-collapse', height: 102, squares: [[21, 51], [21, 91]], source: paragraphSource('<p>X</p><p>X</p>') },
  { name: 'paragraph-parent-collapse', height: 62, squares: [[21, 51]], source: paragraphSource('<section><p>X</p></section>') },
  { name: 'paragraph-empty-negative-collapse', height: 97, squares: [[21, 51], [21, 86]], source: paragraphSource('<p style="margin-bottom:30px">X</p><p style="margin-top:-15px;margin-bottom:10px"></p><p style="margin-top:20px">X</p>') },
].map(control => ({ width: 102, htmlTag: 'p', ...control }));

// Literal geometry distinguishes intrinsic measurement from final percentage
// resolution. Both stages matter even when the parent's painted area matches.
export const boxEdgeControls = [
  {
    name: 'percentage-box-edges', width: 100, height: 60,
    squares: [[30, 40], [50, 40], [30, 60], [50, 60]], childBox: [30, 40, 40, 40],
    source: '<!doctype html><style>body{margin:0}div{position:absolute;left:20px;top:30px;width:100px}section{width:20px;height:20px;margin:10%;padding:10%;background:#000}</style><div><section></section></div>',
  },
  ...[
    { name: 'cyclic-percentage-margin', css: 'margin-left:-50%', childBox: [-30, 30, 100, 20] },
    { name: 'cyclic-percentage-padding', css: 'padding-left:50%', childBox: [20, 30, 150, 20] },
  ].map(control => ({
    ...control, width: 100, height: 20,
    squares: [[20, 30], [40, 30], [60, 30], [80, 30], [100, 30]],
    source: `<!doctype html><style>body{margin:0}div{position:absolute;left:20px;top:30px;background:#000}section{width:100px;height:20px;${control.css}}</style><div><section></section></div>`,
  })),
].map(control => ({ cssUnit: '%', ...control }));

export function checkAhemControl(rendered, viewport, htmlContainer = false) {
  // The HTML control declares a 100px line box. Its native text node occupies
  // that line box for text-align; the direct control separately checks intrinsic
  // 60px text measurement. Both must match the same exact glyph pixels.
  return checkTextPixels(rendered, viewport, htmlContainer ? 'div' : '#text', [20, 30, htmlContainer ? 100 : 60, 20], [[20, 30], [60, 30]]);
}

function checkTextPixels(rendered, viewport, tag, expectedBox, squares) {
  const box = rendered.nodes.find(n => n.tag === tag)?.box;
  let differingPixels = 0;
  for (let y = 0; y < viewport.height; ++y) for (let x = 0; x < viewport.width; ++x) {
    const expected = squares.some(([sx, sy, width = 20, height = 20]) => x >= sx && x < sx + width && y >= sy && y < sy + height) ? 0 : 255;
    const i = (y * viewport.width + x) * 4;
    if ([0, 1, 2].some(c => rendered.pixels[i + c] !== expected)) ++differingPixels;
  }
  return {
    pass: String(box) === String(expectedBox) && differingPixels === 0,
    expected: { box: expectedBox, differingPixels: 0 },
    actual: { box, differingPixels },
  };
}

// Literal whole-frame pixels distinguish a culled flattened group from a
// preserve-3d child whose own back face remains visible.
export const backfaceControls = [
  { name: 'backface-flat', parent: '', child: '', visible: false },
  { name: 'backface-flat-counterrotation', parent: '', child: 'transform:rotateY(180deg)', visible: false },
  { name: 'backface-preserve-3d', parent: 'transform-style:preserve-3d', child: '', visible: true },
  { name: 'backface-overflow-flattening', parent: 'transform-style:preserve-3d;overflow:hidden', child: '', visible: false },
  { name: 'backface-clip-preserves-3d', parent: 'transform-style:preserve-3d;overflow:clip', child: '', visible: true },
  { name: 'backface-filter-flattening', parent: 'transform-style:preserve-3d;filter:blur(0px)', child: '', visible: false },
].map(control => ({
  ...control, width: 40, height: 20,
  squares: control.visible ? [[20, 30, 40, 20]] : [],
  source: `<!doctype html><style>body{margin:0}div{position:absolute;left:20px;top:30px;width:40px;height:20px;transform:rotateY(180deg);backface-visibility:hidden;${control.parent}}section{width:40px;height:20px;background:#000;${control.child}}</style><div><section></section></div>`,
}));
