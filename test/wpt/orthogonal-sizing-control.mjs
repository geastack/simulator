// SPDX-License-Identifier: Apache-2.0
// Literal geometry verifies the measure-then-resolve phase independently of WPT.
export const orthogonalSizingControl = `<!doctype html><style>
  body{margin:0}.outer{position:absolute;top:30px;width:150px;height:170px}
  .flex{display:flex;flex-flow:row wrap;writing-mode:vertical-lr;border:2px solid #ffffff;
    row-gap:20%;column-gap:10%;align-content:start}
  .item{width:50px;height:50px;flex:none;background:#000000}
  </style>
  <div class="outer" style="left:20px"><div id="flex-0" class="flex"><div id="a-0" class="item"></div><div id="b-0" class="item"></div></div></div>
  <div class="outer" style="left:180px;writing-mode:vertical-lr"><div id="flex-1" class="flex" style="writing-mode:horizontal-tb"><div id="a-1" class="item"></div><div id="b-1" class="item"></div></div></div>
  <div class="outer" style="left:340px"><div id="flex-2" class="flex" style="max-height:70px"><div id="a-2" class="item"></div><div id="b-2" class="item"></div></div></div>
  <div class="outer" style="left:500px"><div id="flex-3" class="flex" style="min-height:140px"><div id="a-3" class="item"></div><div id="b-3" class="item"></div></div></div>`;

export function checkOrthogonalSizingControl(result, viewport) {
  const boxes = [[20, 30, 104, 104], [180, 30, 104, 104], [340, 30, 104, 74], [500, 30, 54, 144]];
  const ink = [[22, 32, 50, 50], [72, 32, 50, 50], [182, 32, 50, 50], [182, 82, 50, 50],
    [342, 32, 50, 50], [392, 32, 50, 50], [502, 32, 50, 50], [502, 96, 50, 50]];
  const ids = [...[0, 1, 2, 3].map(i => `flex-${i}`), ...[0, 1, 2, 3].flatMap(i => [`a-${i}`, `b-${i}`])];
  const expected = [...boxes, ...ink];
  const actual = ids.map(id => result.nodes.find(n => n.attributes.some(([key, value]) => key === 'id' && value === id))?.box);
  let differingPixels = 0;
  for (let y = 0; y < viewport.height; ++y) for (let x = 0; x < viewport.width; ++x) {
    const black = ink.some(([left, top, width, height]) => x >= left && x < left + width && y >= top && y < top + height);
    const offset = (y * viewport.width + x) * 4;
    if ([0, 1, 2].some(channel => result.pixels[offset + channel] !== (black ? 0 : 255))) ++differingPixels;
  }
  return { pass: JSON.stringify(actual) === JSON.stringify(expected) && differingPixels === 0,
    actual: { boxes: actual, differingPixels }, expected: { boxes: expected, differingPixels: 0 } };
}
