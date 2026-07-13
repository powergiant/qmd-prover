import { stat } from 'node:fs/promises';
import path from 'node:path';
import { compileProject } from '../semantic/compiler.js';
import { AUX, cleanId, readJson, relativePosix } from '../infrastructure/files.js';
import { inspectCanonicalScope } from '../verification/canonical.js';
import { readLocatedBlock } from '../semantic/source.js';
import { indexBy } from '../shared/core.js';
import { adjacency, allSimplePaths, blockerPaths, boundedInteger, frontier, requireNode, shortestPath, subgraph, traverse } from './graph.js';
import { deriveGraphFindings, staleFactIds } from './findings.js';
import type { ProjectSnapshot } from './findings.js';
import type {
  AiCheck, Compilation, Diagnostic, GraphNode, RuntimeOptions, SemanticResult,
  InspectProjectResult, InspectFactResult, InspectPathResult, DependencyAnalysisResult
} from '../shared/types.js';


function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return indexBy(items, (item) => item.id);
}



interface FactCheck {
  id: string;
  status: string;
  programmatic: { status: 'pass' | 'fail'; references: NonNullable<SemanticResult['reference_checks']> };
  ai: AiCheck;
  diagnostics: Diagnostic[];
}



function aiCheck(result: SemanticResult, inspected: AiCheck | null = null): AiCheck {
  if (inspected) return inspected;
  if (result.status === 'verified') return { status: 'pass', source: 'verification-record' };
  if (result.status === 'rejected') return { status: 'fail', source: 'verification-record' };
  return { status: 'not-run', reason: 'The fact was not eligible for independent verification.' };
}

function factCheck(result: SemanticResult, diagnostics: Diagnostic[], inspected: AiCheck | null = null): FactCheck {
  const relevant = diagnostics.filter((item) => item.id ? item.id === result.id : item.file === result.file);
  const referenceFailure = (result.reference_checks ?? []).some((check) => (
    check.existence === 'fail' || check.scope === 'fail' || check.status === 'fail' || check.cycle === 'fail'
  ));
  const programmatic = referenceFailure || relevant.some((item) => item.severity === 'error') ? 'fail' : 'pass';
  return {
    id: result.id,
    status: result.status,
    programmatic: { status: programmatic, references: result.reference_checks ?? [] },
    ai: aiCheck(result, inspected),
    diagnostics: relevant
  };
}

function resultSummary(results: SemanticResult[]): { facts: number; kinds: Record<string, number>; statuses: Record<string, number> } {
  const kindCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();
  for (const result of results) {
    kindCounts.set(result.kind, (kindCounts.get(result.kind) ?? 0) + 1);
    statusCounts.set(result.status, (statusCounts.get(result.status) ?? 0) + 1);
  }
  const kinds = Object.fromEntries([...kindCounts].sort(([left], [right]) => left.localeCompare(right)));
  const statuses = Object.fromEntries([...statusCounts].sort(([left], [right]) => left.localeCompare(right)));
  return { facts: results.length, kinds, statuses };
}



export async function inspectProject(root = process.cwd(), options: RuntimeOptions = {}): Promise<InspectProjectResult> {
  const inspected = await inspectCanonicalScope(root, (compilation) => compilation.manifest.results, options);
  const { compilation } = inspected;
  const diagnostics = [...compilation.diagnostics, ...inspected.diagnostics];
  const facts = compilation.manifest.results.map((result) => factCheck(result, diagnostics, inspected.aiChecks.get(result.id)));
  const goals = compilation.manifest.results.filter((result) => result.origin === 'user' || result.classes?.includes('goal')).map((result) => result.id);
  return {
    schema_version: 2,
    operation: 'inspect-project',
    ok: compilation.complete && facts.every((fact) => fact.programmatic.status === 'pass' && fact.ai.status === 'pass'),
    snapshot_id: compilation.graph.snapshot_id,
    snapshot_published: compilation.complete && options.write !== false,
    scope: { type: 'project', path: '.' },
    summary: { ...compilation.summary, ...resultSummary(compilation.manifest.results), errors: diagnostics.filter((item) => item.severity === 'error').length },
    facts,
    graph: compilation.graph,
    staleness: inspected.staleness,
    verification: inspected.verification,
    blockers: blockerPaths(compilation.graph, goals.length ? goals : compilation.manifest.results.map((result) => result.id)),
    findings: deriveGraphFindings(compilation),
    diagnostics
  };
}

