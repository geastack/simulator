// SPDX-License-Identifier: Apache-2.0
export const canvasImageControl = `<!doctype html><style>
html{width:700px;height:20px;margin:10px;
background-image:linear-gradient(#000 0%,#000 50%,#fff 50%),linear-gradient(#f00,#f00);
background-size:700px 20px,100px 100px;
background-position:0px 5px,0px 0px;
background-attachment:scroll,fixed}
body{margin:0}
</style>`;

export function checkCanvasImageControl(result, viewport) {
  let differingPixels = 0;
  for (let y = 0; y < viewport.height; ++y) for (let x = 0; x < viewport.width; ++x) {
    const expected = ((y - 15) % 20 + 20) % 20 < 10 ? 0 : 255;
    const offset = (y * viewport.width + x) * 4;
    if ([0, 1, 2].some(c => result.pixels[offset + c] !== expected)) ++differingPixels;
  }
  return { pass: differingPixels === 0, actual: { differingPixels },
    expected: { stripeOriginY: 15, stripePeriod: 20, differingPixels: 0 } };
}
