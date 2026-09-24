// SPDX-License-Identifier: Apache-2.0
export const hoverControl = `<!doctype html><style>
body{margin:0}.square{position:absolute;top:30px;width:100px;height:100px;background:#000}
#first{left:20px}#second{left:300px}
.square:hover{transform-origin:0 0;transform:scale(2)}
</style><div id="first" class="square"></div><div id="second" class="square"></div>`;

export const hoverControls = [
  { name: 'hover-scale-initial', actions: [], size: [100, 100] },
  { name: 'hover-scale-enter', actions: [{ type: 'hover', target: '#first' }], size: [200, 100] },
  { name: 'hover-scale-sibling', actions: [{ type: 'hover', target: '#first' }, { type: 'hover', target: '#second' }], size: [100, 200] },
  { name: 'hover-scale-exit', actions: [{ type: 'hover', target: '#first' }, { type: 'hover', target: null }], size: [100, 100] },
];

export function checkHoverControl(result, viewport, control) {
  let differingPixels = 0;
  const rectangles = control.size.map((size, i) => [[20, 300][i], 30, size, size]);
  for (let y = 0; y < viewport.height; ++y) for (let x = 0; x < viewport.width; ++x) {
    const expected = rectangles.some(([left, top, width, height]) => x >= left && x < left + width && y >= top && y < top + height) ? 0 : 255;
    const offset = (y * viewport.width + x) * 4;
    if ([0, 1, 2].some(c => result.pixels[offset + c] !== expected)) ++differingPixels;
  }
  return { pass: differingPixels === 0, expected: { rectangles, differingPixels: 0 }, actual: { differingPixels } };
}
