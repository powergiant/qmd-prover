import path from 'node:path';
import { findCycles } from '../semantic/compiler.js';
import { atomicJson, relativePosix, sha256, stableJson } from '../infrastructure/files.js';
import type {
  DependencyGraph, Diagnostic, GraphEdge, GraphNode, Manifest, RuntimeOptions, SemanticResult, WorkspaceInspectResult
} from '../shared/types.js';
import { workspaceStatus } from '../workspace/support.js';
import type { IndexedWorkspace, ProjectInspectionIndex } from './index.js';

type WorkspaceInspectionView = Pick<WorkspaceInspectResult, 'manifest' | 'diagnostics'>;

export interface AggregateSnapshot {
  schema_version: 3;
  snapshot_id: string;
  context_hash: string;
  source_signature: string;
  goals: Array<{ id: string; file: string; line?: number; status: string }>;
  notes: Array<{ path: string; goals: string[] }>;
  workspaces: Array<{ id: string; path: string; status: string; stale: boolean }>;
  manifest: Manifest;
  graph: DependencyGraph;
  diagnostics: Diagnostic[];
  summary: {
    goals: number;
    notes: number;
    workspaces: number;
    facts: number;
    errors: number;
  };
}

function uniqueDiagnostics(items: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = stableJson(item, 0);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => `${left.file ?? ''}:${left.line ?? 0}:${left.code}:${left.id ?? ''}`.localeCompare(`${right.file ?? ''}:${right.line ?? 0}:${right.code}:${right.id ?? ''}`));
}

function compiledWorkspaceResults(index: ProjectInspectionIndex, workspace: IndexedWorkspace): SemanticResult[] {
  const compilation = workspace.compilation;
  if (!compilation) return [];
  const results = compilation.manifest.results.map((result) => ({
    ...result,
    origin: 'workspace' as const,
    workspace: workspace.id,
    status: workspaceStatus(result)
  }));
  const localIds = new Set(results.map((result) => result.id));
  const goal = index.goals.find((result) => result.id === workspace.id);
  const targetProofs = compilation.manifest.proofs.filter((proof) => proof.target === workspace.id);
  if (goal && !localIds.has(goal.id)) {
    const proof = targetProofs.length === 1 ? targetProofs[0] : null;
    results.push({
      ...goal,
      origin: 'workspace',
      workspace: workspace.id,
      file: proof?.file ?? `${workspace.path}/target.qmd`,
      line: proof?.line ?? 1,
      proof_file: proof?.file,
      proof_line: proof?.line,
      proof_hash: proof?.proof_hash ?? goal.proof_hash,
      proof_present: proof?.proof_present ?? false,
      proof_text: proof?.proof_text ?? '',
      dependencies: [...new Set(proof?.dependencies ?? [])].sort(),
      uses: [...new Set(proof?.dependencies ?? [])].sort(),
      marker: proof?.marker ?? null,
      status: workspaceStatus({ ...goal, proof_present: proof?.proof_present ?? false }, proof?.marker)
    });
  }
  return results.sort((left, right) => left.id.localeCompare(right.id));
}

function compiledWorkspaceManifest(index: ProjectInspectionIndex, workspace: IndexedWorkspace): Manifest {
  const compilation = workspace.compilation;
  const results = compiledWorkspaceResults(index, workspace);
  return {
    schema_version: 3,
    target: workspace.id,
    stale: workspace.stale,
    files: compilation?.manifest.files ?? [],
    results,
    proofs: compilation?.manifest.proofs ?? []
  };
}

