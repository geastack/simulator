// SPDX-License-Identifier: Apache-2.0
import { parse } from 'parse5';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import { normalizeNamedColors } from './named-colors.mjs';
import { defaultFont, ahemFont, monospaceFont } from './fonts.mjs';

export class Unsupported extends Error {}

// Conservative dependency discovery for scoped renderer prerequisites. Inspect
// values on both sides, including custom-property fallbacks; never infer a
// dependency from a selector, quoted string or URL.
export function usesCssUnit(document, unit) {
  const declarations = document.rules.flatMap(rule => rule.declarations);
  function visit(node) {
    declarations.push(...node.inline);
    node.children.forEach(visit);
  }
  visit(document.tree);
  return declarations.some(([, value]) => {
    let found = false;
    valueParser(value).walk(node => {
      if (node.type === 'function' && node.value.toLowerCase() === 'url') return false;
      if (node.type === 'word' && valueParser.unit(node.value)?.unit?.toLowerCase() === unit.toLowerCase()) found = true;
    });
    return found;
  });
}

export function failedPrerequisites(prerequisites, documents) {
  function hasTag(node, tag) { return node.tag === tag || node.children.some(child => hasTag(child, tag)); }
  function hasPseudo(document, pseudo) {
    const pattern = new RegExp(`(^|[^\\\\]):{1,2}${pseudo}(?![\\w-])`, 'i');
    return document.rules.some(rule => pattern.test(rule.selector.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '')));
  }
  return prerequisites.filter(p => !p.pass &&
    (!p.cssUnit || documents.some(doc => usesCssUnit(doc, p.cssUnit))) &&
    (!p.cssPseudo || documents.some(doc => hasPseudo(doc, p.cssPseudo))) &&
    (!p.cssProperty || documents.some(doc => doc.properties.some(name => name === p.cssProperty || name.startsWith(`${p.cssProperty}-`)))) &&
    (!p.htmlTag || documents.some(doc => hasTag(doc.tree, p.htmlTag))));
}

export function localReference(from, href) {
  const url = new URL(href, `https://wpt.invalid/${from}`);
  if (url.origin !== 'https://wpt.invalid' || url.search || url.hash) throw new Unsupported(`External or parameterized resource: ${href}`);
  return url.pathname.slice(1);
}

