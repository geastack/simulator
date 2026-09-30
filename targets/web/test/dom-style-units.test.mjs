import assert from 'node:assert/strict'
import { styleValue, styleObject, styleText, styleAttributes } from '../dom-style-units.mjs'

assert.equal(styleValue('width', 150), 'calc(150 * var(--geastack-raw-pixel, 1px))')
assert.equal(styleValue('width', '150px'), '150px')
assert.equal(styleValue('width', '50%'), '50%')
assert.equal(styleValue('width', 'calc(100% - 20px)'), 'calc(100% - 20px)')
for (const key of ['opacity', 'lineHeight', 'flex', 'zIndex', '--size']) assert.equal(styleValue(key, 1.5), '1.5')
for (const value of [null, undefined, false]) assert.equal(styleValue('width', value), value)
assert.equal(styleValue('padding', '10 20px 0 5'), 'calc(10 * var(--geastack-raw-pixel, 1px)) 20px 0px calc(5 * var(--geastack-raw-pixel, 1px))')
assert.equal(styleText('width:150!important;background:url("a;b:c");opacity:0.5'),
  'width:calc(150 * var(--geastack-raw-pixel, 1px))!important;background:url("a;b:c");opacity:0.5')
const original = { width: 150, opacity: 0.5 }
assert.equal(styleObject(original).opacity, '0.5')
assert.equal(original.width, 150)
let reads = 0
const spread = styleAttributes({ get style() { reads++; return original }, id: 'x' })
assert.equal(reads, 1)
assert.equal(spread.id, 'x')
assert.equal(spread.style.width, styleValue('width', 150))
console.log('Style units: numeric lengths, CSS units, multipliers, strings and spreads passed')
