import { stat } from 'node:fs/promises';
import path from 'node:path';
import { compileProject } from './compiler.mjs';
import { AUX, cleanId, readJson, relativePosix } from './files.mjs';
import { readLocatedBlock } from './source.mjs';

const unusableStatuses = new Set(['open', 'candidate', 'workspace-open', 'workspace-candidate', 'rejected', 'revoked', 'stale', 'missing']);

function byId(items) {
  return new Map(items.map((item) => [item.id, item]));
}

function adjacency(graph, reverse = false) {
  const output = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    const from = reverse ? edge.to : edge.from;
    const to = reverse ? edge.from : edge.to;
    if (!output.has(from)) output.set(from, []);
    output.get(from).push(to);
  }
  for (const values of output.values()) values.sort();
  return output;
}

function traverse(graph, start, reverse = false) {
  const links = adjacency(graph, reverse);
  const seen = new Set();
  const queue = [...(links.get(start) ?? [])];
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...(links.get(current) ?? []));
  }
  return seen;
}

function shortestPath(graph, start, goal, reverse = false) {
  if (start === goal) return [start];
  const links = adjacency(graph, reverse);
  const queue = [[start]];
  const seen = new Set([start]);
  while (queue.length) {
    const current = queue.shift();
    for (const next of links.get(current.at(-1)) ?? []) {
      if (seen.has(next)) continue;
      const candidate = [...current, next];
      if (next === goal) return candidate;
      seen.add(next);
      queue.push(candidate);
    }
  }
  return null;
}

function subgraph(graph, ids) {
  const selected = new Set(ids);
  return {
    schema_version: graph.schema_version,
    snapshot_id: graph.snapshot_id,
    nodes: graph.nodes.filter((node) => selected.has(node.id)),
    edges: graph.edges.filter((edge) => selected.has(edge.from) && selected.has(edge.to)),
    cycles: (graph.cycles ?? []).filter((cycle) => cycle.every((id) => selected.has(id)))
  };
}

function aiCheck(result) {
  if (result.status === 'verified') return { status: 'pass', source: 'verification-record' };
  if (result.status === 'rejected') return { status: 'fail', source: 'verification-record' };
  return { status: 'not-run', reason: 'Programmatic inspection does not independently accept unverified mathematics; submit the fact through the protected verification path.' };
}

function factCheck(result, diagnostics) {
  const relevant = diagnostics.filter((item) => item.id === result.id);
  const referenceFailure = (result.reference_checks ?? []).some((check) => ['existence', 'scope', 'status', 'cycle'].some((name) => check[name] === 'fail'));
  const programmatic = referenceFailure || relevant.some((item) => item.severity === 'error') ? 'fail' : 'pass';
  return {
    id: result.id,
    status: result.status,
    programmatic: { status: programmatic, references: result.reference_checks ?? [] },
    ai: aiCheck(result),
    diagnostics: relevant
  };
}

function resultSummary(results) {
  const kinds = {};
  const statuses = {};
  for (const result of results) {
    kinds[result.kind] = (kinds[result.kind] ?? 0) + 1;
    statuses[result.status] = (statuses[result.status] ?? 0) + 1;
  }
  return { facts: results.length, kinds, statuses };
}

export async function inspectProject(root = process.cwd(), options = {}) {
  const compilation = await compileProject(root, options);
  const facts = compilation.manifest.results.map((result) => factCheck(result, compilation.diagnostics));
  return {
    schema_version: 2,
    operation: 'inspect-project',
    ok: compilation.ok,
    snapshot_id: compilation.graph.snapshot_id,
    snapshot_published: compilation.complete && options.write !== false,
    scope: { type: 'project', path: '.' },
    summary: { ...compilation.summary, ...resultSummary(compilation.manifest.results) },
    facts,
    graph: compilation.graph,
    diagnostics: compilation.diagnostics
  };
}

export async function inspectFact(root, requested, options = {}) {
  const id = cleanId(requested);
  const compilation = await compileProject(root, options);
  const matches = compilation.manifest.results.filter((result) => result.id === id);
  if (matches.length === 0) throw new Error(`Unknown fact: @${id}`);
  if (matches.length > 1) throw new Error(`Ambiguous fact: @${id} is defined ${matches.length} times`);
  const target = matches[0];
  const dependencyIds = traverse(compilation.graph, id);
  const reverse = adjacency(compilation.graph, true).get(id) ?? [];
  const selected = new Set([id, ...dependencyIds, ...reverse]);
  const located = await readLocatedBlock(path.join(path.resolve(root), target.file), id);
  const check = factCheck(target, compilation.diagnostics);
  return {
    schema_version: 2,
    operation: 'inspect-fact',
    ok: check.programmatic.status === 'pass' && check.ai.status !== 'fail',
    snapshot_id: compilation.graph.snapshot_id,
    scope: { type: 'fact', id },
    fact: target,
    check,
    source: { statement: located?.statement?.text ?? '', proof: located?.proof?.text ?? '' },
    graph: subgraph(compilation.graph, selected),
    direct_reverse_dependencies: reverse,
    diagnostics: check.diagnostics
  };
}

