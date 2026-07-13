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
