// SPDX-License-Identifier: Apache-2.0
export const individualLinearControl = `<!doctype html><style>
body{margin:0}.box{position:absolute;width:20px;height:10px;background:#000;transform-origin:0 0}
#a{left:60px;top:60px;translate:100px 20px;rotate:90deg;scale:2 3;transform:translate(10px,20px)}
#b{left:260px;top:60px;transform:translate(10px,20px);scale:2 3;rotate:90deg;translate:100px 20px}
#c{left:460px;top:60px;scale:2 3;transform:rotate(90deg)}
#d{left:60px;top:240px;rotate:x 180deg}
#e{left:260px;top:240px;rotate:1 1 0 180deg}
#f{left:460px;top:240px;scale:-100% 200%}
#g{left:60px;top:400px;rotate:x 180deg;backface-visibility:hidden}
#h{left:260px;top:400px;rotate:z 90deg;scale:2 3;transform:scale(2,1)}
</style><div id="a" class="box"></div><div id="b" class="box"></div>
<div id="c" class="box"></div><div id="d" class="box"></div>
<div id="e" class="box"></div><div id="f" class="box"></div>
<div id="g" class="box"></div><div id="h" class="box"></div>`;

export function checkIndividualLinearControl(result, viewport) {
  const expected = [[70,100,30,40], [270,100,30,40], [440,60,20,60],
    [60,230,20,10], [260,240,10,20], [440,240,20,20], [230,400,30,80]];
  let differingPixels = 0;
  for (let y=0; y<viewport.height; ++y) for (let x=0; x<viewport.width; ++x) {
    const black = expected.some(([left,top,width,height]) => x>=left && x<left+width && y>=top && y<top+height);
    const offset = (y*viewport.width+x)*4;
    if ([0,1,2].some(c => result.pixels[offset+c] !== (black ? 0 : 255))) ++differingPixels;
  }
  return { pass: differingPixels === 0, actual: { differingPixels }, expected: { paintedRectangles: expected, differingPixels: 0 } };
}
