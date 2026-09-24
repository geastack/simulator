// SPDX-License-Identifier: Apache-2.0
// Literal expected rectangles independently cover the eight physical mappings.
const cases = [
  ['vertical-lr', 'ltr', 20, 20], ['vertical-lr', 'rtl', 300, 20],
  ['vertical-rl', 'ltr', 20, 160], ['vertical-rl', 'rtl', 300, 160],
  ['sideways-lr', 'ltr', 20, 300], ['sideways-lr', 'rtl', 300, 300],
  ['sideways-rl', 'ltr', 20, 440], ['sideways-rl', 'rtl', 300, 440],
];
export const verticalFlowControl = `<!doctype html><style>
  body{margin:0}.parent{position:absolute;width:200px;height:100px;padding:5px;border:3px solid #ffffff}
  .parent>div{background:#000000}.first{width:30px;height:20px;margin:4px 7px 9px 11px}
  .second{width:40px;height:25px;margin:6px 17px 10px 13px}
  </style>${cases.map(([mode, direction, x, y], i) => `<div class="parent" style="writing-mode:${mode};direction:${direction};left:${x}px;top:${y}px"><div class="first" id="first-${i}"></div><div class="second" id="second-${i}"></div></div>`).join('')}`;

export function checkVerticalFlowControl(result, viewport) {
  const expected = [
    [39, 32, 30, 20], [82, 34, 40, 25], [319, 99, 30, 20], [362, 93, 40, 25],
    [191, 172, 30, 20], [134, 174, 40, 25], [471, 239, 30, 20], [414, 233, 40, 25],
    [39, 379, 30, 20], [82, 373, 40, 25], [319, 312, 30, 20], [362, 314, 40, 25],
    [191, 452, 30, 20], [134, 454, 40, 25], [471, 519, 30, 20], [414, 513, 40, 25],
  ];
  const actual = cases.flatMap((_, i) => ['first', 'second'].map(name =>
    result.nodes.find(n => n.attributes.some(([key, value]) => key === 'id' && value === `${name}-${i}`))?.box));
  let differingPixels = 0;
  for (let y = 0; y < viewport.height; ++y) for (let x = 0; x < viewport.width; ++x) {
    const black = expected.some(([left, top, width, height]) => x >= left && x < left + width && y >= top && y < top + height);
    const offset = (y * viewport.width + x) * 4;
    if ([0, 1, 2].some(channel => result.pixels[offset + channel] !== (black ? 0 : 255))) ++differingPixels;
  }
  return { pass: JSON.stringify(actual) === JSON.stringify(expected) && differingPixels === 0,
    actual: { boxes: actual, differingPixels }, expected: { boxes: expected, differingPixels: 0 } };
}