// This transport adapter normalizes named colors to equivalent RGB hex values.
// Layout decisions and style resolution remain in Gea; upstream files stay intact.
export function parseDocument(source, name, { readResource } = {}) {
  if (!name.endsWith('.html')) throw new Unsupported('Only HTML documents are supported; XHTML needs an XML adapter');
  const dom = parse(source);
  if (dom.mode !== 'no-quirks') throw new Unsupported('Quirks-mode document');
  const rules = [], references = [], specs = [], normalizations = [], fonts = [], properties = new Set();
  let title = name, fuzzy = null, count = 0, monospace = false;
  function declarations(nodes) {
    return nodes.filter(n => n.type !== 'comment').map(n => {
      if (n.type !== 'decl') throw new Unsupported('Nested CSS or at-rule');
      if (/url\s*\(/i.test(n.value)) throw new Unsupported('CSS resource/font loading');
      if (n.important) throw new Unsupported('!important needs priority-preserving declaration transport');
      if (n.prop.toLowerCase() === 'display' && !/^(block|flex|grid|none|flow-root|list-item|inline|inline-block|inline-flex|inline-grid)$/i.test(n.value)) throw new Unsupported('Only block/flex/grid/none/flow-root/list-item/inline/inline-block/inline-flex/inline-grid display declarations are supported by this adapter');
      if (n.prop.toLowerCase() === 'content') throw new Unsupported('Generated text content');
      if (/^(animation|transition)(-|$)/i.test(n.prop)) throw new Unsupported('Animation/transition timing is not implemented by this static adapter');
      properties.add(n.prop);
      if (/^font(-family)?$/i.test(n.prop) && /\bmonospace\b/i.test(n.value)) monospace = true;
      const value = normalizeNamedColors(n.prop, n.value);
      if (value !== n.value) normalizations.push({ property: n.prop, from: n.value, to: value });
      return [n.prop, value];
    });
  }
  function fontFace(node, from) {
    const descriptors = new Map();
    for (const d of node.nodes || []) {
      if (d.type === 'comment') continue;
      if (d.type !== 'decl' || d.important) throw new Unsupported('Unsupported font-face declaration');
      if (!['font-family', 'src', 'font-style', 'font-weight'].includes(d.prop.toLowerCase()))
        throw new Unsupported(`Font-face descriptor ${d.prop}`);
      descriptors.set(d.prop.toLowerCase(), d.value);
    }
    for (const descriptor of ['font-style', 'font-weight']) {
      const value = descriptors.get(descriptor);
      if (value && value !== 'normal' && !(descriptor === 'font-weight' && value === '400'))
        throw new Unsupported(`Font-face ${descriptor}: ${value}`);
    }
    const familyNodes = valueParser(descriptors.get('font-family') || '').nodes.filter(n => n.type !== 'comment');
    let family;
    if (familyNodes.length === 1 && familyNodes[0].type === 'string') family = familyNodes[0].value;
    else if (familyNodes.every(n => n.type === 'word' || n.type === 'space')) family = valueParser.stringify(familyNodes).trim();
    if (!family || /\\/.test(family)) throw new Unsupported('Unsupported font-family descriptor');
    const source = valueParser(descriptors.get('src') || '').nodes.filter(n => !['comment', 'space'].includes(n.type));
    if (source.length < 1 || source.length > 2 || source[0].type !== 'function' || source[0].value.toLowerCase() !== 'url')
      throw new Unsupported('Font source requires a single pinned TrueType URL');
    if (source[1] && !(source[1].type === 'function' && source[1].value.toLowerCase() === 'format' &&
        source[1].nodes.length === 1 && ['truetype', 'woff'].includes(source[1].nodes[0].value.toLowerCase())))
      throw new Unsupported('Unsupported font source format');
    const urlNodes = source[0].nodes;
    if (urlNodes.length !== 1 || !['word', 'string'].includes(urlNodes[0].type) || /\\/.test(urlNodes[0].value))
      throw new Unsupported('Unsupported font URL');
    const font = { family, path: localReference(from, urlNodes[0].value) };
    if (!/\.(ttf|woff)$/i.test(font.path)) throw new Unsupported('Only pinned TrueType and WOFF1 fonts are currently supported');
    const existing = fonts.find(f => f.family.toLowerCase() === family.toLowerCase());
    if (existing && existing.path !== font.path) throw new Unsupported('Multiple sources for one font family');
    if (!existing) fonts.push(font);
  }
  function stylesheet(text, from = name) {
    for (const n of postcss.parse(text).nodes) {
      if (n.type === 'comment') continue;
      if (n.type === 'atrule' && n.name.toLowerCase() === 'font-face') { fontFace(n, from); continue; }
      if (n.type !== 'rule') throw new Unsupported(`CSS ${n.type}: ${n.name || ''}`);
      const values = declarations(n.nodes);
      for (const selector of postcss.list.comma(n.selector)) {
        if (!/^(html|body)$/i.test(selector) && /(?:^|[\s>+~])(?:html|body)(?=[\s.#:[>+~]|$)/i.test(selector)) throw new Unsupported('Compound HTML/body selectors use native application-root aliases');
        rules.push({ selector, declarations: values });
      }
    }
  }
  function inspect(n) {
    const a = Object.fromEntries((n.attrs || []).map(a => [a.name, a.value]));
    if (n.tagName === 'script') throw new Unsupported('JavaScript/testharness document');
    if (n.tagName === 'base') throw new Unsupported('HTML base URL');
    if (n.tagName === 'style') {
      if (a.media && a.media !== 'all') throw new Unsupported('Style media condition');
      if (a.type && a.type.toLowerCase() !== 'text/css') throw new Unsupported(`Style MIME type ${a.type}`);
      stylesheet(n.childNodes.map(n => n.value || '').join(''));
    }
    if (n.tagName === 'title') title = n.childNodes.map(n => n.value || '').join('').trim();
    if (n.tagName === 'link') {
      if (['match', 'mismatch'].includes(a.rel)) references.push({ relation: a.rel, path: localReference(name, a.href) });
      if (a.rel === 'help') specs.push(a.href);
      if (a.rel === 'stylesheet') {
        if (!readResource) throw new Unsupported('External stylesheet loading');
        if (a.media && a.media !== 'all') throw new Unsupported('Stylesheet media condition');
        if (a.type && a.type.toLowerCase() !== 'text/css') throw new Unsupported(`Stylesheet MIME type ${a.type}`);
        if (Object.hasOwn(a, 'disabled')) throw new Unsupported('Disabled stylesheet');
        // Resolve from the document URL and apply in document order. The caller
        // supplies only hash-verified vendored resources; no network during runs.
        const source = localReference(name, a.href);
        stylesheet(readResource(source), source);
      }
    }
    if (n.tagName === 'meta' && a.name === 'fuzzy') {
      if (fuzzy !== null) throw new Unsupported('Multiple/per-reference fuzzy metadata');
      fuzzy = parseFuzzy(a.content);
    }
    if (n.tagName === 'meta' && ['viewport', 'flags'].includes(a.name) && a.content) throw new Unsupported(`Test metadata: ${a.name}=${a.content}`);
    for (const [key, value] of Object.entries(a)) {
      if (key.startsWith('on')) throw new Unsupported(`Event handler ${key}`);
      if (key === 'class' && /(?:^|\s)(?:reftest-wait|test-wait)(?:\s|$)/.test(value)) throw new Unsupported('Script-controlled screenshot readiness');
    }
    for (const child of n.childNodes || []) inspect(child);
  }
  inspect(dom);
  function element(n) {
    if (n.nodeName === '#comment') return null;
    if (n.nodeName === '#text') {
      if (/[^\t\r\n\f\x20-\x7e\u00b0]/u.test(n.value)) throw new Unsupported('Text codepoint outside native runtime font repertoire');
      if (++count > 450) throw new Unsupported('Document exceeds adapter node limit');
      return { tag: '#text', text: n.value, attributes: [], inline: [], children: [] };
    }
    if (n.tagName === 'head') return null;
    if (!['html', 'body', 'div', 'span', 'section', 'p', 'br', 'strong', 'aside', 'article', 'flexbox', 'grid', 'container', 'item'].includes(n.tagName)) throw new Unsupported(`HTML element <${n.tagName}>`);
    if (n.namespaceURI !== 'http://www.w3.org/1999/xhtml') throw new Unsupported('Non-HTML namespace');
    if (++count > 450) throw new Unsupported('Document exceeds adapter node limit');
    const attributes = [], inline = [];
    for (const a of n.attrs || []) {
      if (a.name === 'style') inline.push(...declarations(postcss.parse(a.value).nodes));
      else if (['id', 'class'].includes(a.name) || a.name.startsWith('data-')) attributes.push([a.name, a.value]);
      else if (a.name !== 'xmlns') throw new Unsupported(`HTML attribute ${a.name}`);
    }
    const children = [];
    for (const child of (n.childNodes || []).map(element).filter(Boolean)) {
      const previous = children.at(-1);
      // Comments create no CSS boxes; adjoining DOM text forms one sequence.
      if (child.tag === '#text' && previous?.tag === '#text') previous.text += child.text;
      else children.push(child);
    }
    return { tag: n.tagName, attributes, inline, children };
  }
  const tree = element(dom.childNodes.find(n => n.tagName === 'html'));
  if (!fonts.some(font => font.family.toLowerCase() === defaultFont.family)) fonts.unshift(defaultFont);
  if (!fonts.some(font => font.family.toLowerCase() === 'ahem')) fonts.push(ahemFont);
  if (monospace && !fonts.some(font => font.family.toLowerCase() === 'monospace')) fonts.push(monospaceFont);
  return { title, tree, rules, fonts, references, specs, fuzzy, normalizations, properties: [...properties].sort() };
}

export function parseFuzzy(value) {
  const parts = value.split(';').map(v => v.trim().replace(/^(maxDifference|totalPixels)=/, ''));
  if (parts.length !== 2 || parts.some(p => !/^\d+(?:-\d+)?$/.test(p))) throw new Unsupported(`Unsupported fuzzy metadata: ${value}`);
  const ranges = parts.map(p => p.includes('-') ? p.split('-').map(Number) : [Number(p), Number(p)]);
  if (ranges.some(([a, b]) => a > b) || ranges[0][1] > 255) throw new Error(`Invalid fuzzy metadata: ${value}`);
  return { maxDifference: ranges[0], totalPixels: ranges[1] };
}

export function comparePixels(a, b, fuzzy = null) {
  if (a.length !== b.length || a.length % 4) throw new Error('Framebuffer dimensions differ');
  let totalPixels = 0, maxDifference = 0;
  const diff = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i += 4) {
    let delta = 0;
    for (let c = 0; c < 3; c++) delta = Math.max(delta, Math.abs(a[i + c] - b[i + c]));
    if (delta) totalPixels++;
    maxDifference = Math.max(maxDifference, delta);
    diff[i] = delta ? 255 : 0;
    diff[i + 2] = delta ? 255 : 0;
    diff[i + 3] = 255;
  }
  const within = (v, [lo, hi]) => v >= lo && v <= hi;
  const matches = fuzzy ? within(maxDifference, fuzzy.maxDifference) && within(totalPixels, fuzzy.totalPixels) : totalPixels === 0;
  return { matches, totalPixels, maxDifference, diff };
}

export function reftestPass(comparisons) {
  if (!comparisons.length) throw new Error('No references');
  const matches = comparisons.filter(c => c.relation === 'match');
  return (!matches.length || matches.some(c => c.matches)) && comparisons.filter(c => c.relation === 'mismatch').every(c => !c.matches);
}
