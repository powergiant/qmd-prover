import path from 'node:path';
import { cleanId } from '../infrastructure/files.js';
import { indexBy } from '../shared/core.js';
import type {
  DependencyGraph, Diagnostic, GraphFindings, GraphNode, Manifest, RuntimeOptions, SemanticResult
} from '../shared/types.js';
import { adjacency, traverse } from './graph.js';

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return indexBy(items, (item) => item.id);
}

export interface ProjectSnapshot {
  snapshot_id?: string;
  manifest: Manifest;
  graph: DependencyGraph;
  diagnostics: Diagnostic[];
}

interface FindingSelection {
  node(node: GraphNode): boolean;
  file(file: string): boolean;
  result(result: SemanticResult): boolean;
}

function findingSelection(options: RuntimeOptions = {}): FindingSelection {
  const ids = options.selectedIds ? new Set([...options.selectedIds].map(cleanId)) : null;
  const files = options.selectedFiles ? new Set(options.selectedFiles) : null;
  return {
    node: (node) => (!ids || ids.has(node.id)) && (!files || !node.file || files.has(node.file)),
    file: (file) => !files || files.has(file),
    result: (result) => (!ids || ids.has(result.id)) && (!files || files.has(result.file))
  };
}

export function staleFactIds(snapshot: Pick<ProjectSnapshot, 'manifest' | 'diagnostics'>): Set<string> {
  const ids = new Set<string>();
  for (const result of snapshot.manifest?.results ?? []) {
    if (result.status === 'stale' || (result.stale_reasons?.length ?? 0) > 0) ids.add(result.id);
  }
  const evidenceCodes = new Set(['VERIFIED_RECORD_INVALID', 'VERIFIED_MARKER_MISSING', 'VERIFIED_DEPENDENCY_INVALID']);
  for (const item of snapshot.diagnostics ?? []) if (item.id && evidenceCodes.has(item.code)) ids.add(item.id);
  return ids;
}

function importTarget(importer: string, imported: string): string | null {
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(importer), imported));
  return target.startsWith('../') || path.posix.isAbsolute(target) ? null : target;
}