function selectedWorkspaceManifest(index: ProjectInspectionIndex, workspace: IndexedWorkspace, inspected?: WorkspaceInspectionView): Manifest {
  if (!inspected) return compiledWorkspaceManifest(index, workspace);
  const projectPath = (file: string): string => file === workspace.path || file.startsWith(`${workspace.path}/`)
    ? file
    : file.startsWith('.qmd-prover/') ? file : path.posix.join(workspace.path, file);
  return {
    ...inspected.manifest,
    files: inspected.manifest.files.map((file) => ({ ...file, path: projectPath(file.path) })),
    results: inspected.manifest.results.map((result) => ({
      ...result,
      file: projectPath(result.file),
      ...(result.proof_file ? { proof_file: projectPath(result.proof_file) } : {})
    })),
    proofs: inspected.manifest.proofs.map((proof) => ({ ...proof, file: projectPath(proof.file) }))
  };
}

export function buildAggregateSnapshot(
  index: ProjectInspectionIndex,
  inspected = new Map<string, WorkspaceInspectResult>()
): AggregateSnapshot {
  const workspaceManifests = new Map<string, Manifest>();
  for (const workspace of index.workspaces.filter((entry) => entry.status === 'initialized')) {
    workspaceManifests.set(workspace.id, selectedWorkspaceManifest(
      index, workspace, inspected.get(workspace.id) ?? workspace.snapshot ?? undefined
    ));
  }
  const results: SemanticResult[] = [];
  const workspaceByFact = new Map<string, string>();
  for (const [workspace, manifest] of workspaceManifests) {
    for (const result of manifest.results) {
      results.push({ ...result, workspace });
      workspaceByFact.set(result.id, workspace);
    }
  }
  const overlayIds = new Set(results.filter((result) => result.id.startsWith('thm-main-')).map((result) => result.id));
  for (const goal of index.goals) if (!overlayIds.has(goal.id)) results.push(goal);
  results.sort((left, right) => left.id.localeCompare(right.id));

  const explicitOwners = new Map<string, string>();
  for (const goal of index.goals) explicitOwners.set(goal.id, 'project-goals');
  for (const workspace of index.workspaces) {
    for (const result of workspace.compilation?.manifest.results ?? []) explicitOwners.set(result.id, workspace.id);
  }
  const resultById = new Map(results.map((result) => [result.id, result]));
  const edges: GraphEdge[] = [];
  for (const result of results.filter((item) => item.origin === 'workspace')) {
    for (const dependency of result.dependencies) {
      const owner = explicitOwners.get(dependency);
      if (owner && owner !== result.workspace) continue;
      edges.push({
        from: result.id,
        to: dependency,
        checks: result.reference_checks?.find((check) => check.dependency === dependency)
          ?? { existence: resultById.has(dependency) ? 'pass' : 'fail', scope: resultById.has(dependency) ? 'pass' : 'fail', status: resultById.get(dependency)?.status === 'workspace-verified' ? 'pass' : 'fail', cycle: 'pass', ai_sufficiency: 'not-run' }
      });
    }
  }
  edges.sort((left, right) => `${left.from}:${left.to}`.localeCompare(`${right.from}:${right.to}`));
  const known = new Set(results.map((result) => result.id));
  const unresolved = [...new Set(edges.map((edge) => edge.to).filter((id) => !known.has(id)))].sort();
  const nodes: GraphNode[] = [
    ...results.map((result) => ({
      id: result.id,
      title: result.title,
      kind: result.kind,
      status: result.status,
      file: result.file,
      line: result.line,
      origin: result.origin === 'workspace' ? 'workspace' : 'main-goal',
      ownership: result.origin,
      ...(result.workspace ? { workspace: result.workspace } : {}),
      identity: { statement_hash: result.statement_hash, proof_hash: result.proof_hash }
    })),
    ...unresolved.map((id) => ({ id, title: '', kind: 'unknown' as const, status: 'missing', origin: 'unresolved' }))
  ];
  const adjacency = new Map<string, string[]>(results.map((result) => [result.id, []]));
  for (const edge of edges) if (known.has(edge.to)) adjacency.get(edge.from)?.push(edge.to);
  const cycles = findCycles(adjacency);
  const graph: DependencyGraph = { schema_version: 3, nodes, edges, cycles };
  graph.snapshot_id = sha256(stableJson({ graph, context_hash: index.contextHash }, 0));
  const files = [
    ...index.goalsCompilation.manifest.files,
    ...[...workspaceManifests.values()].flatMap((manifest) => manifest.files)
  ];
  const manifest: Manifest = {
    schema_version: 3,
    snapshot_id: graph.snapshot_id,
    files,
    results,
    proofs: [...workspaceManifests.values()].flatMap((item) => item.proofs)
  };
  const diagnostics = uniqueDiagnostics([
    ...index.diagnostics,
    ...index.workspaces.flatMap((workspace) => inspected.has(workspace.id) ? [] : (workspace.snapshot?.diagnostics ?? [])),
    ...[...inspected.values()].flatMap((result) => result.diagnostics)
  ]);
  return {
    schema_version: 3,
    snapshot_id: graph.snapshot_id,
    context_hash: index.contextHash,
    source_signature: projectSourceSignature(index),
    goals: index.goals.map(({ id, file, line, status }) => ({ id, file, line, status })),
    notes: index.notes,
    workspaces: index.workspaces.map(({ id, path: workspacePath, status, stale }) => ({ id, path: workspacePath, status, stale })),
    manifest,
    graph,
    diagnostics,
    summary: {
      goals: index.goals.length,
      notes: index.notes.length,
      workspaces: index.workspaces.length,
      facts: results.length,
      errors: diagnostics.filter((item) => item.severity === 'error').length
    }
  };
}

