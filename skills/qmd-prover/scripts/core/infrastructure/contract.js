import { readFile } from 'node:fs/promises';
// The canonical qmd-prover project contract ships as a single managed block inside
// `references/AGENTS.md`, next to the engine. This module is the one reader of that
// block: `init` copies it into a project's `AGENTS.md`, and the compatibility check
// compares a project's block version against it. Keeping the reader here means the
// engine owns the canonical contract regardless of how the docs-only skill is placed.
const BLOCK = /<!-- qmd-prover-contract:start version=(\d+) -->[\s\S]*?<!-- qmd-prover-contract:end -->/g;
/** Read the engine's bundled canonical contract block and its version. */
export async function readCanonicalContract() {
    const file = new URL('../../../references/AGENTS.md', import.meta.url);
    const source = await readFile(file, 'utf8');
    const matches = [...source.matchAll(BLOCK)];
    if (matches.length !== 1)
        throw new Error('Canonical qmd-prover contract must contain exactly one managed block');
    return { block: matches[0][0], version: Number(matches[0][1]) };
}
/** The managed-block contract version declared in a project's `AGENTS.md`, or null when absent/ambiguous. */
export function contractVersionIn(source) {
    const matches = [...source.matchAll(BLOCK)];
    if (matches.length !== 1)
        return null;
    return Number(matches[0][1]);
}
