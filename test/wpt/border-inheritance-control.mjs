// SPDX-License-Identifier: Apache-2.0
// Expected pixels are literal border rings, independent of CSS reference layout.
export const borderInheritanceControl = `<!doctype html><style>
  body{margin:0}.parent{position:absolute;top:30px;width:100px;height:80px;
    font-size:10px;border:1em solid #000000}
  .child{width:40px;height:20px;font-size:40px;border-style:solid;border-color:#000000;border-width:inherit}
  #p0{left:20px}#p1{left:180px;border-width:3px 5px 7px 9px}
  #p2{left:350px;border-left-width:2px}
  #p2>.child{border-width:12px;border-left-width:inherit;border-top-width:0}
  </style><div id="p0" class="parent"><div id="c0" class="child"></div></div>
  <div id="p1" class="parent"><div id="c1" class="child" style="border-width:inherit"></div></div>
  <div id="p2" class="parent"><div id="c2" class="child"></div></div>`;

export function checkBorderInheritanceControl(result, viewport) {
  const boxes = [[20, 30, 120, 100], [180, 30, 114, 90], [350, 30, 112, 100],
    [30, 40, 60, 40], [189, 33, 54, 30], [352, 40, 54, 32]];
  const content = [[30, 40, 100, 80], [189, 33, 100, 80], [352, 40, 100, 80],
    [40, 50, 40, 20], [198, 36, 40, 20], [354, 40, 40, 20]];
  const actual = ['p0', 'p1', 'p2', 'c0', 'c1', 'c2'].map(id => result.nodes.find(n => n.attributes.some(([key, value]) => key === 'id' && value === id))?.box);
  const inside = (x, y, [left, top, width, height]) => x >= left && x < left + width && y >= top && y < top + height;
  let differingPixels = 0;
  for (let y = 0; y < viewport.height; ++y) for (let x = 0; x < viewport.width; ++x) {
    const black = boxes.some((box, i) => inside(x, y, box) && !inside(x, y, content[i]));
    const offset = (y * viewport.width + x) * 4;
    if ([0, 1, 2].some(channel => result.pixels[offset + channel] !== (black ? 0 : 255))) ++differingPixels;
  }
  return { pass: JSON.stringify(actual) === JSON.stringify(boxes) && differingPixels === 0,
    actual: { boxes: actual, differingPixels }, expected: { boxes, differingPixels: 0 } };
}