function compilationSource(compilation: IndexedWorkspace['compilation']): unknown {
  if (!compilation) return null;
  return {
    complete: compilation.complete,
    files: compilation.manifest.files,
    results: compilation.manifest.results.map((result) => ({
      id: result.id, file: result.file, kind: result.kind, classes: result.classes, date: result.date,
      statement_hash: result.statement_hash, title_hash: result.title_hash, proof_hash: result.proof_hash,
      proof_present: result.proof_present, dependencies: result.dependencies, export: result.export, marker: result.marker
    })),
    proofs: compilation.manifest.proofs,
    diagnostics: compilation.diagnostics
  };
}

export function projectSourceSignature(index: ProjectInspectionIndex): string {
  return sha256(stableJson({
    context_hash: index.contextHash,
    goals: compilationSource(index.goalsCompilation),
    workspaces: index.workspaces.map((workspace) => ({
      id: workspace.id, path: workspace.path, status: workspace.status, stale: workspace.stale,
      metadata: workspace.metadata, compilation: compilationSource(workspace.compilation), diagnostics: workspace.diagnostics
    })),
    global_diagnostics: index.globalDiagnostics
  }, 0));
}

export function aggregateSourceSignature(snapshot: Pick<AggregateSnapshot, 'source_signature'>): string {
  return snapshot.source_signature;
}

export async function publishAggregateSnapshot(
  index: ProjectInspectionIndex,
  snapshot: AggregateSnapshot,
  options: RuntimeOptions = {}
): Promise<boolean> {
  const compilationsComplete = index.goalsCompilation.complete
    && index.workspaces.every((workspace) => workspace.compilation?.complete !== false);
  if (options.write === false || index.fatal || !compilationsComplete) return false;
  const graphsRoot = path.join(index.root, '.qmd-prover', 'graphs');
  const snapshotFile = path.join(graphsRoot, `${snapshot.snapshot_id.replace(/^sha256:/, '')}.json`);
  await Promise.all([
    atomicJson(snapshotFile, snapshot),
    atomicJson(path.join(index.root, '.qmd-prover', 'manifest.json'), snapshot.manifest),
    atomicJson(path.join(index.root, '.qmd-prover', 'graph.json'), snapshot.graph),
    atomicJson(path.join(index.root, '.qmd-prover', 'diagnostics.json'), snapshot.diagnostics)
  ]);
  await atomicJson(path.join(graphsRoot, 'latest.json'), {
    schema_version: 3,
    snapshot_id: snapshot.snapshot_id,
    file: relativePosix(index.root, snapshotFile)
  });
  return true;
}
