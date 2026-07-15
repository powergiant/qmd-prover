import { cleanId } from '../infrastructure/files.js';
import { indexBy } from '../shared/core.js';
import type { DependencyGraph, GraphNode, RuntimeOptions } from '../shared/types.js';

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return indexBy(items, (item) => item.id);
}

interface PathSearchResult {
  paths: string[][];
  truncated: boolean;
  explored: number;
  limits: { max_paths: number; max_depth: number; max_explored: number };
}

export function adjacency(graph: DependencyGraph, reverse = false): Map<string, string[]> {
  const output = new Map<string, string[]>(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    const from = reverse ? edge.to : edge.from;
    const to = reverse ? edge.from : edge.to;
    if (!output.has(from)) output.set(from, []);
    output.get(from)?.push(to);
  }
  for (const values of output.values()) values.sort();
  return output;
}

export function traverse(graph: DependencyGraph, start: string, reverse = false): Set<string> {
  const links = adjacency(graph, reverse);
  const seen = new Set<string>();
  const queue = [...(links.get(start) ?? [])];
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...(links.get(current) ?? []));
  }
  return seen;
}

export function boundedInteger(value: unknown, fallback: number, { name, min, max }: { name: string; min: number; max: number }): number {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return parsed;
}

export function allSimplePaths(graph: DependencyGraph, start: string, goal: string, options: RuntimeOptions = {}): PathSearchResult {
  const maxPaths = boundedInteger(options.maxPaths, 5, { name: 'max paths', min: 1, max: 25 });
  const maxDepth = boundedInteger(options.maxDepth, Math.min(Math.max(graph.nodes.length - 1, 1), 64), { name: 'max depth', min: 1, max: 100 });
  const maxExplored = boundedInteger(options.maxExplored, 10000, { name: 'max explored paths', min: 1, max: 100000 });
  if (start === goal) return { paths: [[start]], truncated: false, explored: 1, limits: { max_paths: maxPaths, max_depth: maxDepth, max_explored: maxExplored } };
  const links = adjacency(graph);
  const queue: string[][] = [[start]];
  const paths: string[][] = [];
  let explored = 0;
  let generated = 1;
  let generationCapped = false;
  while (queue.length && paths.length < maxPaths && explored < maxExplored) {
    const current = queue.shift();
    if (!current) continue;
    explored += 1;
    if (current.length - 1 >= maxDepth) continue;
    for (const next of links.get(current[current.length - 1] ?? '') ?? []) {
      if (current.includes(next)) continue;
      const candidate = [...current, next];
      if (next === goal) paths.push(candidate);
      else if (generated < maxExplored) {
        queue.push(candidate);
        generated += 1;
      } else generationCapped = true;
      if (paths.length >= maxPaths) break;
    }
  }
  return {
    paths,
    truncated: paths.length >= maxPaths || generationCapped || queue.length > 0 || (explored >= maxExplored && paths.length < maxPaths),
    explored,
    limits: { max_paths: maxPaths, max_depth: maxDepth, max_explored: maxExplored }
  };
}

export function shortestPath(graph: DependencyGraph, start: string, goal: string, reverse = false): string[] | null {
  if (start === goal) return [start];
  const links = adjacency(graph, reverse);
  const queue: string[][] = [[start]];
  const seen = new Set<string>([start]);
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    for (const next of links.get(current[current.length - 1] ?? '') ?? []) {
      if (seen.has(next)) continue;
      const candidate = [...current, next];
      if (next === goal) return candidate;
      seen.add(next);
      queue.push(candidate);
    }
  }
  return null;
}

export function subgraph(graph: DependencyGraph, ids: Iterable<string>): DependencyGraph {
  const selected = new Set(ids);
  return {
    schema_version: graph.schema_version,
    snapshot_id: graph.snapshot_id,
    nodes: graph.nodes.filter((node) => selected.has(node.id)),
    edges: graph.edges.filter((edge) => selected.has(edge.from) && selected.has(edge.to)),
    cycles: (graph.cycles ?? []).filter((cycle) => cycle.every((id) => selected.has(id)))
  };
}

export interface FrontierItem { fact: GraphNode; path: string[] | null }
export interface BlockerPath { root: string; blocker: GraphNode; path: string[] | null }

export function blockerPaths(graph: DependencyGraph, roots: string[]): BlockerPath[] {
  const output: BlockerPath[] = [];
  const seen = new Set<string>();
  for (const root of [...new Set(roots)].sort()) {
    if (!graph.nodes.some((node) => node.id === root)) continue;
    for (const item of frontier(graph, root)) {
      // Skip the trivial "a fact blocks itself" path: an unverified leaf is its
      // own frontier, but reporting it as a blocking dependency of itself is noise.
      if (item.fact.id === root && (item.path?.length ?? 0) <= 1) continue;
      const key = `${root}\0${item.fact.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({ root, blocker: item.fact, path: item.path });
    }
  }
  return output;
}

export function requireNode(graph: DependencyGraph, requested: string): GraphNode {
  const id = cleanId(requested);
  const node = graph.nodes.find((item) => item.id === id);
  if (!node) throw new Error(`Unknown fact in dependency snapshot: @${id}`);
  return node;
}

export function frontier(graph: DependencyGraph, requested: string): FrontierItem[] {
  const target = requireNode(graph, requested);
  const closure = new Set([target.id, ...traverse(graph, target.id)]);
  const nodes = byId(graph.nodes);
  const unresolved = [...closure].filter((id) => nodes.get(id)?.global_verification?.status !== 'verified');
  const cycleSets = (graph.cycles ?? []).map((cycle) => new Set(cycle.slice(0, -1)));
  const sameCycle = (left: string, right: string) => cycleSets.some((cycle) => cycle.has(left) && cycle.has(right));
  const lowest = unresolved.filter((id) => ![...traverse(graph, id)].some((dependency) => dependency !== id && unresolved.includes(dependency) && !sameCycle(id, dependency)));
  return lowest.sort().map((id) => ({ fact: nodes.get(id) ?? { id, status: 'missing' }, path: shortestPath(graph, target.id, id) }));
}
