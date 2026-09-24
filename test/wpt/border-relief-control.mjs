// SPDX-License-Identifier: Apache-2.0
// Interior edge samples distinguish each relief band from a solid-border false
// match. Expected shades are literal RGB565-expanded values, not a rendered ref.
export const borderReliefControl = `<!doctype html><style>
body{margin:0;color:#000}.box{position:absolute;top:20px;width:40px;height:40px}
.groove{border:10px groove}.ridge{border:10px ridge}.inset{border:10px inset}.outset{border:10px outset}
</style><div class="box groove" style="left:20px"></div>
<div class="box groove" style="left:100px"></div><div class="box ridge" style="left:180px"></div>
<div class="box inset" style="left:260px"></div><div class="box outset" style="left:340px"></div>`;

export function checkBorderReliefControl(result, viewport) {
  const light = [99, 101, 99], dark = [0, 0, 0], white = [255, 255, 255];
  const expected = [];
  for (const [x, outer, inner] of [[20,dark,light],[100,dark,light],[180,light,dark],[260,dark,dark],[340,light,light]]) {
    expected.push([x+30,22,outer],[x+30,27,inner],
      [x+30,77,outer===dark?light:dark],[x+30,72,inner===dark?light:dark],
      [x+2,50,outer],[x+57,50,outer===dark?light:dark],[x+30,50,white],[x-1,50,white]);
  }
  const mismatches = expected.flatMap(([x,y,rgb]) => {
    const actual = [...result.pixels.subarray((y*viewport.width+x)*4,(y*viewport.width+x)*4+3)];
    return String(actual)===String(rgb) ? [] : [{x,y,expected:rgb,actual}];
  });
  return { pass: mismatches.length===0, expected: { checkedPixels:expected.length,mismatches:0 }, actual: { checkedPixels:expected.length,mismatches } };
}
