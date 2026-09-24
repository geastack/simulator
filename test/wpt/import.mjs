// SPDX-License-Identifier: Apache-2.0
// Explicit maintenance operation; normal test runs are completely offline.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parse } from 'parse5';
import valueParser from 'postcss-value-parser';

const root = fileURLToPath(new URL('./', import.meta.url));
// Keep the reviewed selection separate from fetching and dependency discovery.
// Adding a test never depends on whether this renderer passes it.
const { revision, tests, expectedCount = 100 } = JSON.parse(await fs.readFile(path.join(root, 'selection.json'), 'utf8'));
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Selection must pin a full upstream commit');
if (tests.length !== expectedCount || new Set(tests).size !== tests.length ||
    tests.some(name => !name.startsWith('css/') || !name.endsWith('.html'))) {
  throw new Error(`Expected ${expectedCount} distinct CSS HTML test paths`);
}
const files = {};
const missingResources = {};
const requiredDocuments = new Set(['LICENSE.md', ...tests]);
const base = `https://raw.githubusercontent.com/web-platform-tests/wpt/${revision}/`;
const previous = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8').catch(() => '{}'));
const pending = [];
const enqueued = new Set();
function enqueue(name) {
  if (enqueued.has(name)) return;
  if (name.startsWith('/') || name.split('/').includes('..')) throw new Error(`Invalid upstream path: ${name}`);
  enqueued.add(name);
  pending.push(name);
}
function dependency(from, href, required = false) {
  if (!href || href.startsWith('#') || /^(data|about):/i.test(href)) return;
  const url = new URL(href, `https://wpt.invalid/${from}`);
  if (url.origin !== 'https://wpt.invalid') throw new Error(`External dependency ${href} in ${from}`);
  if (required) requiredDocuments.add(url.pathname.slice(1));
  enqueue(url.pathname.slice(1));
}
function cssDependencies(source, from) {
  valueParser(source).walk(node => {
    if (node.type === 'function' && node.value.toLowerCase() === 'url') {
      const value = node.nodes.length === 1 && node.nodes[0].type === 'string'
        ? node.nodes[0].value : valueParser.stringify(node.nodes).trim();
      dependency(from, value);
    }
  });
  for (const match of source.matchAll(/@import\s+["']([^"']+)["']/g)) dependency(from, match[1]);
}
async function download(name) {
  let bytes;
  if (previous.revision === revision && previous.files?.[name]) {
    bytes = await fs.readFile(path.join(root, 'upstream', name));
    if (createHash('sha256').update(bytes).digest('hex') !== previous.files[name]) throw new Error(`Modified pinned fixture: ${name}`);
  } else {
    const response = await fetch(base + name, { signal: AbortSignal.timeout(30000) });
    if (response.status === 404 && !requiredDocuments.has(name)) {
      // Preserve missing-image/font behavior instead of inventing a fixture.
      // Documents and stylesheets remain required, verified dependencies.
      missingResources[name] = { status: 404 };
      return;
    }
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await fs.mkdir(path.dirname(path.join(root, 'upstream', name)), { recursive: true });
    await fs.writeFile(path.join(root, 'upstream', name), bytes);
  }
  files[name] = createHash('sha256').update(bytes).digest('hex');
  if (name.endsWith('.css')) cssDependencies(bytes.toString(), name);
  if (!/\.(html|xht|xhtml)$/.test(name)) return;
  function walk(n) {
    const a = Object.fromEntries((n.attrs || []).map(a => [a.name, a.value]));
    if (n.tagName === 'link') {
      if (/^(match|mismatch|stylesheet)$/.test(a.rel)) dependency(name, a.href, true);
    }
    if (a.src) dependency(name, a.src);
    if (a.style) cssDependencies(a.style, name);
    if (n.tagName === 'style') cssDependencies((n.childNodes || []).map(n => n.value || '').join(''), name);
    for (const c of n.childNodes || []) walk(c);
  }
  walk(parse(bytes.toString()));
}
for (const name of ['LICENSE.md', ...tests]) enqueue(name);
for (let cursor = 0; cursor < pending.length;) {
  // Newly discovered dependencies join the same queue; cycles are deduplicated.
  const batch = pending.slice(cursor, cursor + 8);
  await Promise.all(batch.map(download));
  if (cursor % 80 === 0) console.log(`Imported ${Object.keys(files).length}/${pending.length} upstream files`);
  cursor += batch.length;
}
const sortedFiles = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
for (const name of requiredDocuments) if (!files[name]) throw new Error(`Missing required document: ${name}`);
await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ revision, viewport: { width: 800, height: 600, dpr: 1 }, tests, files: sortedFiles, missingResources }, null, 2) + '\n');
console.log(`Pinned ${tests.length} tests and ${Object.keys(files).length} upstream files`);
