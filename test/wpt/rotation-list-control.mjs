// SPDX-License-Identifier: Apache-2.0
// Literal projected rectangles, independent of the engine's rotation math.
const cases = [
  ['rotate3d(2,0,0,60deg)', [0,0,40,10]],
  ['rotate3d(0,-3,0,60deg)', [0,0,20,20]],
  ['rotate3d(0,0,-4,90deg)', [0,-40,20,40]],
  ['rotate3d(1,1,0,180deg)', [0,0,20,40]],
  ['rotate(90deg) rotate3d(1,0,0,60deg)', [-10,0,10,40]],
  ['rotate3d(1,0,0,60deg) rotate(90deg)', [-20,0,20,20]],
  ['rotate(45deg) rotate(45deg)', [-20,0,20,40]],
  ['rotate3d(0,0,0,60deg)', [0,0,40,20]],
];
export const rotationListControl = '<!doctype html><style>body{margin:0}.box{position:absolute;width:40px;height:20px;background:#000;transform-origin:0 0}</style>' +
  cases.map(([transform], i) => `<div class="box" style="left:${100+(i%4)*180}px;top:${100+Math.floor(i/4)*200}px;transform:${transform}"></div>`).join('');

export function checkRotationListControl(result, viewport) {
  const rectangles = cases.map(([, [x,y,w,h]], i) => [100+(i%4)*180+x,100+Math.floor(i/4)*200+y,w,h]);
  let differingPixels = 0;
  for (let y=0; y<viewport.height; ++y) for (let x=0; x<viewport.width; ++x) {
    const expected = rectangles.some(([left,top,width,height]) => x>=left && x<left+width && y>=top && y<top+height) ? 0 : 255;
    const offset = (y*viewport.width+x)*4;
    if ([0,1,2].some(c => result.pixels[offset+c] !== expected)) ++differingPixels;
  }
  return {pass:differingPixels===0, expected:{rectangles,differingPixels:0}, actual:{differingPixels}};
}
