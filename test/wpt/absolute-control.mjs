// SPDX-License-Identifier: Apache-2.0
// Independent geometry oracle: grid placement may put the static position
// outside the containing area. Two 20px floats still fit in the available 40px.
export const absoluteSizingControl = `<!doctype html><style>
  body{margin:0}.grid{position:absolute;top:30px;display:grid;grid:40px / 10px 33px;
    width:20px;padding:2px 8px;border:3px solid #ffffff}
  .absolute{position:absolute;grid-column:2 / 3;background:#000000}
  .float{float:left;width:20px;height:40px}
  #ltr{left:20px}#ltr>.wrapper{padding-left:3px}
  #rtl{left:120px;direction:rtl}#rtl>.wrapper{padding-right:3px}#rtl .float{float:right}
  #direct{left:220px;width:50px;height:50px;padding:10px;grid:none}
  #padding-edge{position:absolute;width:20px;height:20px;margin-top:2px;background:#000000}
  </style>
  <div id="ltr" class="grid"><div class="wrapper"><div id="ltr-box" class="absolute"><div class="float"></div><div class="float"></div></div></div></div>
  <div id="rtl" class="grid"><div class="wrapper"><div id="rtl-box" class="absolute"><div class="float"></div><div class="float"></div></div></div></div>
  <div id="direct" class="grid"><div id="padding-edge"></div></div>`;

export function checkAbsoluteSizingControl(result, viewport) {
  const expected = [[34, 35, 40, 40], [108, 35, 40, 40], [223, 35, 20, 20]];
  return checkRectangles(result, viewport, ['ltr-box', 'rtl-box', 'padding-edge'], expected);
}

export const absolutePaddingBoxControl = `<!doctype html><style>
  body{margin:0}.parent{position:absolute;top:30px;width:100px;height:80px;padding:10px;
    border-style:solid;border-width:3px 5px 7px 11px;border-color:#ffffff}
  .box{position:absolute;width:50%;height:50%;margin:2px 4px 6px 8px;background:#000000}
  #start{left:10%;top:10%}#end{right:10%;bottom:10%}
  #stretch{left:10px;right:20px;top:5px;bottom:15px;width:auto;height:auto}
  </style>
  <div class="parent" style="left:20px"><div><div id="start" class="box"></div></div></div>
  <div class="parent" style="left:200px"><div><div id="end" class="box"></div></div></div>
  <div class="parent" style="left:380px"><div><div id="stretch" class="box"></div></div></div>`;

export function checkAbsolutePaddingBoxControl(result, viewport) {
  return checkRectangles(result, viewport, ['start', 'end', 'stretch'],
    [[51, 45, 60, 50], [255, 67, 60, 50], [409, 40, 78, 72]]);
}

export const absoluteAutoInsetControl = `<!doctype html><style>
  body{margin:0}.cb{position:absolute;width:200px;height:25px;border:3px solid #ffffff}
  .grid{display:grid;width:30px;height:25px;padding:2px 1px;border:1px solid #ffffff;
    margin-right:5px;grid:3px 14px 3px / 2px 20px 2px}
  .box{position:absolute;width:45px;height:35px;align-self:safe center;justify-self:safe end;
    grid-area:2/2/3/3;background:#000000}
  </style>
  <div class="cb" style="left:20px;top:30px"><div class="grid"><div id="safe-horizontal" class="box"></div></div></div>
  <div class="cb" style="left:300px;top:30px;writing-mode:vertical-rl"><div class="grid"><div id="safe-vertical" class="box"></div></div></div>
  <div class="cb" style="left:20px;top:130px"><div class="grid"><div id="unsafe-horizontal" class="box" style="justify-self:unsafe end"></div></div></div>
  <div class="cb" style="left:300px;top:130px;writing-mode:vertical-rl"><div class="grid"><div id="definite-vertical" class="box" style="left:20px"></div></div></div>`;

export function checkAbsoluteAutoInsetControl(result, viewport) {
  return checkRectangles(result, viewport, ['safe-horizontal', 'safe-vertical', 'unsafe-horizontal', 'definite-vertical'],
    [[23, 39, 45, 35], [458, 33, 45, 35], [10, 139, 45, 35], [323, 133, 45, 35]]);
}

export const absoluteDistributedControl = `<!doctype html><style>
  body{margin:0}.parent{position:absolute;top:30px;display:flex;width:100px;height:40px;
    padding:2px;border:3px solid #ffffff;justify-content:space-around}
  .box{position:absolute;width:20px;height:10px;background:#000000}
  </style>
  <div class="parent" style="left:20px"><div id="around" class="box"></div></div>
  <div class="parent" style="left:180px;width:10px;justify-content:space-evenly"><div id="overflow" class="box"></div></div>
  <div class="parent" style="left:300px;direction:rtl;justify-content:space-between"><div id="between" class="box"></div></div>
  <div class="parent" style="left:450px;width:40px;height:80px;flex-direction:column-reverse;justify-content:space-between"><div id="reverse" class="box"></div></div>`;

