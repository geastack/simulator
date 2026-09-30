import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchAsync, fetchReady, fetchResult, fetchRelease, installCanvasBatchMethods } from '../dom-host-runtime.mjs'

test('fetch jobs buffer JSON and binary bodies and release their handles', async () => {
  const id = fetchAsync('data:application/json,{"value":3}')
  assert.equal(fetchReady(id), false)
  while (!fetchReady(id)) await new Promise((resolve) => setImmediate(resolve))
  const response = fetchResult(id)
  assert.equal(response.ok, true)
  assert.deepEqual(response.json(), { value: 3 })
  assert.equal(response.headers.get('content-type'), 'application/json')
  assert.equal(new TextDecoder().decode(response.bytes()), response.text())
  fetchRelease(id)
  assert.equal(fetchReady(id), false)
  assert.equal(fetchResult(id).status, 0)
})

test('failed fetch jobs settle and release during a pending fetch remains released', async () => {
  const id = fetchAsync('invalid-protocol:request')
  while (!fetchReady(id)) await new Promise((resolve) => setImmediate(resolve))
  assert.equal(fetchResult(id).ok, false)
  fetchRelease(id)
  const pending = fetchAsync('data:text/plain,body')
  fetchRelease(pending)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(fetchReady(pending), false)
})

test('canvas submission methods are available without replacing host implementations', () => {
  class Context {
    flush() {
      return 'host'
    }
  }
  installCanvasBatchMethods(Context)
  const context = new Context()
  context.beginBatch()
  context.endBatch()
  assert.equal(context.flush(), 'host')
})

test('fetch jobs are also available through the declared global surface', () => {
  assert.equal(globalThis.fetchAsync, fetchAsync)
  assert.equal(globalThis.fetchReady, fetchReady)
  assert.equal(globalThis.fetchResult, fetchResult)
  assert.equal(globalThis.fetchRelease, fetchRelease)
})
