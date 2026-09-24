// SPDX-License-Identifier: Apache-2.0
// Literal geometry and pixels independently check margin/clearance interactions.
export const floatClearanceControl = `<!doctype html><style>
  body{margin:0}.parent{position:absolute;top:30px;width:100px}
  .previous{height:10px}.float{float:left;width:30px;height:40px;background:#000000}
  .block,.next{height:10px;background:#000000}.block{clear:left}.next{width:60px}
  .next{margin-top:5px}
  </style>${[
    ['0px', '20px', 'left', '10px', '5px'],
    ['0px', '70px', 'left', '10px', '5px'],
    ['0px', '-20px', 'left', '10px', '5px'],
    ['40px', '60px', 'left', '10px', '5px'],
    ['30px', '20px', 'none', '10px', '5px'],
    ['0px', '10px', 'left', '0px', '100px'],
  ].map(([bottom, top, clear, height, next], i) => `<div id="parent-${i}" class="parent" style="left:${20 + 120 * i}px">
    <div class="previous" style="margin-bottom:${bottom}"></div><div id="float-${i}" class="float"></div>
    <div id="block-${i}" class="block" style="margin-top:${top};clear:${clear};height:${height}"></div>
    <div id="next-${i}" class="next" style="margin-top:${next}"></div></div>`).join('')}`;

export function checkFloatClearanceControl(result, viewport) {
  const boxes = [
    [20, 40, 30, 40], [20, 80, 100, 10], [20, 95, 60, 10],
    [140, 40, 30, 40], [140, 110, 100, 10], [140, 125, 60, 10],
    [260, 40, 30, 40], [260, 80, 100, 10], [260, 95, 60, 10],
    [380, 80, 30, 40], [380, 120, 100, 10], [380, 135, 60, 10],
    [500, 70, 30, 40], [500, 70, 100, 10], [500, 85, 60, 10],
    [620, 40, 30, 40], [620, 80, 100, 0], [620, 170, 60, 10],
  ];
  const ids = Array.from({length: 6}, (_, i) => [`float-${i}`, `block-${i}`, `next-${i}`]).flat();
  const actual = ids.map(id => result.nodes.find(n => n.attributes.some(([key, value]) => key === 'id' && value === id))?.box);
  let differingPixels = 0;
  for (let y = 0; y < viewport.height; ++y) for (let x = 0; x < viewport.width; ++x) {
    const black = boxes.some(([left, top, width, height]) => x >= left && x < left + width && y >= top && y < top + height);
    const offset = (y * viewport.width + x) * 4;
    if ([0, 1, 2].some(channel => result.pixels[offset + channel] !== (black ? 0 : 255))) ++differingPixels;
  }
  return { pass: JSON.stringify(actual) === JSON.stringify(boxes) && differingPixels === 0,
    actual: { boxes: actual, differingPixels }, expected: { boxes, differingPixels: 0 } };
}
