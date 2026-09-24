// SPDX-License-Identifier: Apache-2.0
export const unbreakableFloatControl = `<!doctype html><style>
body{margin:0}.box{position:absolute;top:20px;width:100px;font:20px/1 Ahem;color:#000}
.float{float:left;width:60px;height:60px;background:#f00}
#plain{left:20px}#space{left:280px}#break{left:540px}
#wrap{left:20px;top:180px}
</style><div class="box" id="plain"><span class="float"></span>XXXXXXXXXX</div>
<div class="box" id="space"><span class="float"></span> XXXXXXXXXX</div>
<div class="box" id="break"><span class="float"></span><br>XXXXXXXXXX</div>
<div class="box" id="wrap">XXXXXXXXXX XX XX XX</div>`;

export function checkUnbreakableFloatControl(result, viewport) {
  const boxes = [[20,20,100,80],[280,20,100,80],[540,20,100,80],[20,180,100,60]];
  const red = [[20,20,60,60],[280,20,60,60],[540,20,60,60]];
  const black = [[20,80,200,20],[280,80,200,20],[540,80,200,20],
    [20,180,200,20],[20,200,40,20],[80,200,40,20],[20,220,40,20]];
  const actual = ['plain','space','break','wrap'].map(id =>
    result.nodes.find(n => n.attributes.some(([k,v]) => k==='id' && v===id))?.box);
  let differingPixels=0;
  for(let y=0;y<viewport.height;++y) for(let x=0;x<viewport.width;++x) {
    const inside = rectangles => rectangles.some(([l,t,w,h]) => x>=l && x<l+w && y>=t && y<t+h);
    const expected = inside(red) ? [255,0,0] : inside(black) ? [0,0,0] : [255,255,255];
    if(expected.some((v,c)=>result.pixels[(y*viewport.width+x)*4+c]!==v)) ++differingPixels;
  }
  return {pass: JSON.stringify(actual)===JSON.stringify(boxes) && differingPixels===0,
    actual:{boxes:actual,differingPixels},expected:{boxes,differingPixels:0}};
}
