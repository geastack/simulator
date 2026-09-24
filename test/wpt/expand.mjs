// SPDX-License-Identifier: Apache-2.0
// Explicit, networked corpus maintenance. Selection never runs the renderer.
import fs from 'node:fs/promises';
import { parse } from 'parse5';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./', import.meta.url));
const selection = JSON.parse(await fs.readFile(`${root}selection.json`, 'utf8'));
const add = Number(process.argv[2] || 1000);
if (!Number.isSafeInteger(add) || add <= 0) throw new Error('Expected a positive test count');
const target = selection.tests.length + add;
const selected = new Set(selection.tests);
async function get(url) {
  for (let attempt = 0; attempt < 3; ++attempt) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (response.ok) return response;
    if (response.status < 500 || attempt === 2) throw new Error(`${response.status}: ${url}`);
  }
}
const api = async ref => (await get(`https://api.github.com/repos/web-platform-tests/wpt/git/trees/${ref}`)).json();
const repository = await api(selection.revision);
const css = await api(repository.tree.find(t => t.path === 'css').sha);
const areas = ['css-flexbox', 'css-grid', 'css-backgrounds', 'css-overflow',
  'css-transforms', 'css-box', 'css-position', 'css-align', 'css-sizing', 'CSS2'];
const queues = [];
for (const area of areas) {
  const tree = await api(css.tree.find(t => t.path === area).sha + '?recursive=1');
  if (tree.truncated) throw new Error(`Incomplete upstream tree: ${area}`);
  const candidates = tree.tree.filter(t => t.type === 'blob' && t.path.endsWith('.html') &&
    !/(^|\/)(reference|references|support|resources|parsing|computed)(\/|$)|(?:-ref\.|-ref-|crash|print)/.test(t.path))
    .map(t => `css/${area}/${t.path}`).filter(n => !selected.has(n)).sort();
  queues.push({ area, candidates, cursor: 0, added: 0 });
}
const documents = new Map();
async function inspect(name) {
  if (!documents.has(name)) documents.set(name, (async () => {
    const source = await (await get(`https://raw.githubusercontent.com/web-platform-tests/wpt/${selection.revision}/${name}`)).text();
    const dom = parse(source);
    let staticDocument = dom.mode === 'no-quirks';
    const references = [];
    function walk(n) {
      const a = Object.fromEntries((n.attrs || []).map(a => [a.name, a.value]));
      if (['script', 'iframe', 'object', 'embed', 'base'].includes(n.tagName)) staticDocument = false;
      if (Object.keys(a).some(k => k.startsWith('on')) || /(?:^|\s)(?:reftest-wait|test-wait)(?:\s|$)/.test(a.class || '')) staticDocument = false;
      if (n.tagName === 'link' && /^(match|mismatch)$/.test(a.rel)) {
        const url = new URL(a.href, `https://wpt.invalid/${name}`);
        if (url.origin !== 'https://wpt.invalid' || url.search || url.hash || !url.pathname.endsWith('.html')) staticDocument = false;
        else references.push(url.pathname.slice(1));
      }
      for (const c of n.childNodes || []) walk(c);
    }
    walk(dom);
    return { staticDocument, references };
  })());
  return documents.get(name);
}
// Round-robin batches keep the corpus spread across CSS areas. Text, fonts,
// images, selectors and CSS properties are NOT filtered by engine support.
while (selected.size < target && queues.some(q => q.cursor < q.candidates.length)) {
  for (const q of queues) {
    if (selected.size >= target) break;
    const batch = q.candidates.slice(q.cursor, q.cursor + 8);
    q.cursor += batch.length;
    const eligible = await Promise.all(batch.map(async name => {
      const doc = await inspect(name);
      if (!doc.staticDocument || !doc.references.length) return null;
      for (const ref of doc.references) if (!(await inspect(ref)).staticDocument) return null;
      return name;
    }));
    for (const name of eligible.filter(Boolean)) {
      if (selected.size >= target) break;
      selected.add(name); q.added++;
    }
  }
  console.log(`Selected ${selected.size}/${target}; inspected ${documents.size} documents`);
}
if (selected.size !== target) throw new Error(`Only ${selected.size} static HTML reftests found for target ${target}`);
selection.tests = [...selected];
selection.expectedCount = target;
await fs.writeFile(`${root}selection.json`, JSON.stringify(selection, null, 2) + '\n');
console.log(JSON.stringify(queues.map(({ area, added }) => ({ area, added }))));
