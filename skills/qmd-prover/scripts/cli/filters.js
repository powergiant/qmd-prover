// The command grammar's filter vocabulary. Both the parser (which validates
// `--kind`/`--status`/`--set`/`--origin`) and the help text (which lists their allowed
// values) name these, so they live in one small module that neither imports the
// other — keeping the parse/help dependency one-directional.
export { SETS, inSet } from '../core/semantic/dependency-graph.js';
/** Allowed values for the `--kind` filter. */
export const KINDS = ['definition', 'lemma', 'theorem', 'proposition', 'corollary', 'unknown'];
/**
 * Allowed values for the `--status` filter: exactly the `global` field of the status model,
 * plus the `missing` placeholder for a cited @ID that resolves to nothing. Disjoint — every
 * fact holds exactly one. See docs/designs/design-status.md.
 */
export const STATUSES = [
    'open', 'unverified', 'rejected', 'blocked', 'broken', 'abandoned', 'verified', 'disproved', 'missing'
];
/** Allowed values for the `--origin` filter. */
export const ORIGINS = ['fact', 'main-goal', 'unresolved'];