export function checkAbsoluteDistributedControl(result, viewport) {
  return checkRectangles(result, viewport, ['around', 'overflow', 'between', 'reverse'],
    [[65, 35, 20, 10], [180, 35, 20, 10], [385, 35, 20, 10], [455, 105, 20, 10]]);
}

export const absoluteBlockFlowControl = `<!doctype html><style>
  body{margin:0}.container{position:absolute;top:30px;width:100px;height:100px;padding:10px}
  .before{width:20px;height:20px;margin-bottom:15px;position:relative;top:40px;left:30px}
  .box{position:absolute;width:10px;height:10px;margin-top:3px;background:#000}
  .after{width:20px;height:20px;margin-top:25px}
  .vertical{writing-mode:vertical-lr}.vertical .before{margin:0 15px 0 0}.vertical .box{margin:0 0 0 3px}
  .reverse{writing-mode:vertical-rl}.reverse .before{margin:0 0 0 15px}.reverse .box{margin:0 3px 0 0}
  </style>
  <div class="container" style="left:20px"><div class="before"></div><div id="following" class="box"></div><div class="after"></div></div>
  <div class="container vertical" style="left:180px"><div class="before"></div><div id="vertical" class="box"></div></div>
  <div class="container reverse" style="left:340px"><div class="before"></div><div id="reverse-flow" class="box"></div></div>
  <div class="container" style="left:500px"><div class="before" style="display:none"></div><div id="empty-start" class="box"></div></div>
  <div class="container" style="left:20px;top:230px"><div class="before"></div><div id="fixed" class="box" style="position:fixed"></div></div>
  <div class="container" style="left:180px;top:230px"><div class="before"></div><div id="definite" class="box" style="top:0"></div></div>
  <div class="container" style="left:340px;top:230px"><div style="padding-top:5px"><div class="before"></div><div id="nested" class="box"></div></div></div>`;

export function checkAbsoluteBlockFlowControl(result, viewport) {
  return checkRectangles(result, viewport, ['following', 'vertical', 'reverse-flow', 'empty-start', 'fixed', 'definite', 'nested'],
    [[30, 78, 10, 10], [228, 40, 10, 10], [402, 40, 10, 10], [510, 43, 10, 10],
      [30, 278, 10, 10], [190, 233, 10, 10], [350, 283, 10, 10]]);
}

export const zeroOriginControl = `<!doctype html><style>
  body{margin:0}.box{position:absolute;top:30px;width:20px;height:20px;background:#000;transform:scale(2)}
  </style><div class="box" style="left:20px;transform-origin:0 0"></div>
  <div class="box" style="left:100px;transform-origin:0px 0px"></div>
  <div class="box" style="left:180px;transform-origin:0em 0em"></div>
  <div class="box" style="left:260px;transform-origin:0% 0%"></div>
  <div class="box" style="left:340px;transform-origin:center"></div>`;

export function checkZeroOriginControl(result, viewport) {
  // Paint rectangles differ from the untransformed layout rectangles.
  const expected = [[20, 30, 40, 40], [100, 30, 40, 40], [180, 30, 40, 40], [260, 30, 40, 40], [330, 20, 40, 40]];
  const nodes = result.nodes.filter(n => n.attributes.some(([key, value]) => key === 'class' && value === 'box'));
  const actual = nodes.map(n => n.box);
  const boxes = [20, 100, 180, 260, 340].map(x => [x, 30, 20, 20]);
  let differingPixels = 0;
  for (let y = 0; y < viewport.height; ++y) for (let x = 0; x < viewport.width; ++x) {
    const black = expected.some(([left, top, width, height]) => x >= left && x < left + width && y >= top && y < top + height);
    const offset = (y * viewport.width + x) * 4;
    if ([0, 1, 2].some(channel => result.pixels[offset + channel] !== (black ? 0 : 255))) ++differingPixels;
  }
  return { pass: JSON.stringify(actual) === JSON.stringify(boxes) && differingPixels === 0,
    actual: { boxes: actual, differingPixels }, expected: { boxes, differingPixels: 0 } };
}

function checkRectangles(result, viewport, ids, expected) {
  const actual = ids.map(id =>
    result.nodes.find(n => n.attributes.some(([key, value]) => key === 'id' && value === id))?.box);
  let differingPixels = 0;
  for (let y = 0; y < viewport.height; ++y) for (let x = 0; x < viewport.width; ++x) {
    const black = expected.some(([left, top, width, height]) => x >= left && x < left + width && y >= top && y < top + height);
    const offset = (y * viewport.width + x) * 4;
    if ([0, 1, 2].some(channel => result.pixels[offset + channel] !== (black ? 0 : 255))) ++differingPixels;
  }
  return { pass: JSON.stringify(actual) === JSON.stringify(expected) && differingPixels === 0,
    actual: { boxes: actual, differingPixels }, expected: { boxes: expected, differingPixels: 0 } };
}
