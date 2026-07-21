import type { ResultKind } from '../shared/core.js';
import type { CheckStatus } from './model.js';
import type {
  DisproofEvidence, FactIntent, FactListStatus, GlobalVerification, LocalVerification, MechanicalStatus
} from '../shared/verdicts.js';

export type GraphNodeOrigin = 'main-goal' | 'fact' | 'unresolved';

export interface GraphNode {
  id: string;
  /** The four status fields, so `--status` and `--set` can both be answered from the graph alone. */
  intent?: FactIntent;
  mechanical?: MechanicalStatus;
  status: FactListStatus;
  kind?: ResultKind;
  title?: string;
  file?: string;
  line?: number;
  origin?: GraphNodeOrigin;
  ownership?: string;
  scope?: 'selected' | 'external';
  local_verification?: LocalVerification;
  global_verification?: GlobalVerification;
  disproof?: DisproofEvidence;
}

export interface GraphEdgeChecks {
  existence: CheckStatus;
  scope: CheckStatus;
  cycle?: CheckStatus;
}

export interface GraphEdge {
  from: string;
  to: string;
  checks?: GraphEdgeChecks;
}

/**
 * The named fact sets. They cut across `status` and overlap each other, so they cannot be status
 * values; they are the groupings a query asks for by name. See docs/designs/design-status.md.
 */
export const SETS = ['candidate', 'disproof-candidate', 'ready', 'unbroken'] as const;
export type FactSet = typeof SETS[number];

/** The statuses that say a fact was never eligible to be sent: `ready` is everything else. */
const NOT_READY: readonly FactListStatus[] = ['open', 'broken', 'abandoned', 'missing'];

/**
 * Whether a graph node belongs to a named set.
 *
 * `ready` is read off `status` rather than recomputed, because the four not-ready statuses are
 * exactly the four reasons a fact is never sent: nothing written (`open`, which also covers
 * `.draft`), malformed (`broken`), kept for memory (`abandoned`), or not a fact at all (`missing`).
 * That keeps the set answerable on a graph compiled without any verification run.
 */
export function inSet(node: GraphNode, set: FactSet): boolean {
  switch (set) {
    case 'candidate': return node.intent !== 'abandoned';
    case 'disproof-candidate': return node.intent === 'disproof';
    case 'unbroken': return node.mechanical !== 'broken';
    case 'ready': return !NOT_READY.includes(node.status);
  }
}

export interface DependencyGraph {
  schema_version: number;
  snapshot_id?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  cycles: string[][];
}

export function findCycles(adjacency: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const state = new Map<string, 'visiting' | 'visited'>();
  const stack: string[] = [];
  const seen = new Set<string>();
  function canonical(cycle: string[]): string[] {
    const open = cycle.slice(0, -1);
    const rotations = open.map((_, index) => [...open.slice(index), ...open.slice(0, index)]);
    const selected = rotations.sort((left, right) => left.join('\0').localeCompare(right.join('\0')))[0];
    return [...selected, selected[0]];
  }
  function visit(node: string): void {
    state.set(node, 'visiting');
    stack.push(node);
    for (const next of [...(adjacency.get(node) ?? [])].sort()) {
      if (state.get(next) === 'visiting') {
        const cycle = canonical([...stack.slice(stack.indexOf(next)), next]);
        const key = cycle.join('\0');
        if (!seen.has(key)) { seen.add(key); cycles.push(cycle); }
      } else if (!state.has(next)) visit(next);
    }
    stack.pop();
    state.set(node, 'visited');
  }
  for (const node of [...adjacency.keys()].sort()) if (!state.has(node)) visit(node);
  return cycles.sort((left, right) => left.join('\0').localeCompare(right.join('\0')));
}
