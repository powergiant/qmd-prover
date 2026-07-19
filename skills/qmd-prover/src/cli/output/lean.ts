/**
 * The lean projection applied to every operation result before it is serialized
 * as the default CLI JSON. It is the agent-facing view model: each command emits
 * only the compact answer its name promises. The rich internal result is left
 * untouched for `--print` (report.ts) and for the on-disk snapshot, so no
 * human-facing information is lost — heavy detail moves to dedicated sinks
 * (`inspect fact <id>`, `dependency dependencies|reused|...`, the `--graph` flag,
 * or the persisted `.qmd-prover/graph.json`).
 *
 * Design rules:
 *  - one compact fact reference {id, kind, status, file, line} wherever a fact is listed;
 *  - never embed the whole dependency graph unless `--graph` asks for it;
 *  - never repeat a per-fact reason that is implied by the verification summary.
 * Operations not explicitly mapped pass through unchanged (identity), which keeps
 * render, verification, init, doctor, cycles, path, and unused-* results intact.
 */
import type { OperationResult } from '../../core/shared/types.js';
import type { DependencyGraph, GraphNode } from '../../core/semantic/dependency-graph.js';
import type { FactInspectionCheck } from '../../core/graph/verify.js';
import type { GraphFindings } from '../../core/graph/findings.js';
import type { BlockerPath, FrontierItem } from '../../core/graph/algorithms.js';

export interface LeanViewOptions {
  /** Keep the full DependencyGraph / fact subgraph inline (the `--graph` flag). */
  graph?: boolean;
}

export interface FactRef {
  id: string;
  kind?: string;
  status: string;
  file?: string;
  line?: number;
}

type NodeLike = { id: string; kind?: string; status?: string; file?: string; line?: number };
type ReuseItem = { fact: GraphNode; direct_dependents: number; transitive_dependents: number; verified_dependents: number };

/** The single compact fact reference used wherever a result lists facts. */
export function refNode(node: NodeLike): FactRef {
  return {
    id: node.id,
    ...(node.kind !== undefined ? { kind: node.kind } : {}),
    status: node.status ?? 'missing',
    ...(node.file !== undefined ? { file: node.file } : {}),
    ...(node.line !== undefined ? { line: node.line } : {})
  };
}

function reuseRef(item: ReuseItem): FactRef & { direct_dependents: number; transitive_dependents: number; verified_dependents: number } {
  return {
    ...refNode(item.fact),
    direct_dependents: item.direct_dependents,
    transitive_dependents: item.transitive_dependents,
    verified_dependents: item.verified_dependents
  };
}

function leanBlockers(blockers: BlockerPath[]): Array<{ root: string; blocker: FactRef; path: string[] | null }> {
  return blockers.map((blocker) => ({ root: blocker.root, blocker: refNode(blocker.blocker), path: blocker.path }));
}

/** Category counts for the aggregate findings view (the full lists have dedicated commands). */
function findingCounts(findings: GraphFindings): Record<string, number | string> {
  return {
    unused_imports: findings.unused_imports.length,
    unused_exports: findings.unused_exports.length,
    isolated_facts: findings.isolated_facts.length,
    unreachable: findings.unreachable.applicable === false ? 'not-applicable' : findings.unreachable.facts.length,
    invalid_evidence_dependents: findings.invalid_evidence_dependents.length,
    candidate_ready_for_ai: findings.candidate_ready_for_ai.length,
    heavily_reused: findings.heavily_reused.length
  };
}

function record(result: OperationResult): Record<string, unknown> {
  return { ...result } as Record<string, unknown>;
}

/** inspect project / inspect path: dashboard summary + compact facts, no embedded graph. */
function leanInspect(result: OperationResult, options: LeanViewOptions): OperationResult {
  const graph = result.graph as DependencyGraph | undefined;
  const nodes = new Map<string, GraphNode>((graph?.nodes ?? []).map((node) => [node.id, node]));
  const facts = ((result.facts as FactInspectionCheck[] | undefined) ?? []).map((fact) => {
    const entry: Record<string, unknown> = {
      id: fact.id,
      ...(fact.kind !== undefined ? { kind: fact.kind } : {}),
      status: fact.status,
      ...(fact.file !== undefined ? { file: fact.file } : {}),
      ...(fact.line !== undefined ? { line: fact.line } : {}),
      mechanical: fact.mechanical?.status,
      local: fact.local_verification?.outcome ?? fact.local_verification?.status,
      global: fact.global_verification?.status
    };
    // A disproved fact keeps its refutation evidence so the whole-project view still
    // answers "which facts are disproved and why" without an extra inspect-fact call.
    const disproof = nodes.get(fact.id)?.disproof;
    if (disproof) entry.disproof = disproof;
    return entry;
  });
  const lean = record(result);
  lean.facts = facts;
  if (result.blockers) lean.blockers = leanBlockers(result.blockers as BlockerPath[]);
  if (result.findings) lean.findings = findingCounts(result.findings as GraphFindings);
  // The embedded staleness block is always a not-computed stub; `check staleness` is the real audit.
  delete lean.staleness;
  if (!options.graph) delete lean.graph;
  return lean as OperationResult;
}