function isWithinPath(file, selected, isDirectory) {
  return isDirectory ? file === selected || file.startsWith(`${selected}/`) : file === selected;
}

export async function inspectPath(root, requestedPath, options = {}) {
  root = path.resolve(root);
  const absolute = path.resolve(root, requestedPath);
  const relative = relativePosix(root, absolute);
  if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('Inspection path must stay inside the project');
  const info = await stat(absolute);
  if (!info.isDirectory() && !(info.isFile() && absolute.endsWith('.qmd'))) throw new Error('Inspection path must be a QMD file or directory');
  const compilation = await compileProject(root, options);
  const selectedFiles = new Set(compilation.manifest.files.filter((file) => isWithinPath(file.path, relative, info.isDirectory())).map((file) => file.path));
  const selectedResults = compilation.manifest.results.filter((result) => selectedFiles.has(result.file));
  const selectedIds = new Set(selectedResults.map((result) => result.id));
  const contextIds = new Set(selectedIds);
  for (const id of selectedIds) for (const dependency of traverse(compilation.graph, id)) contextIds.add(dependency);
  const diagnostics = compilation.diagnostics.filter((item) => selectedIds.has(item.id) || (item.file && isWithinPath(item.file, relative, info.isDirectory())));
  const graph = subgraph(compilation.graph, contextIds);
  graph.nodes = graph.nodes.map((node) => ({ ...node, scope: selectedIds.has(node.id) ? 'selected' : 'external' }));
  const facts = selectedResults.map((result) => factCheck(result, diagnostics));
  return {
    schema_version: 2,
    operation: 'inspect-path',
    ok: facts.every((fact) => fact.programmatic.status === 'pass') && diagnostics.every((item) => item.severity !== 'error'),
    snapshot_id: compilation.graph.snapshot_id,
    scope: { type: info.isDirectory() ? 'folder' : 'file', path: relative },
    summary: { files: selectedFiles.size, ...resultSummary(selectedResults) },
    facts,
    graph,
    diagnostics
  };
}

async function latestSnapshot(root, options = {}) {
  root = path.resolve(root);
  let pointer = await readJson(path.join(root, AUX, 'graphs', 'latest.json'), null);
  if (!pointer) {
    const compilation = await compileProject(root, options);
    if (!compilation.complete) throw new Error('No complete dependency snapshot is available; repair parse failures and inspect again');
    pointer = await readJson(path.join(root, AUX, 'graphs', 'latest.json'));
  }
  const graphsRoot = path.join(root, AUX, 'graphs');
  const snapshotFile = typeof pointer.file === 'string' ? path.resolve(root, pointer.file) : '';
  if (!snapshotFile.startsWith(`${graphsRoot}${path.sep}`)) throw new Error('The latest dependency snapshot pointer is corrupt');
  const snapshot = await readJson(snapshotFile);
  if (snapshot.snapshot_id !== pointer.snapshot_id || snapshot.graph.snapshot_id !== pointer.snapshot_id) throw new Error('The latest dependency snapshot pointer is corrupt');
  return snapshot;
}

function requireNode(graph, requested) {
  const id = cleanId(requested);
  const node = graph.nodes.find((item) => item.id === id);
  if (!node) throw new Error(`Unknown fact in dependency snapshot: @${id}`);
  return node;
}

function frontier(graph, requested) {
  const target = requireNode(graph, requested);
  const closure = new Set([target.id, ...traverse(graph, target.id)]);
  const nodes = byId(graph.nodes);
  const unresolved = [...closure].filter((id) => unusableStatuses.has(nodes.get(id)?.status ?? 'missing'));
  const cycleSets = (graph.cycles ?? []).map((cycle) => new Set(cycle.slice(0, -1)));
  const sameCycle = (left, right) => cycleSets.some((cycle) => cycle.has(left) && cycle.has(right));
  const lowest = unresolved.filter((id) => ![...traverse(graph, id)].some((dependency) => dependency !== id && unresolved.includes(dependency) && !sameCycle(id, dependency)));
  return lowest.sort().map((id) => ({ fact: nodes.get(id) ?? { id, status: 'missing' }, path: shortestPath(graph, target.id, id) }));
}

