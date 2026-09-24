// The shell never loads the app runtime: its iframe owns DOM, CSS, and Vite HMR.
export const EMULATOR_PATH = '/__gea_emulator'

export function emulatorOptions(flags) {
  const values = { width: 390, height: 844, dpr: 1, zoom: 1 }
  for (const key of Object.keys(values)) {
    if (flags[`--${key}`] !== undefined) values[key] = Number(flags[`--${key}`])
    if (!Number.isFinite(values[key]) || values[key] <= 0) throw new Error(`--${key} must be a positive number.`)
  }
  return values
}

export function emulatorHtml(options, base = '/') {
  const initial = JSON.stringify(options).replaceAll('<', '\\u003c')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Gea DOM emulator</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;background:#171a21;color:#f4f6fa;font:14px system-ui}header{display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:16px;background:#242936}
label{display:flex;gap:6px;align-items:center}input{width:70px}main{padding:24px;overflow:auto}#device{position:relative;box-shadow:0 0 0 8px #080a0e;border-radius:8px;overflow:hidden}
iframe{border:0;display:block;transform-origin:top left;background:white}small{color:#c4cbd8}
</style></head><body><header><strong>Gea DOM emulator</strong>
<label>Width <input id="width" type="number" min="1"></label>
<label>Height <input id="height" type="number" min="1"></label>
<label>DPR <input id="dpr" type="number" min="0.1" step="0.1"></label>
<label>Zoom <input id="zoom" type="number" min="0.1" step="0.1"></label>
<small>Browser layout · simulated device APIs</small></header>
<main><div id="device"><iframe title="Gea application"></iframe></div></main>
<script>
const values = ${initial};
const frame = document.querySelector('iframe');
const device = document.querySelector('#device');
function update() {
  frame.style.width = values.width + 'px'; frame.style.height = values.height + 'px';
  frame.style.transform = 'scale(' + values.zoom + ')';
  device.style.width = values.width * values.zoom + 'px'; device.style.height = values.height * values.zoom + 'px';
  try {
    const app = frame.contentWindow; app.__geaEmulatorDpr = values.dpr;
    if (app.location.origin === location.origin && app.location.pathname !== 'blank') {
      const url = new URL(app.location.href); url.searchParams.set('__gea_emulator_dpr', values.dpr);
      app.history.replaceState(app.history.state, '', url);
    }
  } catch {}
}
for (const key of Object.keys(values)) {
  const input = document.getElementById(key); input.value = values[key];
  input.addEventListener('change', () => {
    const value = Number(input.value);
    if (!Number.isFinite(value) || value <= 0) { input.value = values[key]; return; }
    values[key] = value; update();
  });
}
frame.addEventListener('load', update);
frame.src = ${JSON.stringify(base)} + '?__gea_emulator_dpr=' + values.dpr;
update();
</script></body></html>`
}
