// SPDX-License-Identifier: Apache-2.0
// Each later black sibling must cover red descendants whose depth belongs to
// a different 3D context. Expected pixels do not use a renderer reference.
export const threeDContextControl = `<!doctype html><style>
body{margin:0}.scene{position:absolute;top:30px;width:40px;height:40px}
.preserve{transform-style:preserve-3d}.red,.black{width:40px;height:40px}
.red{background:#f00;transform:translateZ(20px)}
.black{position:absolute;left:0;top:0;background:#000;transform:translateZ(10px)}
</style>
<div class="scene preserve" style="left:20px"><div><div class="red" style="position:absolute;left:0;top:0"></div></div><div class="black"></div></div>
<div class="scene preserve" style="left:100px"><div><div class="red" style="position:fixed;left:0;top:0"></div></div><div class="black"></div></div>
<div class="scene" style="left:180px"><div class="preserve"><div class="red"></div></div><div class="black" style="transform:none"></div></div>`;

export function checkThreeDContextControl(result, viewport) {
  const rectangles = [20, 100, 180].map(x => [x, 30, 40, 40]);
  let differingPixels = 0;
  for (let y = 0; y < viewport.height; ++y) for (let x = 0; x < viewport.width; ++x) {
    const expected = rectangles.some(([left, top, width, height]) => x >= left && x < left + width && y >= top && y < top + height) ? 0 : 255;
    const offset = (y * viewport.width + x) * 4;
    if ([0, 1, 2].some(c => result.pixels[offset + c] !== expected)) ++differingPixels;
  }
  return { pass: differingPixels === 0, expected: { rectangles, differingPixels: 0 }, actual: { differingPixels } };
}