export function deriveGraphFindings(snapshot: ProjectSnapshot, options: RuntimeOptions = {}): GraphFindings {
  const graph = snapshot.graph;
  const manifest = snapshot.manifest ?? { files: [], results: [] };
  const diagnostics = snapshot.diagnostics ?? [];
  const nodes = byId(graph.nodes);
  const selection = findingSelection(options);
  const outgoing = adjacency(graph);
  const incoming = adjacency(graph, true);
  const usedImports = new Set<string>();
  for (const result of manifest.results ?? []) {
    for (const dependency of result.dependencies ?? []) usedImports.add(`${result.file}\0${dependency}`);
  }
  const resultAtFile = new Set<string>((manifest.results ?? []).map((result) => `${result.file}\0${result.id}`));
  const unusedImports = [];
  const importedExports = new Set<string>();
  for (const file of [...(manifest.files ?? [])].sort((left, right) => left.path.localeCompare(right.path))) {
    for (const declaration of file.imports ?? []) {
      const importedFile = importTarget(file.path, declaration.from);
      for (const id of [...(declaration.use ?? [])].sort()) {
        if (id === '*') {
          for (const result of manifest.results ?? []) if (result.file === importedFile && result.export) importedExports.add(result.id);
          continue;
        }
        if (importedFile && resultAtFile.has(`${importedFile}\0${id}`)) importedExports.add(id);
        if (selection.file(file.path) && importedFile && resultAtFile.has(`${importedFile}\0${id}`) && !usedImports.has(`${file.path}\0${id}`)) {
          unusedImports.push({ file: file.path, from: declaration.from, imported_file: importedFile, id });
        }
      }
    }
  }
  const unusedExports = (manifest.results ?? []).filter((result) => result.export && !importedExports.has(result.id) && selection.result(result))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((result) => ({ id: result.id, export: result.export, file: result.file, line: result.line }));
  const mathematicalNodes = graph.nodes.filter((node) => node.origin !== undefined && ['canonical', 'main-goal', 'workspace'].includes(node.origin));
  const isolatedFacts = mathematicalNodes.filter((node) => selection.node(node) && (outgoing.get(node.id)?.length ?? 0) === 0 && (incoming.get(node.id)?.length ?? 0) === 0)
    .sort((left, right) => left.id.localeCompare(right.id));

  const goalRoots = new Set<string>();
  if (manifest.target && nodes.has(manifest.target)) goalRoots.add(manifest.target);
  for (const result of manifest.results ?? []) {
    if (result.origin === 'user' || result.classes?.includes('goal') || result.id.startsWith('thm-main-')) goalRoots.add(result.id);
  }
  for (const node of graph.nodes) if (node.ownership === 'user' || node.id.startsWith('thm-main-')) goalRoots.add(node.id);
  const reachable = new Set<string>(goalRoots);
  for (const root of goalRoots) for (const id of traverse(graph, root)) reachable.add(id);
  const unreachableFacts = goalRoots.size === 0 ? [] : mathematicalNodes.filter((node) => selection.node(node) && !reachable.has(node.id))
    .sort((left, right) => left.id.localeCompare(right.id));

  const errorIds = new Set(diagnostics.filter((item) => item.severity === 'error' && item.id).map((item) => item.id));
  const errorFiles = new Set(diagnostics.filter((item) => item.severity === 'error' && !item.id && item.file).map((item) => item.file));
  const candidateStatuses = new Set(['candidate', 'workspace-candidate']);
  const candidateReadyForAi = mathematicalNodes.filter((node) => {
    if (!selection.node(node) || !candidateStatuses.has(node.status) || errorIds.has(node.id) || (node.file !== undefined && errorFiles.has(node.file))) return false;
    return graph.edges.filter((edge) => edge.from === node.id).every((edge) => (
      edge.checks?.existence === 'pass' && edge.checks.scope === 'pass'
      && edge.checks.status === 'pass' && edge.checks.cycle === 'pass'
    ));
  }).sort((left, right) => left.id.localeCompare(right.id));

  const invalidRoots = staleFactIds({ manifest, diagnostics });
  const invalidEvidenceDependents = mathematicalNodes.filter((node) => selection.node(node) && [...invalidRoots].some((root) => traverse(graph, root, true).has(node.id)))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((node) => ({
      fact: node,
      invalid_sources: [...invalidRoots].filter((root) => traverse(graph, root, true).has(node.id)).sort()
    }));

  const heavilyReused = mathematicalNodes.filter((node) => selection.node(node)).map((node) => {
    const direct = new Set(incoming.get(node.id) ?? []);
    const transitive = traverse(graph, node.id, true);
    transitive.delete(node.id);
    const verified = [...transitive].filter((id) => nodes.get(id)?.status === 'verified').length;
    return { fact: node, direct_dependents: direct.size, transitive_dependents: transitive.size, verified_dependents: verified };
  }).filter((item) => item.transitive_dependents > 0)
    .sort((left, right) => right.transitive_dependents - left.transitive_dependents
      || right.direct_dependents - left.direct_dependents
      || left.fact.id.localeCompare(right.fact.id));

  return {
    definitions: {
      isolated: 'A protected main goal or workspace fact with no incoming or outgoing semantic dependency edge.',
      unreachable: 'A protected main goal or workspace fact outside the dependency closure of every protected main goal (or the selected workspace target).',
      candidate_ready_for_ai: 'A candidate with no fact-level programmatic error and with every direct edge passing existence, scope, status, and cycle checks.',
      heavily_reused: 'A fact ranked by the number of distinct transitive reverse dependencies, then direct reverse dependencies.'
    },
    unused_imports: unusedImports.sort((left, right) => `${left.file}\0${left.id}`.localeCompare(`${right.file}\0${right.id}`)),
    unused_exports: unusedExports,
    isolated_facts: isolatedFacts,
    unreachable: { applicable: goalRoots.size > 0, roots: [...goalRoots].sort(), facts: unreachableFacts },
    invalid_evidence_dependents: invalidEvidenceDependents,
    candidate_ready_for_ai: candidateReadyForAi,
    heavily_reused: heavilyReused
  };
}
