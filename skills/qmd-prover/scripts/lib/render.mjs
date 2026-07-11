import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson, atomicWrite, AUX } from './files.mjs';
import { compileProject } from './compiler.mjs';
import { readLocatedBlock } from './source.mjs';

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function slug(id) { return encodeURIComponent(id); }

function semanticHtml(value, previews) {
  const parts = String(value ?? '').split(/(@(?:def|lem|thm|prp|cor)-[A-Za-z0-9._:-]+)/g);
  return parts.map((part) => {
    if (!part.startsWith('@')) return escapeHtml(part);
    const id = part.slice(1);
    const preview = previews.get(id);
    return `<a href="${slug(id)}.html"${preview ? ` title="${escapeHtml(`${preview.title}: ${preview.statement}`)}"` : ''}>${escapeHtml(part)}</a>`;
  }).join('');
}

function page(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
:root{font-family:ui-sans-serif,system-ui,sans-serif;color:#172033;background:#f7f8fb}body{max-width:68rem;margin:0 auto;padding:2rem}a{color:#3157a4}nav{margin-bottom:2rem}.card{background:white;border:1px solid #dfe3ec;border-radius:.65rem;padding:1rem;margin:.75rem 0}.status{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;padding:.2rem .45rem;border-radius:1rem;background:#e8ecf4}.verified{background:#d8f3e5}.rejected,.revoked{background:#ffe1df}.open{background:#fff1c7}pre{white-space:pre-wrap}.dependency{margin-left:1.5rem}.meta{color:#5a6477;font-size:.9rem}svg{background:#fff;border:1px solid #dfe3ec;max-width:100%;height:auto}</style></head>
<body><nav><a href="${title === 'qmd-prover' ? '#' : '../index.html'}">qmd-prover</a></nav>${body}</body></html>\n`;
}

function graphSvg(graph, linkPrefix = 'theorems/') {
  const width = 900;
  const row = 78;
  const height = Math.max(120, graph.nodes.length * row + 40);
  const positions = new Map(graph.nodes.map((node, index) => [node.id, { x: 40 + (index % 2) * 450, y: 30 + index * row }]));
  const edges = graph.edges.map((edge) => {
    const from = positions.get(edge.from); const to = positions.get(edge.to);
    if (!from || !to) return '';
    return `<line x1="${from.x + 180}" y1="${from.y + 24}" x2="${to.x + 180}" y2="${to.y + 24}" stroke="#9aa5b8" stroke-width="1.5"/>`;
  }).join('');
  const nodes = graph.nodes.map((node) => {
    const position = positions.get(node.id);
    const title = `${node.id}: ${node.title} (${node.status})`;
    return `<a href="${escapeHtml(linkPrefix + slug(node.id) + '.html')}" target="_top"><g><title>${escapeHtml(title)}</title><rect x="${position.x}" y="${position.y}" width="360" height="48" rx="8" fill="#fff" stroke="#64748b"/><text x="${position.x + 12}" y="${position.y + 20}" font-family="sans-serif" font-size="13">${escapeHtml(node.id)}</text><text x="${position.x + 12}" y="${position.y + 38}" font-family="sans-serif" font-size="11" fill="#586174">${escapeHtml(node.status)}</text></g></a>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Theorem dependency graph">${edges}${nodes}</svg>\n`;
}

export async function renderProject(root = process.cwd(), options = {}) {
  root = path.resolve(root);
  const compilation = await compileProject(root, options);
  const site = path.join(root, AUX, 'site');
  const theoremDir = path.join(site, 'theorems');
  const graphDir = path.join(root, AUX, 'graphs');
  const reportDir = path.join(root, AUX, 'reports');
  await Promise.all([mkdir(theoremDir, { recursive: true }), mkdir(graphDir, { recursive: true }), mkdir(reportDir, { recursive: true })]);
  const cards = [];
  const previews = new Map();
  for (const result of compilation.manifest.results) {
    const located = await readLocatedBlock(path.join(root, result.file), result.id);
    previews.set(result.id, { title: result.title || result.id, statement: located?.statement?.text ?? '' });
  }
  for (const result of compilation.manifest.results) {
    const located = await readLocatedBlock(path.join(root, result.file), result.id);
    const dependencies = result.uses.map((id) => `<li><a href="${slug(id)}.html">@${escapeHtml(id)}</a></li>`).join('');
    const theoremPage = page(result.title || result.id, `<article class="card"><h1>${escapeHtml(result.title || result.id)}</h1>
<p><span class="status ${escapeHtml(result.status)}">${escapeHtml(result.status)}</span> <span class="meta">${escapeHtml(result.kind)} · ${escapeHtml(result.file)}:${result.line ?? '?'}</span></p>
<h2>Statement</h2><pre>${semanticHtml(located?.statement?.text ?? '', previews)}</pre><h2>Uses</h2><ul>${dependencies || '<li>None</li>'}</ul>
<h2>Proof</h2><pre>${semanticHtml(located?.proof?.text || 'No proof submitted.', previews)}</pre></article>`);
    await atomicWrite(path.join(theoremDir, `${slug(result.id)}.html`), theoremPage);
    cards.push(`<div class="card"><h2><a href="theorems/${slug(result.id)}.html">${escapeHtml(result.title || result.id)}</a></h2><p><code>@${escapeHtml(result.id)}</code> <span class="status ${escapeHtml(result.status)}">${escapeHtml(result.status)}</span></p><p class="meta">${escapeHtml(result.file)}:${result.line ?? '?'}</p></div>`);
  }
  const svg = graphSvg(compilation.graph);
  await Promise.all([
    atomicWrite(path.join(site, 'graph.svg'), svg),
    atomicWrite(path.join(graphDir, 'dependencies.svg'), graphSvg(compilation.graph, '../site/theorems/')),
    atomicJson(path.join(reportDir, 'status.json'), { summary: compilation.summary, diagnostics: compilation.diagnostics }),
    atomicWrite(path.join(reportDir, 'status.md'), `# qmd-prover status\n\n${compilation.manifest.results.map((result) => `- @${result.id}: **${result.status}** (${result.file}:${result.line ?? '?'})`).join('\n')}\n`)
  ]);
  const index = page('qmd-prover', `<h1>qmd-prover</h1><p>${compilation.summary.results} semantic results in ${compilation.summary.files} files. ${compilation.summary.errors} structural errors.</p>${cards.join('')}<h2>Dependency graph</h2><object data="graph.svg" type="image/svg+xml" width="900"></object>`);
  await atomicWrite(path.join(site, 'index.html'), index);
  return { status: compilation.ok ? 'rendered' : 'rendered-with-errors', output: path.relative(root, site), graph: path.relative(root, path.join(graphDir, 'dependencies.svg')), report: path.relative(root, path.join(reportDir, 'status.json')), summary: compilation.summary };
}

export { escapeHtml, graphSvg };
