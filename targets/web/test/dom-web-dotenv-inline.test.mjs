// dev-web inlines .env values into app sources itself (Vite's `define` only
// runs in the build). A plain text replace would also rewrite
// `process.env.KEY` inside strings and comments, so only real member
// expressions may be replaced.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { inlineDotEnv, loadBabel } from '../dom-web-shared.mjs'

const coreRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../node_modules/@geastack/core')
const babel = existsSync(coreRoot) ? loadBabel(coreRoot) : null
if (!babel) {
  console.error(`dom-web-dotenv-inline: no @babel/parser under ${coreRoot}; run npm install first`)
  process.exit(1)
}

const defines = {
  'process.env.KEY': '"v"',
  'import.meta.env.KEY': '"v"',
}
const inline = (code, file = 'App.tsx') => inlineDotEnv(code, file, defines, babel)

assert.equal(inline('const a = process.env.KEY'), 'const a = "v"')
assert.equal(inline('const a = import.meta.env.KEY'), 'const a = "v"')
assert.equal(inline('const a = process.env.KEYS'), 'const a = process.env.KEYS')
assert.equal(inline('f(process.env.KEY.length)'), 'f("v".length)')
assert.equal(inline('const a = process.env?.KEY'), 'const a = "v"')
assert.equal(inline('const a = import.meta.env?.KEY'), 'const a = "v"')
assert.equal(inline('f(process.env?.KEY.length)'), 'f("v".length)')
assert.equal(inline('const a = process.env?.KEYS'), 'const a = process.env?.KEYS')
assert.equal(inline('const el = <p title={process.env.KEY}>{process.env.KEY}</p>'), 'const el = <p title={"v"}>{"v"}</p>')

const untouched = [
  "const s = 'process.env.KEY'",
  'const s = "import.meta.env.KEY"',
  'const s = `set process.env.KEY first`',
  '// reads process.env.KEY\nconst a = 1',
  '/* process.env.KEY */ const a = 1',
  'const el = <p>process.env.KEY</p>',
  'process.env.KEY = "x"',
  'process.env.KEY++',
  'for (process.env.KEY in o);',
  'for (process.env.KEY of a);',
  '[process.env.KEY] = a',
  '({ k: process.env.KEY } = o)',
  '[process.env.KEY = "d"] = a',
  '[...process.env.KEY] = a',
  '({ ...process.env.KEY } = o)',
  'function f(process) { return process.env.KEY }',
  'const process = p; const a = process.env?.KEY',
  '({ process }) => process.env.KEY',
]
for (const code of untouched) assert.equal(inline(code), code, `rewrote non-expression text: ${code}`)

// Only a local `process` shadows the global; its enclosing function doesn't.
assert.equal(
  inline('function f() { return process.env.KEY }\nfunction g(process) { return process.env.KEY }'),
  'function f() { return "v" }\nfunction g(process) { return process.env.KEY }',
)

// Ambient declarations are erased, while nested runtime bindings still shadow.
for (const declaration of ['declare const process: any;', 'declare let process: any;', 'declare var process: any;', 'declare function process(): void;']) {
  assert.equal(
    inline(`${declaration} const value = process.env.KEY; function f(process: any) { return process.env.KEY }`),
    `${declaration} const value = "v"; function f(process: any) { return process.env.KEY }`,
  )
}

// A computed key in a pattern is a read, not a target.
assert.equal(inline('({ [process.env.KEY]: x } = o)'), '({ ["v"]: x } = o)')

assert.equal(
  inline('const s = `${process.env.KEY} and process.env.KEY` // process.env.KEY'),
  'const s = `${"v"} and process.env.KEY` // process.env.KEY',
)
assert.equal(inline('const n = <number>(process.env.KEY as any)', 'a.mts'), 'const n = <number>("v" as any)')

console.log('dev-web inlines .env values only where they are real expressions')

for (const expression of ['process?.env.KEY', 'process . env.KEY', 'import.meta . env.KEY', 'process /* gap */ . env.KEY']) {
  assert.equal(inline(`const value = ${expression}`), 'const value = "v"')
}
assert.equal(inline('@decorator class Example { value = process.env.KEY }'), '@decorator class Example { value = "v" }')
assert.throws(() => inline('const value = process.env.KEY; @'), /Unable to inline .*App.tsx/)
