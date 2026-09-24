// SPDX-License-Identifier: Apache-2.0
// Clearing BRs leave the current line in place and clear the following line.
export const floatBreakControl = `<!doctype html><style>
  body{margin:0}.parent{position:absolute;top:30px;width:100px;line-height:20px}
  .float{float:left;width:30px;height:30px;margin-bottom:5px;background:#000000}
  br{clear:both}.marker{width:20px;height:10px;background:#000000}
  </style>
  <div class="parent" style="left:20px"><div class="float"></div><br id="first-0"> \n <div style="display:none"><div></div></div> \t <br id="second-0"><div id="marker-0" class="marker"></div></div>
  <div class="parent" style="left:180px"><div class="float"></div><br id="first-1"> \n <br id="second-1"><div id="marker-1" class="marker"></div></div>
  <div class="parent" style="left:340px"><div class="float" style="height:10px"></div><br id="first-2"> \n <br id="second-2"><div id="marker-2" class="marker"></div></div>`;

export function checkFloatBreakControl(result, viewport) {
  const expected = [[50, 30, 0, 20], [20, 65, 0, 20], [20, 85, 20, 10],
    [210, 30, 0, 20], [180, 65, 0, 20], [180, 85, 20, 10],
    [370, 30, 0, 20], [340, 50, 0, 20], [340, 70, 20, 10]];
  const ids = [0, 1, 2].flatMap(i => [`first-${i}`, `second-${i}`, `marker-${i}`]);
  const actual = ids.map(id => result.nodes.find(n => n.attributes.some(([key, value]) => key === 'id' && value === id))?.box);
  const ink = [[20, 30, 30, 30], [180, 30, 30, 30], [340, 30, 30, 10], expected[2], expected[5], expected[8]];
  let differingPixels = 0;
  for (let y = 0; y < viewport.height; ++y) for (let x = 0; x < viewport.width; ++x) {
    const black = ink.some(([left, top, width, height]) => x >= left && x < left + width && y >= top && y < top + height);
    const offset = (y * viewport.width + x) * 4;
    if ([0, 1, 2].some(channel => result.pixels[offset + channel] !== (black ? 0 : 255))) ++differingPixels;
  }
  return { pass: JSON.stringify(actual) === JSON.stringify(expected) && differingPixels === 0,
    actual: { boxes: actual, differingPixels }, expected: { boxes: expected, differingPixels: 0 } };
}