export async function analyzeDependencies(root, operation, args = [], options = {}) {
  const snapshot = await latestSnapshot(root, options);
  const { graph } = snapshot;
  const requested = args[0];
  let result;
  if (operation === 'dependencies' || operation === 'reverse-dependencies') {
    const node = requireNode(graph, requested);
    const reverse = operation === 'reverse-dependencies';
    const directIds = adjacency(graph, reverse).get(node.id) ?? [];
    const transitiveIds = [...traverse(graph, node.id, reverse)].sort();
    const nodes = byId(graph.nodes);
    result = { target: node, direct: directIds.map((id) => nodes.get(id)), transitive: transitiveIds.map((id) => nodes.get(id)) };
  } else if (operation === 'path') {
    requireNode(graph, requested);
    requireNode(graph, args[1]);
    result = { from: cleanId(requested), to: cleanId(args[1]), path: shortestPath(graph, cleanId(requested), cleanId(args[1])) };
  } else if (operation === 'cycles') {
    result = { cycles: graph.cycles ?? [] };
  } else if (operation === 'impact') {
    const node = requireNode(graph, requested);
    const nodes = byId(graph.nodes);
    result = {
      target: node,
      affected: [...traverse(graph, node.id, true)].sort().map((id) => nodes.get(id)).filter((item) => item.status === 'verified')
    };
  } else if (operation === 'frontier') {
    result = { target: requireNode(graph, requested), frontier: frontier(graph, requested) };
  } else if (operation === 'search') {
    const query = String(requested ?? '').toLowerCase();
    const manifestById = byId(snapshot.manifest.results);
    let matches = graph.nodes.filter((node) => {
      const fact = manifestById.get(node.id);
      const haystack = [node.id, node.title, node.file, fact?.statement_text, fact?.proof_text].filter(Boolean).join('\n').toLowerCase();
      return haystack.includes(query)
        && (!options.kind || node.kind === options.kind)
        && (!options.status || node.status === options.status)
        && (!options.origin || node.origin === options.origin)
        && (!options.path || node.file === options.path || node.file?.startsWith(`${options.path}/`));
    });
    if (options.relatedTo) {
      const related = traverse(graph, cleanId(options.relatedTo), options.reverse === true);
      matches = matches.filter((node) => related.has(node.id));
    }
    if (options.frontierOf) {
      const ids = new Set(frontier(graph, options.frontierOf).map((item) => item.fact.id));
      matches = matches.filter((node) => ids.has(node.id));
    }
    result = { query: requested ?? '', matches: matches.sort((left, right) => left.id.localeCompare(right.id)) };
  } else {
    throw new Error(`Unknown dependency operation: ${operation}`);
  }
  return { schema_version: 2, operation: `dependency-${operation}`, snapshot_id: snapshot.snapshot_id, ...result };
}

export function printReport(result) {
  const lines = [`qmd-prover ${result.operation}`, `snapshot: ${result.snapshot_id ?? 'none'}`];
  if (typeof result.ok === 'boolean') lines.push(`status: ${result.ok ? 'ok' : 'failed'}`);
  if (result.scope) lines.push(`scope: ${result.scope.type} ${result.scope.id ? `@${result.scope.id}` : result.scope.path}`);
  if (result.summary) lines.push(`facts: ${result.summary.facts ?? result.summary.results ?? 0}`, `errors: ${result.summary.errors ?? result.diagnostics?.filter((item) => item.severity === 'error').length ?? 0}`);
  if (result.fact) lines.push(`fact: @${result.fact.id} [${result.fact.status}]`);
  if (result.frontier) {
    lines.push('frontier:');
    for (const item of result.frontier) lines.push(`  @${item.fact.id} [${item.fact.status}] via ${item.path.map((id) => `@${id}`).join(' -> ')}`);
  }
  if (result.changed) {
    lines.push('stale facts:');
    for (const item of result.changed) lines.push(`  @${item.id}: ${item.reasons.join(', ')}`);
    for (const item of result.invalidated ?? []) if (!result.changed.some((changed) => changed.id === item.id)) lines.push(`  @${item.id}: via ${item.path.map((id) => `@${id}`).join(' -> ')}`);
  }
  if (result.direct) lines.push(`direct: ${result.direct.map((item) => `@${item.id}`).join(', ') || 'none'}`);
  if (result.transitive) lines.push(`transitive: ${result.transitive.map((item) => `@${item.id}`).join(', ') || 'none'}`);
  if (Object.hasOwn(result, 'path')) lines.push(`path: ${result.path?.map((id) => `@${id}`).join(' -> ') ?? 'none'}`);
  if (result.cycles) {
    lines.push('cycles:');
    for (const cycle of result.cycles) lines.push(`  ${cycle.map((id) => `@${id}`).join(' -> ')}`);
  }
  if (result.affected) lines.push(`affected verified facts: ${result.affected.map((item) => `@${item.id}`).join(', ') || 'none'}`);
  if (result.matches) {
    lines.push('matches:');
    for (const item of result.matches) lines.push(`  @${item.id} [${item.kind}, ${item.status}] ${item.file ?? ''}`.trimEnd());
  }
  if (result.graph?.edges?.length) {
    lines.push('dependencies:');
    for (const edge of result.graph.edges) lines.push(`  @${edge.from} -> @${edge.to}`);
  }
  if (result.diagnostics?.length) {
    lines.push('diagnostics:');
    for (const item of result.diagnostics) lines.push(`  ${item.severity} ${item.code}: ${item.message}`);
  }
  return `${lines.join('\n')}\n`;
}
