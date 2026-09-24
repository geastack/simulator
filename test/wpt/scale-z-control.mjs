// SPDX-License-Identifier: Apache-2.0
// With perspective 400px the scale is 400/(400-z). These authored depths give
// integral projected rectangles, including a collapsed and a reflected Z axis.
export const scaleZControl = `<!doctype html><style>
body{margin:0}.stage{position:absolute;top:0;width:200px;height:200px;perspective:400px;perspective-origin:0 0}
.scaled{position:absolute;left:0;top:0;width:200px;height:200px;transform-origin:0 0;transform-style:preserve-3d}
.square{position:absolute;background:#000;transform-origin:0 0}
</style>
<div class="stage" style="left:0"><div class="scaled" style="transform:scale3d(1,1,2)"><div class="square" style="left:40px;top:40px;width:20px;height:20px;transform:translateZ(100px)"></div></div></div>
<div class="stage" style="left:200px"><div class="scaled" style="transform:scaleZ(0)"><div class="square" style="left:40px;top:40px;width:20px;height:20px;transform:translateZ(100px)"></div></div></div>
<div class="stage" style="left:400px"><div class="scaled" style="transform:scaleZ(-1)"><div class="square" style="left:60px;top:60px;width:30px;height:30px;transform:translateZ(200px)"></div></div></div>
<div class="stage" style="left:600px"><div class="scaled" style="transform:scaleZ(2) scaleZ(3)"><div class="square" style="left:10px;top:10px;width:10px;height:10px;transform:translateZ(50px)"></div></div></div>`;

export function checkScaleZControl(result, viewport) {
  const rectangles = [[80,80,40,40],[240,40,20,20],[440,40,20,20],[640,40,40,40]];
  let differingPixels = 0;
  for (let y=0;y<viewport.height;++y) for (let x=0;x<viewport.width;++x) {
    const expected = rectangles.some(([left,top,width,height])=>x>=left&&x<left+width&&y>=top&&y<top+height)?0:255;
    const offset=(y*viewport.width+x)*4;
    if ([0,1,2].some(channel=>result.pixels[offset+channel]!==expected)) ++differingPixels;
  }
  return {pass:differingPixels===0, expected:{rectangles,differingPixels:0},actual:{differingPixels}};
}
