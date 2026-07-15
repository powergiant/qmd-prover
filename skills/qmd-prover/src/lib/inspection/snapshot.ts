import path from 'node:path';
import { AUX, atomicJson, readJson, relativePosix, sha256, stableJson } from '../infrastructure/files.js';
import { SCHEMA_VERSION } from '../shared/core.js';
import type {
  AiCheck, Compilation, DependencyGraph, Diagnostic, GlobalVerification, GraphNode, Manifest, RuntimeOptions
} from '../shared/types.js';
import type { ProjectInspectionIndex } from './index.js';

// A graph node is a topology-plus-status view. The verbose per-fact detail
// (verifier reasons/reports, statement and proof hashes) lives in the manifest
// results and each operation's `facts[]`/`check`, so nodes carry only the
// compact status an agent needs to reason about the graph. This keeps whole-graph
// payloads small instead of repeating the same reason string on every node.
function nodeLocalVerification(check: AiCheck | undefined): AiCheck {
  if (!check) return { status: 'not-run' };
  return check.outcome ? { status: check.status, outcome: check.outcome } : { status: check.status };
}

function nodeGlobalVerification(global: GlobalVerification | undefined): GlobalVerification {
  if (!global) return { status: 'unverified', blockers: [] };
  return { status: global.status, blockers: global.blockers ?? [] };
}

export interface ProjectSnapshot {
  schema_version: number;
  snapshot_id: string;
  context_hash: string;
  source_signature: string;
  goals: Array<{ id: string; file: string; line?: number; status: string }>;
  notes: Array<{ path: string; goals: string[] }>;
  manifest: Manifest;
  graph: DependencyGraph;
  diagnostics: Diagnostic[];
  summary: { goals: number; notes: number; facts: number; errors: number };
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

function compilationSource(compilation: Compilation): unknown {
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

/** Content signature of everything a published snapshot depends on. */
export function projectSourceSignature(compilation: Compilation, contextHash: string): string {
  return sha256(stableJson({ context_hash: contextHash, compilation: compilationSource(compilation) }, 0));
}

export function buildProjectSnapshot(index: ProjectInspectionIndex, diagnostics: Diagnostic[] = index.diagnostics): ProjectSnapshot {
  const results = index.compilation.manifest.results;
  const nodes: GraphNode[] = [
    ...results.map((result) => ({
      id: result.id,
      title: result.title,
      kind: result.kind,
      status: result.status,
      file: result.file,
      line: result.line,
      origin: result.origin === 'user' ? 'main-goal' as const : 'fact' as const,
      ownership: result.origin,
      local_verification: nodeLocalVerification(result.local_verification),
      global_verification: nodeGlobalVerification(result.global_verification),
      ...(result.disproof ? { disproof: result.disproof } : {})
    })),
    ...index.compilation.graph.nodes.filter((node) => node.origin === 'unresolved')
  ];
  const graph: DependencyGraph = {
    schema_version: SCHEMA_VERSION,
    nodes,
    edges: index.compilation.graph.edges,
    cycles: index.compilation.graph.cycles
  };
  // Graph nodes no longer carry statement/proof hashes, so mix the content
  // signature into the snapshot identity: it must still change whenever the
  // exact mathematical content changes, not only when node topology/status does.
  const sourceSignature = projectSourceSignature(index.compilation, index.contextHash);
  graph.snapshot_id = sha256(stableJson({ graph, context_hash: index.contextHash, source_signature: sourceSignature }, 0));
  const manifest: Manifest = { ...index.compilation.manifest, snapshot_id: graph.snapshot_id };
  const sorted = uniqueDiagnostics(diagnostics);
  return {
    schema_version: SCHEMA_VERSION,
    snapshot_id: graph.snapshot_id,
    context_hash: index.contextHash,
    source_signature: sourceSignature,
    goals: index.goals.map(({ id, file, line, status }) => ({ id, file, line, status })),
    notes: index.notes,
    manifest,
    graph,
    diagnostics: sorted,
    summary: {
      goals: index.goals.length,
      notes: index.notes.length,
      facts: results.length,
      errors: sorted.filter((item) => item.severity === 'error').length
    }
  };
}

export async function publishProjectSnapshot(
  index: ProjectInspectionIndex,
  snapshot: ProjectSnapshot,
  options: RuntimeOptions = {}
): Promise<boolean> {
  if (options.write === false || !index.compilation.complete) return false;
  const graphsRoot = path.join(index.root, AUX, 'graphs');
  const snapshotFile = path.join(graphsRoot, `${snapshot.snapshot_id.replace(/^sha256:/, '')}.json`);
  await Promise.all([
    atomicJson(snapshotFile, snapshot),
    atomicJson(path.join(index.root, AUX, 'manifest.json'), snapshot.manifest),
    atomicJson(path.join(index.root, AUX, 'graph.json'), snapshot.graph),
    atomicJson(path.join(index.root, AUX, 'diagnostics.json'), snapshot.diagnostics)
  ]);
  await atomicJson(path.join(graphsRoot, 'latest.json'), {
    schema_version: SCHEMA_VERSION,
    snapshot_id: snapshot.snapshot_id,
    file: relativePosix(index.root, snapshotFile)
  });
  return true;
}

/** Read the published snapshot when it is still current for the index's sources. */
export async function readPublishedSnapshot(index: ProjectInspectionIndex): Promise<ProjectSnapshot | null> {
  try {
    const pointer = await readJson<{ schema_version: number; snapshot_id: string; file: string }>(
      path.join(index.root, AUX, 'graphs', 'latest.json')
    );
    const graphsRoot = path.join(index.root, AUX, 'graphs');
    const snapshotFile = path.resolve(index.root, pointer.file);
    if (!snapshotFile.startsWith(`${graphsRoot}${path.sep}`)) return null;
    const saved = await readJson<ProjectSnapshot>(snapshotFile);
    if (pointer.schema_version !== SCHEMA_VERSION || saved.schema_version !== SCHEMA_VERSION
      || saved.snapshot_id !== pointer.snapshot_id
      || saved.source_signature !== projectSourceSignature(index.compilation, index.contextHash)
      || !Array.isArray(saved.manifest?.results)
      || !Array.isArray(saved.graph?.nodes)
      || !Array.isArray(saved.diagnostics)) return null;
    return saved;
  } catch { return null; }
}

/** The valid published snapshot, or a freshly built and published one. */
export async function resolveProjectSnapshot(index: ProjectInspectionIndex, options: RuntimeOptions = {}): Promise<ProjectSnapshot> {
  const saved = await readPublishedSnapshot(index);
  if (saved) return saved;
  const current = buildProjectSnapshot(index);
  await publishProjectSnapshot(index, current, options);
  return current;
}
