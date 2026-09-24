// SPDX-License-Identifier: Apache-2.0
// Independent Ahem mask oracle for background-clip:text. Ahem's X fills its
// 20px cell exactly, so the expected image is a set of literal rectangles.
export const textClipControl = `<!doctype html><style>
  body{margin:0}
  .clip{position:absolute;background:#ff0000;background-clip:text;color:transparent;font:20px/20px Ahem}
  #lines{left:20px;top:20px;width:100px;height:40px;border:2px solid #0000ff}
  #descendants{left:180px;top:20px;width:100px;height:60px}
  #scaled{left:400px;top:30px;transform-origin:0 0;transform:scale(2)}
  #overflow{left:20px;top:100px;width:100px;height:20px}
  #gradient{left:180px;top:100px;width:100px;height:20px;background:linear-gradient(#ff0000,#ff0000) text}
  #layers{left:300px;top:100px;width:60px;height:20px;background-image:linear-gradient(#ff0000,#ff0000),linear-gradient(#0000ff,#0000ff);background-clip:text,border-box}
  </style>
  <div id="lines" class="clip">X X<br>X</div>
  <div id="descendants" class="clip">
    <div style="position:relative;left:20px">X</div>
    <div style="opacity:0">X</div>
    <div style="opacity:.5">X</div>
    <div style="position:absolute;left:60px;top:40px">X</div>
  </div>
  <div id="scaled" class="clip">X</div>
  <div id="overflow" class="clip"><div style="overflow:hidden;width:10px;height:20px">X</div></div>
  <div id="gradient" class="clip">X</div><div id="layers" class="clip">X</div>`;

export function checkTextClipControl(result, viewport) {
  const red = [[22,22,20,20], [62,22,20,20], [22,42,20,20],
    [200,20,20,20], [180,40,20,20], [180,60,20,20], [400,30,40,40],
    [20,100,10,20], [180,100,20,20], [300,100,20,20]];
  const border = [20,20,104,44];
  let differingPixels = 0;
  for (let y=0; y<viewport.height; ++y) for (let x=0; x<viewport.width; ++x) {
    const inRect = ([left,top,width,height]) => x>=left && x<left+width && y>=top && y<top+height;
    const isBorder = inRect(border) &&
      (x<border[0]+2 || x>=border[0]+border[2]-2 || y<border[1]+2 || y>=border[1]+border[3]-2);
    const expected = isBorder ? [0,0,255] : red.some(inRect) ? [255,0,0] :
      inRect([300,100,60,20]) ? [0,0,255] : [255,255,255];
    const offset = (y*viewport.width+x)*4;
    if (expected.some((value,channel) => result.pixels[offset+channel] !== value)) ++differingPixels;
  }
  return {pass:differingPixels===0,
    expected:{red,border,differingPixels:0},actual:{differingPixels}};
}

// A matching emphasis reftest is inconclusive if both sides omit the marks.
// The Ahem glyph occupies y=60..79; filled-dot emphasis must add ink above it.
export const textEmphasisControl = `<!doctype html><style>
body{margin:0}div{position:absolute;left:20px;top:60px;font:20px/20px Ahem;
color:#000;text-emphasis:filled dot #000}
</style><div>X</div>`;
export function checkTextEmphasisControl(result, viewport) {
  let glyphPixels = 0, emphasisPixels = 0;
  for (let y=0; y<80; ++y) for (let x=0; x<80; ++x) {
    const offset = (y*viewport.width+x)*4;
    const ink = result.pixels[offset]!==255 || result.pixels[offset+1]!==255 || result.pixels[offset+2]!==255;
    if (!ink) continue;
    if (y<60) ++emphasisPixels;
    else if (x>=20 && x<40) ++glyphPixels;
  }
  return {pass:glyphPixels===400 && emphasisPixels>0,
    expected:{glyphPixels:400,emphasisAboveGlyph:true},actual:{glyphPixels,emphasisPixels}};
}
