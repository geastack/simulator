// This is the DOM target's conversion boundary. Gea's browser defaults must
// never decide whether a GeaStack number denotes a length or a multiplier.
const lengths = new Set(`width height min-width min-height max-width max-height
top right bottom left inset inset-inline inset-block inset-inline-start inset-inline-end inset-block-start inset-block-end
padding padding-top padding-right padding-bottom padding-left padding-inline padding-block
margin margin-top margin-right margin-bottom margin-left margin-inline margin-block
gap row-gap column-gap border-width border-top-width border-right-width border-bottom-width border-left-width
border-radius border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius
font-size letter-spacing word-spacing text-indent flex-basis perspective scroll-margin scroll-padding`.split(/\s+/))
const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i

function rawLength(value) {
  return Number(value) === 0 ? '0px' : `calc(${value} * var(--geastack-raw-pixel, 1px))`
}

export function styleValue(property, value) {
  if (value == null || value === false) return value
  const name = property.startsWith('--') ? property : property.replace(/[A-Z]/g, c => '-' + c.toLowerCase())
  if (!lengths.has(name)) return typeof value === 'number' ? String(value) : value
  if (typeof value === 'number') return Number.isFinite(value) ? rawLength(value) : String(value)
  // Convert bare lengths in shorthands without touching percentages, authored
  // CSS units, function arguments, quoted text or custom-property contents.
  let depth = 0
  let quote = ''
  return String(value).replace(/\\.|["']|[()]|[^\s()/"']+|[\s/]+/g, token => {
    if (token.startsWith('\\')) return token
    if (quote) { if (token === quote) quote = ''; return token }
    if (token === '"' || token === "'") { quote = token; return token }
    if (token === '(') depth++
    if (token === ')') depth--
    return depth === 0 && number.test(token) ? rawLength(token) : token
  })
}

export function styleText(text) {
  // Declaration boundaries are outside strings, comments and functions.
  let start = 0, depth = 0, quote = '', comment = false
  const declarations = []
  const append = end => {
    const declaration = text.slice(start, end)
    const colon = declaration.indexOf(':')
    if (colon < 0) declarations.push(declaration)
    else {
      const property = declaration.slice(0, colon)
      const value = declaration.slice(colon + 1)
      const important = value.match(/\s*!important\s*$/i)?.[0] || ''
      declarations.push(property + ':' + styleValue(property.trim(), value.slice(0, value.length - important.length)) + important)
    }
    start = end + 1
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1]
    if (comment) { if (c === '*' && next === '/') { comment = false; i++ }; continue }
    if (c === '\\') { i++; continue }
    if (quote) { if (c === quote) quote = ''; continue }
    if (c === '/' && next === '*') { comment = true; i++; continue }
    if (c === '"' || c === "'") quote = c
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ';' && depth === 0) append(i)
  }
  append(text.length)
  return declarations.join(';')
}

export function styleObject(value) {
  if (typeof value === 'string') return styleText(value)
  if (!value || typeof value !== 'object') return value
  const result = {}
  for (const key in value) result[key] = styleValue(key, value[key])
  return result
}

export function styleAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object') return attributes
  // Accessors must run once and in source order, as with the original spread.
  const result = { ...attributes }
  if (Object.hasOwn(result, 'style')) result.style = styleObject(result.style)
  for (const key of Object.keys(result)) {
    if (/^on[A-Z]/.test(key) || ['click', 'pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend'].includes(key)) {
      result[key] = eventHandler(result[key])
    }
  }
  return result
}

const handlers = new WeakMap()
const coordinates = new Set(['x', 'y', 'clientX', 'clientY', 'pageX', 'pageY', 'screenX', 'screenY', 'offsetX', 'offsetY', 'movementX', 'movementY'])

function nativeEvent(event, scale) {
  return new Proxy(event, {
    get(target, key) {
      const value = Reflect.get(target, key, target)
      if (coordinates.has(key) && typeof value === 'number') return value * scale
      if (['touches', 'targetTouches', 'changedTouches'].includes(key) && value) return Array.from(value, touch => nativeEvent(touch, scale))
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

export function eventHandler(handler) {
  if (typeof handler !== 'function') return handler
  if (!handlers.has(handler)) handlers.set(handler, function (event, ...rest) {
    const scale = globalThis.__geaTargetScale || 1
    return handler.call(this, scale === 1 || !event || typeof event !== 'object' ? event : nativeEvent(event, scale), ...rest)
  })
  return handlers.get(handler)
}

export function setTargetScale(value, document = globalThis.document) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError('Target scale must be finite and positive')
  document.documentElement.style.setProperty('--geastack-raw-pixel', `${1 / value}px`)
}

if (typeof document !== 'undefined') {
  globalThis.__geaSetTargetScale = value => setTargetScale(value)
  setTargetScale(globalThis.__geaTargetScale || 1)
}
