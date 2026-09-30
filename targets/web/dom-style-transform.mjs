import { fileURLToPath } from 'node:url'

const events = new Set('click dblclick input change focus blur keydown keyup pointerdown pointermove pointerup touchstart touchmove touchend mousedown mousemove mouseup wheel scroll'.split(' '))

export function domStyleCompat(code, filename, babel) {
  if (!babel || (!code.includes('<') && !code.includes('addEventListener') && !code.includes('removeEventListener'))) return code
  const { parser, traverse, generate, t } = babel
  const plugins = ['typescript', 'decorators-legacy', 'classProperties', 'classPrivateProperties', 'classPrivateMethods']
  if (!/\.[cm]?ts$/.test(filename)) plugins.push('jsx')
  const ast = parser.parse(code, { sourceType: 'module', plugins, sourceFilename: filename })
  const helpers = new Map()
  let program
  const call = (name, args) => {
    if (!helpers.has(name)) helpers.set(name, program.scope.generateUidIdentifier(`gea${name}`))
    return t.callExpression(t.cloneNode(helpers.get(name)), args)
  }
  traverse(ast, {
    Program(p) { program = p },
    JSXOpeningElement(p) {
      if (!t.isJSXIdentifier(p.node.name) || !/^[a-z]/.test(p.node.name.name)) return
      for (const attr of p.node.attributes) {
        if (t.isJSXSpreadAttribute(attr)) {
          attr.argument = call('styleAttributes', [attr.argument])
          continue
        }
        if (t.isJSXIdentifier(attr.name) && (events.has(attr.name.name) || /^on[A-Z]/.test(attr.name.name)) && t.isJSXExpressionContainer(attr.value)) {
          let handler = attr.value.expression
          if (t.isMemberExpression(handler) && t.isThisExpression(handler.object)) {
            handler = t.callExpression(t.memberExpression(handler, t.identifier('bind')), [t.thisExpression()])
          }
          attr.value.expression = call('eventHandler', [handler])
          continue
        }
        if (!t.isJSXIdentifier(attr.name, { name: 'style' }) || !attr.value) continue
        const value = t.isStringLiteral(attr.value) ? attr.value : attr.value.expression
        if (t.isObjectExpression(value) && value.properties.every(p => t.isObjectProperty(p) && !p.computed)) {
          for (const property of value.properties) {
            const key = t.isIdentifier(property.key) ? property.key.name : String(property.key.value)
            property.value = call('styleValue', [t.stringLiteral(key), property.value])
            property.shorthand = false
          }
        } else attr.value = t.jsxExpressionContainer(call('styleObject', [value]))
      }
    },
    CallExpression(p) {
      const callee = p.node.callee
      if (!t.isMemberExpression(callee) || callee.computed || !t.isIdentifier(callee.property)) return
      if (['addEventListener', 'removeEventListener'].includes(callee.property.name) && p.node.arguments.length >= 2) {
        p.node.arguments[1] = call('eventHandler', [p.node.arguments[1]])
        p.skip()
      }
    },
  })
  if (!helpers.size) return code
  ast.program.body.unshift(t.importDeclaration(
    [...helpers].map(([name, local]) => t.importSpecifier(local, t.identifier(name))),
    t.stringLiteral(fileURLToPath(new URL('./dom-style-units.mjs', import.meta.url))),
  ))
  return generate(ast, { retainLines: true }, code).code
}
