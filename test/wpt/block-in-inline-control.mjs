// SPDX-License-Identifier: Apache-2.0
// Independent boxes and Ahem ink for anonymous block/inline formatting.
export const blockInInlineControl = `<!doctype html><style>
  body{margin:0}.container{position:absolute;top:30px;width:100px;font:20px/1 Ahem;color:#000000}
  .block{height:20px;background:#000000}.after{margin-bottom:40px}
  </style>
  <div class="container" style="left:20px"><span style="margin:50px 0"><div id="a" class="block after"></div></span><span style="margin:70px 0"><div id="b" class="block" style="margin-top:30px"></div></span></div>
  <div class="container" style="left:180px"><span><span id="lead">XX</span><div id="c" class="block after"></div><span id="tail">XX</span></span></div>
  <div class="container" style="left:340px;width:60px"><span><span id="wrapped">XX XX XX</span><div id="d" class="block after"></div></span><div id="next" class="block"></div></div>
  <div class="container" style="left:500px;width:200px"><span><div id="e" class="block after"></div></span><div id="float" style="float:left;width:80px;height:60px;background:#000000"></div><span id="alongside">XX</span></div>
  <div class="container" style="left:20px;top:230px"><div id="prior" class="block"></div><div><span><div style="height:0;margin:30px 0 40px"></div></span></div><div id="later" class="block"></div></div>
  <div class="container" style="left:180px;top:230px"><div id="upper" style="float:left;width:100px;height:50px;background:#000000"></div><span><div id="clear" style="clear:both;height:10px"><div id="lower" style="float:left;width:100px;height:50px;background:#000000"></div></div></span></div>
  <div class="container" style="left:340px;top:230px"><span style="position:relative;left:7px;top:5px"><div id="relative" class="block"></div></span><div id="normal" class="block"></div></div>
  <div class="container" style="left:20px;top:400px;width:200px"><div id="fit" style="float:left"><div id="fit-block" class="block" style="width:60px"></div><span id="fit-line">XX</span><br><span id="fit-last">XXXX</span></div></div>
  <div class="container" style="left:180px;top:400px"><div id="br-block" class="block"></div><div id="br-float" style="float:left;width:20px;height:60px;background:#000000"></div><span id="br-line">XX</span><br style="clear:both"><span id="br-next">XX</span></div>`;

export function checkBlockInInlineControl(result, viewport) {
  const ids = ['a', 'b', 'lead', 'c', 'tail', 'wrapped', 'd', 'next', 'e', 'float', 'alongside', 'prior', 'later', 'upper', 'clear', 'lower', 'relative', 'normal',
    'fit', 'fit-block', 'fit-line', 'fit-last', 'br-block', 'br-float', 'br-line', 'br-next'];
  const boxes = [[20, 30, 100, 20], [20, 90, 100, 20], [180, 30, 40, 20], [180, 50, 100, 20], [180, 110, 40, 20],
    [340, 30, 60, 60], [340, 90, 60, 20], [340, 150, 60, 20], [500, 30, 200, 20], [500, 90, 80, 60], [580, 90, 40, 20],
    [20, 230, 100, 20], [20, 290, 100, 20], [180, 230, 100, 50], [180, 280, 100, 10], [180, 280, 100, 50],
    [347, 235, 100, 20], [340, 250, 100, 20],
    [20, 400, 80, 60], [20, 400, 60, 20], [20, 420, 40, 20], [20, 440, 80, 20],
    [180, 400, 100, 20], [180, 420, 20, 60], [200, 420, 40, 20], [180, 480, 40, 20]];
  const ink = boxes.filter((_, i) => i !== 5 && i !== 14 && i !== 18).concat([[340, 30, 40, 60]]);
  const actual = ids.map(id => result.nodes.find(n => n.attributes.some(([key, value]) => key === 'id' && value === id))?.box);
  let differingPixels = 0;
  for (let y = 0; y < viewport.height; ++y) for (let x = 0; x < viewport.width; ++x) {
    const black = ink.some(([left, top, width, height]) => x >= left && x < left + width && y >= top && y < top + height);
    const offset = (y * viewport.width + x) * 4;
    if ([0, 1, 2].some(channel => result.pixels[offset + channel] !== (black ? 0 : 255))) ++differingPixels;
  }
  return { pass: JSON.stringify(actual) === JSON.stringify(boxes) && differingPixels === 0,
    actual: { boxes: actual, differingPixels }, expected: { boxes, differingPixels: 0 } };
}
