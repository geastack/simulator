// SPDX-License-Identifier: Apache-2.0
// Literal paint rectangles keep transform composition independent of reftests
// whose two sides can otherwise share the same renderer defect.
export const individualTranslateControl = `<!doctype html><style>
  body{margin:0}.box{position:absolute;width:20px;height:10px;background:#000;transform-origin:0 0}
  #first{left:20px;top:30px;translate:40px 20px;transform:translateX(10px) scale(2)}
  #last{left:160px;top:30px;transform:translateX(10px) scale(2);translate:40px 20px}
  #rotated{left:300px;top:30px;translate:40px 20px;transform:rotate(90deg) scale(2)}
  #percent{left:420px;top:30px;width:40px;height:20px;translate:50% 100%;transform:scale(2)}
  #none{left:20px;top:150px;translate:30px 20px;transform:none}
  #list{left:160px;top:150px;translate:none;transform:translate(30px,20px)}
  .parent{position:absolute;left:300px;top:150px;width:100px;height:100px;translate:0}
  #fixed{position:fixed;left:5px;top:7px}
  #outer{left:20px;top:300px;transform:translate(40px,20px) rotate(90deg) scale(2)}
  #inner{left:200px;top:300px;transform:rotate(90deg) translate(40px,20px) scale(2)}
  </style><div id="first" class="box"></div><div id="last" class="box"></div>
  <div id="rotated" class="box"></div><div id="percent" class="box"></div>
  <div id="none" class="box"></div><div id="list" class="box"></div>
  <div class="parent"><div id="fixed" class="box"></div></div>
  <div id="outer" class="box"></div><div id="inner" class="box"></div>`;

export function checkIndividualTranslateControl(result, viewport) {
  const expected = [[70, 50, 40, 20], [210, 50, 40, 20], [320, 50, 20, 40],
    [440, 50, 80, 40], [50, 170, 20, 10], [190, 170, 20, 10], [305, 157, 20, 10],
    [40, 320, 20, 40], [160, 340, 20, 40]];
  let differingPixels = 0;
  for (let y = 0; y < viewport.height; ++y) for (let x = 0; x < viewport.width; ++x) {
    const black = expected.some(([left, top, width, height]) => x >= left && x < left + width && y >= top && y < top + height);
    const offset = (y * viewport.width + x) * 4;
    if ([0, 1, 2].some(channel => result.pixels[offset + channel] !== (black ? 0 : 255))) ++differingPixels;
  }
  return { pass: differingPixels === 0, actual: { differingPixels }, expected: { paintedRectangles: expected, differingPixels: 0 } };
}
