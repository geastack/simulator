// SPDX-License-Identifier: Apache-2.0
// Ahem's X is a 20px square. The spaces distinguish first-line backgrounds
// from text ink, including when a descendant starts on a later formatted line.
export const firstLineFragmentControls = [
  { name: 'first-line-leading-whitespace', body: '<section>\n    X X\n</section>', rectangles: [[20,30,60,20]] },
  { name: 'first-line-cached-siblings', body: '<section>X X</section><section style="top:90px">X X</section>', rectangles: [[20,30,60,20],[20,90,60,20]] },
  { name: 'first-line-transformed-owner', body: '<section style="transform-origin:0 0;transform:translate(40px,20px) scale(2)">X X</section>', rectangles: [[60,50,120,40]] },
  { name: 'first-line-fixed-height', body: '<section style="height:100px">X X</section>', rectangles: [[20,30,60,20]] },
  { name: 'first-line-later-inline', body: '<section>X<br><span>X X</span></section>', rectangles: [[20,30,20,20],[20,50,20,20],[60,50,20,20]] },
  { name: 'first-line-first-block-child', body: '<section><div>X X</div><div>X X</div></section>', rectangles: [[20,30,60,20],[20,50,20,20],[60,50,20,20]] },
  { name: 'first-line-wrapped-run', body: '<section style="width:60px">X X X X</section>', rectangles: [[20,30,60,20],[20,50,20,20],[60,50,20,20]] },
].map(control => ({ ...control, source: `<!doctype html><style>
body{margin:0}section{position:absolute;left:20px;top:30px;width:100px;font:20px/1 Ahem;color:#000}
section::first-line{background:#000}
</style>${control.body}` }));

export function checkFirstLineFragments(result, viewport, control) {
  let differingPixels = 0;
  for (let y = 0; y < viewport.height; ++y) for (let x = 0; x < viewport.width; ++x) {
    const expected = control.rectangles.some(([left, top, width, height]) => x >= left && x < left + width && y >= top && y < top + height) ? 0 : 255;
    const offset = (y * viewport.width + x) * 4;
    if ([0, 1, 2].some(c => result.pixels[offset + c] !== expected)) ++differingPixels;
  }
  return { pass: differingPixels === 0, expected: { rectangles: control.rectangles, differingPixels: 0 }, actual: { differingPixels } };
}