export async function inspectFact(root: string, requested: string, options: RuntimeOptions = {}): Promise<InspectFactResult> {
  const id = cleanId(requested);
  const inspected = await inspectCanonicalScope(root, (compilation) => compilation.manifest.results.filter((result) => result.id === id), options);
  const { compilation } = inspected;
  const matches = compilation.manifest.results.filter((result) => result.id === id);
  if (matches.length === 0) throw new Error(`Unknown fact: @${id}`);
  if (matches.length > 1) throw new Error(`Ambiguous fact: @${id} is defined ${matches.length} times`);
  const target = matches[0];
  const dependencyIds = traverse(compilation.graph, id);
  const graphNodes = byId(compilation.graph.nodes);
  const directDependencies = adjacency(compilation.graph).get(id) ?? [];
  const reverse = adjacency(compilation.graph, true).get(id) ?? [];
  const selected = new Set([id, ...dependencyIds, ...reverse]);
  const located = await readLocatedBlock(path.join(path.resolve(root), target.file), id);
  const diagnostics = [
    ...compilation.diagnostics.filter((item) => item.id === id || item.file === target.file),
    ...inspected.diagnostics
  ];
  const check = factCheck(target, diagnostics, inspected.aiChecks.get(id));
  return {
    schema_version: 2,
    operation: 'inspect-fact',
    ok: check.programmatic.status === 'pass' && check.ai.status === 'pass',
    snapshot_id: compilation.graph.snapshot_id,
    scope: { type: 'fact', id },
    fact: target,
    check,
    source: { statement: located?.statement?.text ?? '', proof: located?.proof?.text ?? '' },
    graph: subgraph(compilation.graph, selected),
    direct_dependencies: directDependencies.map((dependency) => graphNodes.get(dependency)),
    transitive_dependencies: [...dependencyIds].sort().map((dependency) => graphNodes.get(dependency)),
    direct_reverse_dependencies: reverse,
    blockers: blockerPaths(compilation.graph, [id]),
    staleness: inspected.staleness,
    verification: inspected.verification,
    diagnostics
  };
}

function isWithinPath(file: string, selected: string, isDirectory: boolean): boolean {
  return isDirectory ? file === selected || file.startsWith(`${selected}/`) : file === selected;
}

export async function inspectPath(root: string, requestedPath: string, options: RuntimeOptions = {}): Promise<InspectPathResult> {
  root = path.resolve(root);
  const absolute = path.resolve(root, requestedPath);
  const relative = relativePosix(root, absolute);
  if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('Inspection path must stay inside the project');
  const info = await stat(absolute);
  if (!info.isDirectory() && !(info.isFile() && absolute.endsWith('.qmd'))) throw new Error('Inspection path must be a QMD file or directory');
  const select = (compilation: Compilation) => compilation.manifest.results.filter((result) => isWithinPath(result.file, relative, info.isDirectory()));
  const inspected = await inspectCanonicalScope(root, select, options);
  const { compilation } = inspected;
  const selectedFiles = new Set<string>(compilation.manifest.files.filter((file) => isWithinPath(file.path, relative, info.isDirectory())).map((file) => file.path));
  const selectedResults = compilation.manifest.results.filter((result) => selectedFiles.has(result.file));
  const selectedIds = new Set<string>(selectedResults.map((result) => result.id));
  const contextIds = new Set<string>(selectedIds);
  for (const id of selectedIds) for (const dependency of traverse(compilation.graph, id)) contextIds.add(dependency);
  const diagnostics = [
    ...compilation.diagnostics.filter((item) => (item.id !== undefined && selectedIds.has(item.id)) || (item.file !== undefined && isWithinPath(item.file, relative, info.isDirectory()))),
    ...inspected.diagnostics
  ];
  const graph = subgraph(compilation.graph, contextIds);
  graph.nodes = graph.nodes.map((node) => ({ ...node, scope: selectedIds.has(node.id) ? 'selected' : 'external' }));
  const facts = selectedResults.map((result) => factCheck(result, diagnostics, inspected.aiChecks.get(result.id)));
  return {
    schema_version: 2,
    operation: 'inspect-path',
    ok: facts.every((fact) => fact.programmatic.status === 'pass' && fact.ai.status === 'pass') && diagnostics.every((item) => item.severity !== 'error'),
    snapshot_id: compilation.graph.snapshot_id,
    scope: { type: info.isDirectory() ? 'folder' : 'file', path: relative },
    summary: { files: selectedFiles.size, ...resultSummary(selectedResults), errors: diagnostics.filter((item) => item.severity === 'error').length },
    facts,
    graph,
    blockers: blockerPaths(compilation.graph, selectedResults.map((result) => result.id)),
    findings: deriveGraphFindings(compilation, { selectedIds, selectedFiles }),
    staleness: inspected.staleness,
    verification: inspected.verification,
    diagnostics
  };
}

