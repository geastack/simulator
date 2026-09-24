// SPDX-License-Identifier: Apache-2.0
export const marginTrimControl = `<!doctype html><style>
body{margin:0}.box{position:absolute;top:30px;width:100px;margin-trim:block;background:#000}
#padded{left:20px;padding:3px 0 5px}
.first{height:20px;margin:10px 0 15px;background:#f00}
.last{height:20px;margin:25px 0 30px;background:#00f}
#nested{left:180px}#nested>.first{height:auto}
#nested .inner{height:20px;margin:40px 0 45px;background:#f00}
#vertical{left:340px;width:auto;height:100px;padding:0 4px;writing-mode:vertical-lr}
#vertical>.first{width:20px;height:40px;margin:0 10px}
#vertical>.last{width:20px;height:40px;margin:0 15px}
</style><div class="box" id="padded"><div class="first"></div><div class="last"></div></div>
<div class="box" id="nested"><div class="first"><div class="inner"></div></div><div class="last"></div></div>
<div class="box" id="vertical"><div class="first"></div><div class="last"></div></div>`;

export function checkMarginTrimControl(result, viewport) {
  const boxes = [[20,30,100,73], [180,30,100,85], [340,30,63,100]];
  const red = [[20,33,100,20], [180,30,100,20], [344,30,20,40]];
  const blue = [[20,78,100,20], [180,95,100,20], [379,30,20,40]];
  const actual = ['padded', 'nested', 'vertical'].map(id =>
    result.nodes.find(n => n.attributes.some(([k,v]) => k === 'id' && v === id))?.box);
  let differingPixels = 0;
  for (let y=0; y<viewport.height; ++y) for (let x=0; x<viewport.width; ++x) {
    const inside = rectangles => rectangles.some(([l,t,w,h]) => x>=l && x<l+w && y>=t && y<t+h);
    const expected = inside(red) ? [255,0,0] : inside(blue) ? [0,0,255] : inside(boxes) ? [0,0,0] : [255,255,255];
    const offset = (y*viewport.width+x)*4;
    if (expected.some((v,c) => result.pixels[offset+c] !== v)) ++differingPixels;
  }
  return {pass: JSON.stringify(actual) === JSON.stringify(boxes) && differingPixels === 0,
    actual: {boxes: actual, differingPixels}, expected: {boxes, differingPixels: 0}};
}