/** inspect fact: keep the per-fact detail, compact the dependency lists, drop the subgraph. */
function leanInspectFact(result: OperationResult, options: LeanViewOptions): OperationResult {
  const lean = record(result);
  if (result.direct_dependencies) lean.direct_dependencies = (result.direct_dependencies as GraphNode[]).map(refNode);
  if (result.transitive_dependencies) lean.transitive_dependencies = (result.transitive_dependencies as GraphNode[]).map(refNode);
  if (result.direct_reverse_dependencies) lean.direct_reverse_dependencies = (result.direct_reverse_dependencies as GraphNode[]).map(refNode);
  if (result.blockers) lean.blockers = leanBlockers(result.blockers as BlockerPath[]);
  delete lean.staleness;
  if (!options.graph) delete lean.graph;
  return lean as OperationResult;
}

function leanDependencies(result: OperationResult): OperationResult {
  const direct = result.direct as GraphNode[] | undefined;
  const transitive = result.transitive as GraphNode[] | undefined;
  const lean = record(result);
  if (result.target) lean.target = refNode(result.target as GraphNode);
  lean.counts = { direct: direct?.length ?? 0, transitive: transitive?.length ?? 0 };
  if (direct) lean.direct = direct.map(refNode);
  if (transitive) lean.transitive = transitive.map(refNode);
  return lean as OperationResult;
}

function leanImpact(result: OperationResult): OperationResult {
  const affected = result.affected as GraphNode[] | undefined;
  const lean = record(result);
  if (result.target) lean.target = refNode(result.target as GraphNode);
  lean.count = affected?.length ?? 0;
  if (affected) lean.affected = affected.map(refNode);
  return lean as OperationResult;
}

function leanFrontier(result: OperationResult): OperationResult {
  const frontier = result.frontier as FrontierItem[] | undefined;
  const lean = record(result);
  if (result.target) lean.target = refNode(result.target as GraphNode);
  lean.count = frontier?.length ?? 0;
  if (frontier) lean.frontier = frontier.map((item) => ({ fact: refNode(item.fact), path: item.path }));
  return lean as OperationResult;
}

function leanSearch(result: OperationResult): OperationResult {
  const matches = result.matches as GraphNode[] | undefined;
  const lean = record(result);
  lean.count = matches?.length ?? 0;
  if (matches) lean.matches = matches.map(refNode);
  return lean as OperationResult;
}

function leanFindings(result: OperationResult): OperationResult {
  const findings = result.findings as GraphFindings | undefined;
  if (!findings) return result;
  const lean = record(result);
  lean.findings = {
    counts: findingCounts(findings),
    unused_imports: findings.unused_imports,
    unused_exports: findings.unused_exports,
    isolated_facts: findings.isolated_facts.map(refNode),
    unreachable: {
      applicable: findings.unreachable.applicable,
      roots: findings.unreachable.roots,
      facts: findings.unreachable.facts.map(refNode)
    },
    invalid_evidence_dependents: findings.invalid_evidence_dependents.map((item) => ({ fact: refNode(item.fact), invalid_sources: item.invalid_sources })),
    candidate_ready_for_ai: findings.candidate_ready_for_ai.map(refNode),
    heavily_reused: findings.heavily_reused.map(reuseRef)
  };
  return lean as OperationResult;
}

function leanReadyForAi(result: OperationResult): OperationResult {
  const candidates = result.candidates as GraphNode[] | undefined;
  const lean = record(result);
  lean.count = candidates?.length ?? 0;
  if (candidates) lean.candidates = candidates.map(refNode);
  return lean as OperationResult;
}

function leanReused(result: OperationResult): OperationResult {
  const facts = result.facts as ReuseItem[] | undefined;
  const lean = record(result);
  if (facts) lean.facts = facts.map(reuseRef);
  return lean as OperationResult;
}

/** dependency isolated / unreachable: list of facts as compact refs. */
function leanNodeFacts(result: OperationResult): OperationResult {
  const facts = result.facts as GraphNode[] | undefined;
  const lean = record(result);
  lean.count = facts?.length ?? 0;
  if (facts) lean.facts = facts.map(refNode);
  return lean as OperationResult;
}

/** Project a rich operation result down to the lean default CLI JSON view. */
export function leanView(result: OperationResult, options: LeanViewOptions = {}): OperationResult {
  switch (result.operation) {
    case 'inspect-project':
    case 'inspect-path':
      return leanInspect(result, options);
    case 'inspect-fact':
      return leanInspectFact(result, options);
    case 'dependency-dependencies':
    case 'dependency-reverse-dependencies':
      return leanDependencies(result);
    case 'dependency-impact':
      return leanImpact(result);
    case 'dependency-frontier':
      return leanFrontier(result);
    case 'dependency-search':
      return leanSearch(result);
    case 'dependency-findings':
      return leanFindings(result);
    case 'dependency-ready':
      return leanReadyForAi(result);
    case 'dependency-reused':
      return leanReused(result);
    case 'dependency-isolated':
    case 'dependency-unreachable':
      return leanNodeFacts(result);
    default:
      return result;
  }
}