async function latestSnapshot(root: string, options: RuntimeOptions = {}): Promise<ProjectSnapshot> {
  root = path.resolve(root);
  let pointer = await readJson<{ file: string; snapshot_id: string } | null>(path.join(root, AUX, 'graphs', 'latest.json'), null);
  if (!pointer) {
    const compilation = await compileProject(root, options);
    if (!compilation.complete) throw new Error('No complete dependency snapshot is available; repair parse failures and inspect again');
    pointer = await readJson<{ file: string; snapshot_id: string }>(path.join(root, AUX, 'graphs', 'latest.json'));
  }
  if (!pointer) throw new Error('The latest dependency snapshot pointer is missing');
  const graphsRoot = path.join(root, AUX, 'graphs');
  const snapshotFile = typeof pointer.file === 'string' ? path.resolve(root, pointer.file) : '';
  if (!snapshotFile.startsWith(`${graphsRoot}${path.sep}`)) throw new Error('The latest dependency snapshot pointer is corrupt');
  const snapshot = await readJson<ProjectSnapshot>(snapshotFile);
  if (snapshot.snapshot_id !== pointer.snapshot_id || snapshot.graph.snapshot_id !== pointer.snapshot_id) throw new Error('The latest dependency snapshot pointer is corrupt');
  return snapshot;
}


