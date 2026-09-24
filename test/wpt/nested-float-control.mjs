// SPDX-License-Identifier: Apache-2.0
// Shared-BFC float positions and actual clearance, checked without a CSS reference.
export const nestedFloatControl = `<!doctype html><style>
  body{margin:0}.parent{position:absolute;top:30px;width:100px}
  .float{float:left;width:40px;height:50px;background:#000000}
  .child{clear:left;margin-top:20px;height:20px;background:#000000}
  </style>
  <div class="parent" style="left:20px"><div id="f0" class="float"></div><div id="w0"><div id="c0" class="child"></div></div></div>
  <div class="parent" style="left:180px"><div id="f1" class="float"></div><div id="w1"><div id="c1" class="child" style="margin-top:80px"></div></div></div>
  <div class="parent" style="left:340px"><div><div id="f2" class="float"></div></div><div id="w2"><div id="c2" class="child"></div></div></div>
  <div class="parent" style="left:500px"><div id="f3" class="float"></div><div id="w3" style="position:absolute;left:50px;top:0;width:50px"><div id="c3" class="child"></div></div></div>
  <div class="parent" style="left:20px;top:230px"><div id="right" class="float" style="float:right;width:50px;height:20px"></div><div id="outer"><div id="left" class="float" style="width:50px;height:100px"></div><div id="inner"><div id="cleared" class="child" style="clear:right;margin-top:16px;height:80px"></div></div></div></div>
  <div class="parent" style="left:180px;top:230px"><div id="tall" class="float" style="width:50px;height:100px"></div><div style="padding-top:1px"><div id="negative" style="background:#000000"><div style="margin-bottom:49px"></div><div id="empty" style="clear:left;margin-top:98px"></div></div><div id="after" style="height:50px;background:#000000"></div></div></div>
  <div class="parent" style="left:340px;top:230px;width:125px"><div style="float:left;width:0;height:50px"></div><div style="float:right;clear:left;width:25px;height:50px"></div><div id="fill" style="overflow:hidden;margin-left:-50px;height:100px;background:#000000"></div></div>`;

export function checkNestedFloatControl(result, viewport) {
  const ids = ['f0', 'w0', 'c0', 'f1', 'w1', 'c1', 'f2', 'w2', 'c2', 'f3', 'w3', 'c3', 'right', 'outer', 'left', 'inner', 'cleared', 'tall', 'negative', 'empty', 'after', 'fill'];
  const boxes = [[20, 30, 40, 50], [20, 30, 100, 70], [20, 80, 100, 20],
    [180, 30, 40, 50], [180, 110, 100, 20], [180, 110, 100, 20],
    [340, 30, 40, 50], [340, 30, 100, 70], [340, 80, 100, 20],
    [500, 30, 40, 50], [550, 30, 50, 40], [550, 50, 50, 20],
    [70, 230, 50, 20], [20, 230, 100, 100], [20, 230, 50, 100], [20, 230, 100, 100], [20, 250, 100, 80],
    [180, 230, 50, 100], [180, 280, 100, 50], [180, 330, 100, 0], [180, 330, 100, 50], [340, 230, 100, 100]];
  const ink = [0, 2, 3, 5, 6, 8, 9, 11, 12, 14, 16, 17, 18, 20, 21].map(i => boxes[i]);
  const actual = ids.map(id => result.nodes.find(n => n.attributes.some(([key, value]) => key === 'id' && value === id))?.box);
  let differingPixels = 0;
  for (let y = 0; y < viewport.height; ++y) for (let x = 0; x < viewport.width; ++x) {
    const black = ink.some(([left, top, width, height]) => x >= left && x < left + width && y >= top && y < top + height);
    const offset = (y * viewport.width + x) * 4;
    if ([0, 1, 2].some(channel => result.pixels[offset + channel] !== (black ? 0 : 255))) ++differingPixels;
  }
  return { pass: JSON.stringify(actual) === JSON.stringify(boxes) && differingPixels === 0,
    actual: { boxes: actual, differingPixels }, expected: { boxes, differingPixels: 0 } };
}
