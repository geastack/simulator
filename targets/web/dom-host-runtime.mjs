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

installCanvasBatchMethods()

// The application declarations support both imported and global job functions.
Object.assign(globalThis, { fetchAsync, fetchReady, fetchResult, fetchRelease })