export async function analyzeDependencies(root: string, operation: string, args: string[] = [], options: RuntimeOptions = {}): Promise<DependencyAnalysisResult> {
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
    result = {
      target: node,
      direct: directIds.map((id) => nodes.get(id)).filter((item): item is GraphNode => item !== undefined),
      transitive: transitiveIds.map((id) => nodes.get(id)).filter((item): item is GraphNode => item !== undefined)
    };
  } else if (operation === 'path') {
    requireNode(graph, requested);
    requireNode(graph, args[1]);
    result = { from: cleanId(requested), to: cleanId(args[1]), path: shortestPath(graph, cleanId(requested), cleanId(args[1])) };
  } else if (operation === 'alternative-paths') {
    requireNode(graph, requested);
    requireNode(graph, args[1]);
    const from = cleanId(requested);
    const to = cleanId(args[1]);
    const paths = allSimplePaths(graph, from, to, options);
    result = { from, to, ...paths, alternatives: paths.paths.slice(1) };
  } else if (operation === 'cycles') {
    result = { cycles: graph.cycles ?? [] };
  } else if (operation === 'impact') {
    const node = requireNode(graph, requested);
    const nodes = byId(graph.nodes);
    result = {
      target: node,
      affected: [...traverse(graph, node.id, true)].sort().map((id) => nodes.get(id)).filter((item): item is GraphNode => item?.status === 'verified')
    };
  } else if (operation === 'frontier') {
    result = { target: requireNode(graph, requested), frontier: frontier(graph, requested) };
  } else if (['findings', 'unused-imports', 'unused-exports', 'isolated', 'unreachable', 'ready', 'ready-for-ai', 'reused'].includes(operation)) {
    const findings = deriveGraphFindings(snapshot);
    if (operation === 'findings') result = { findings };
    else if (operation === 'unused-imports') result = { unused_imports: findings.unused_imports };
    else if (operation === 'unused-exports') result = { unused_exports: findings.unused_exports };
    else if (operation === 'isolated') result = { definition: findings.definitions.isolated, facts: findings.isolated_facts };
    else if (operation === 'unreachable') result = { definition: findings.definitions.unreachable, ...findings.unreachable };
    else if (operation === 'ready' || operation === 'ready-for-ai') result = { definition: findings.definitions.candidate_ready_for_ai, candidates: findings.candidate_ready_for_ai };
    else {
      const limit = boundedInteger(options.limit, 20, { name: 'limit', min: 1, max: 1000 });
      result = { definition: findings.definitions.heavily_reused, facts: findings.heavily_reused.slice(0, limit), total: findings.heavily_reused.length, limit };
    }
  } else if (operation === 'search') {
    const query = String(requested ?? '').toLowerCase();
    const manifestById = byId(snapshot.manifest.results);
    const staleIds = staleFactIds(snapshot);
    let matches = graph.nodes.filter((node) => {
      const fact = manifestById.get(node.id);
      const haystack = [node.id, node.title, node.file, fact?.statement_text, fact?.proof_text].filter(Boolean).join('\n').toLowerCase();
      return haystack.includes(query)
        && (!options.kind || node.kind === options.kind)
        && (!options.status || node.status === options.status)
        && (!options.origin || node.origin === options.origin)
        && (!options.path || node.file === options.path || node.file?.startsWith(`${options.path}/`));
    });
    const relatedIds = (selected: string, reverse = false): Set<string> => {
      const target = requireNode(graph, selected);
      return options.direct === true
        ? new Set(adjacency(graph, reverse).get(target.id) ?? [])
        : traverse(graph, target.id, reverse);
    };
    if (options.relatedTo) {
      const related = relatedIds(options.relatedTo, options.reverse === true);
      matches = matches.filter((node) => related.has(node.id));
    }
    if (options.usedBy) {
      const related = relatedIds(options.usedBy);
      matches = matches.filter((node) => related.has(node.id));
    }
    if (options.dependsOn) {
      const related = relatedIds(options.dependsOn, true);
      matches = matches.filter((node) => related.has(node.id));
    }
    if (options.affectedBy) {
      const related = relatedIds(options.affectedBy, true);
      matches = matches.filter((node) => related.has(node.id));
    }
    if (options.staleAffectedBy) {
      const related = relatedIds(options.staleAffectedBy, true);
      matches = matches.filter((node) => related.has(node.id) && staleIds.has(node.id));
    }
    if (options.frontierOf) {
      const ids = new Set(frontier(graph, options.frontierOf).map((item) => item.fact.id));
      matches = matches.filter((node) => ids.has(node.id));
    }
    if (options.cycleParticipant === true) {
      const ids = new Set((graph.cycles ?? []).flatMap((cycle) => cycle.slice(0, -1)));
      matches = matches.filter((node) => ids.has(node.id));
    }
    result = {
      query: requested ?? '',
      filters: {
        ...(options.kind ? { kind: options.kind } : {}),
        ...(options.status ? { status: options.status } : {}),
        ...(options.origin ? { origin: options.origin } : {}),
        ...(options.path ? { path: options.path } : {}),
        ...(options.relatedTo ? { related_to: cleanId(options.relatedTo), reverse: options.reverse === true } : {}),
        ...(options.usedBy ? { used_by: cleanId(options.usedBy) } : {}),
        ...(options.dependsOn ? { depends_on: cleanId(options.dependsOn) } : {}),
        ...(options.affectedBy ? { affected_by: cleanId(options.affectedBy) } : {}),
        ...(options.staleAffectedBy ? { stale_affected_by: cleanId(options.staleAffectedBy) } : {}),
        ...(options.frontierOf ? { frontier_of: cleanId(options.frontierOf) } : {}),
        ...(options.direct === true ? { direct: true } : {}),
        ...(options.cycleParticipant === true ? { cycle_participant: true } : {})
      },
      matches: matches.sort((left, right) => left.id.localeCompare(right.id))
    };
  } else {
    throw new Error(`Unknown dependency operation: ${operation}`);
  }
  return { schema_version: 2, operation: `dependency-${operation}`, snapshot_id: snapshot.snapshot_id, ...result };
}
