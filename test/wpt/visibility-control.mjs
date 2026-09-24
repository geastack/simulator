// SPDX-License-Identifier: Apache-2.0
// Literal geometry and pixels distinguish hidden inheritance from flex collapse.
export const visibilityControl = `<!doctype html><style>
  body{margin:0}.holder{position:absolute;top:30px}.flex{display:flex}
  .item{width:20px;height:20px;flex:none;background:#000000}
  .collapsed{visibility:collapse}.hidden{visibility:hidden;background:#ff0000}
  </style>
  <div class="holder" style="left:20px"><div id="gaps" class="flex" style="width:max-content;gap:10px">
    <div class="item"></div><div class="item collapsed" style="height:40px">
      <div style="visibility:visible;position:absolute;left:0;top:100px;width:50px;height:50px;background:#ff0000"></div>
    </div><div class="item"></div><div class="item"></div>
  </div></div>
  <div class="holder hidden" style="left:150px;width:100px;height:80px">
    <div style="width:40px;height:20px;background:#ff0000"></div>
    <div id="override" style="visibility:visible;width:20px;height:20px;background:#000000"></div>
  </div>
  <div id="wrap" class="holder flex" style="left:280px;width:25px;height:60px;flex-wrap:wrap">
    <div class="item" style="width:25px;height:10px"></div>
    <div class="collapsed" style="width:10px"></div>
    <div id="last" class="item" style="width:10px;height:30px"></div>
  </div>
  <div class="holder" style="left:350px"><div id="only" class="flex" style="width:max-content">
    <div class="item collapsed" style="height:40px"></div>
  </div></div>
  <div class="holder" style="left:400px"><div id="stretch" class="flex" style="width:max-content">
    <div class="item collapsed" style="height:40px"></div>
    <div id="stretched" style="width:20px;background:#000000"></div>
  </div></div>`;

export function checkVisibilityControl(result, viewport) {
  const expected = [[20, 30, 80, 40], [150, 50, 20, 20], [280, 30, 25, 60],
    [280, 70, 10, 30], [350, 30, 0, 40], [400, 30, 20, 40], [400, 30, 20, 40]];
  const ids = ['gaps', 'override', 'wrap', 'last', 'only', 'stretch', 'stretched'];
  const actual = ids.map(id => result.nodes.find(n => n.attributes.some(([key, value]) => key === 'id' && value === id))?.box);
  const ink = [[20, 30, 20, 20], [50, 30, 20, 20], [80, 30, 20, 20],
    [150, 50, 20, 20], [280, 30, 25, 10], [280, 70, 10, 30], [400, 30, 20, 40]];
  let differingPixels = 0;
  for (let y = 0; y < viewport.height; ++y) for (let x = 0; x < viewport.width; ++x) {
    const black = ink.some(([left, top, width, height]) => x >= left && x < left + width && y >= top && y < top + height);
    const offset = (y * viewport.width + x) * 4;
    if ([0, 1, 2].some(channel => result.pixels[offset + channel] !== (black ? 0 : 255))) ++differingPixels;
  }
  return { pass: JSON.stringify(actual) === JSON.stringify(expected) && differingPixels === 0,
    actual: { boxes: actual, differingPixels }, expected: { boxes: expected, differingPixels: 0 } };
}
