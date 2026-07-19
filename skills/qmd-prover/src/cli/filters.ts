// The command grammar's filter vocabulary. Both the parser (which validates
// `--kind`/`--status`/`--origin`) and the help text (which lists their allowed
// values) name these, so they live in one small module that neither imports the
// other — keeping the parse/help dependency one-directional.

/** Allowed values for the `--kind` filter. */
export const KINDS = ['definition', 'lemma', 'theorem', 'proposition', 'corollary', 'unknown'] as const;

/** Allowed values for the `--status` filter. */
export const STATUSES = [
  'candidate', 'open', 'abandoned', 'disproof-candidate', 'missing',
  'verified', 'disproved', 'blocked', 'unverified', 'rejected', 'invalid'
] as const;

/** Allowed values for the `--origin` filter. */
export const ORIGINS = ['fact', 'main-goal', 'unresolved'] as const;
