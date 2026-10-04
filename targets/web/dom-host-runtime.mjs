import './dom-audio-runtime.mjs'

// Fetch jobs expose synchronous body readers after the browser has buffered the response.
const jobs = new Map()
let nextJob = 1

function responseValue(status = 0, statusText = '', headers = new Headers(), body = new Uint8Array()) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers,
    body,
    text: () => new TextDecoder().decode(body),
    json: () => JSON.parse(new TextDecoder().decode(body)),
    bytes: () => body.slice(),
    arrayBuffer: () => body.slice()
  }
}

export function fetchAsync(url, init) {
  const id = nextJob++
  const job = { ready: false, response: responseValue() }
  jobs.set(id, job)
  Promise.resolve()
    .then(() => globalThis.fetch(url, init))
    .then(async (response) => {
      const body = new Uint8Array(await response.arrayBuffer())
      job.response = responseValue(response.status, response.statusText, response.headers, body)
    })
    .catch((error) => {
      job.response = responseValue(0, String(error))
    })
    .finally(() => {
      job.ready = true
    })
  return id
}

export function fetchReady(id) {
  return jobs.get(id)?.ready ?? false
}
export function fetchResult(id) {
  return jobs.get(id)?.response ?? responseValue()
}
export function fetchRelease(id) {
  jobs.delete(id)
}

export function installCanvasBatchMethods(contextType = globalThis.CanvasRenderingContext2D) {
  if (!contextType) return
  // The browser already batches canvas drawing; these are native submission boundaries.
  for (const name of ['beginBatch', 'endBatch', 'flush']) {
    if (typeof contextType.prototype[name] !== 'function') {
      Object.defineProperty(contextType.prototype, name, {
        configurable: true,
        writable: true,
        value() {}
      })
    }
  }
}

// `ctx.createImageData565(w, h)` / `ctx.putImageData(img, x, y)`: on device an
// app-owned RGB565 buffer blitted straight to the panel. The browser has no
// 16-bit canvas, so each put expands `data16` into an RGBA ImageData kept
// beside it (the same 565 -> 888 expansion the engine's fromRgb565 does).
export function installImageData565(contextType = globalThis.CanvasRenderingContext2D) {
  if (!contextType || typeof contextType.prototype.createImageData565 === 'function') return
  const rgba = new WeakMap()
  Object.defineProperty(contextType.prototype, 'createImageData565', {
    configurable: true,
    writable: true,
    value(width, height) {
      const w = Math.max(0, Math.floor(width))
      const h = Math.max(0, Math.floor(height))
      const image = { width: w, height: h, data16: new Uint16Array(w * h) }
      rgba.set(image, this.createImageData(Math.max(1, w), Math.max(1, h)))
      return image
    }
  })
  const putImageData = contextType.prototype.putImageData
  Object.defineProperty(contextType.prototype, 'putImageData', {
    configurable: true,
    writable: true,
    value(image, ...rest) {
      const target = image && rgba.get(image)
      if (!target) return putImageData.call(this, image, ...rest)
      const src = image.data16
      const dst = target.data
      for (let i = 0, j = 0; i < src.length; i++, j += 4) {
        const p = src[i]
        const r = (p >> 11) & 31
        const g = (p >> 5) & 63
        const b = p & 31
        dst[j] = (r << 3) | (r >> 2)
        dst[j + 1] = (g << 2) | (g >> 4)
        dst[j + 2] = (b << 3) | (b >> 2)
        dst[j + 3] = 255
      }
      return putImageData.call(this, target, ...rest)
    }
  })
}

installCanvasBatchMethods()
installImageData565()

// The application declarations support both imported and global job functions.
Object.assign(globalThis, { fetchAsync, fetchReady, fetchResult, fetchRelease })
