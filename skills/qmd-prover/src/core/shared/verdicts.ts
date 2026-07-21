// The verifier result vocabulary: the verdict, report, and run-cost types shared
// across the engine. Semantic results carry these as overlaid status, the
// verification protocol produces them, the graph folds them into global status,
// and the CLI output renders them. They are pure data with no dependency on the
// protocol machinery, so they live in shared where every layer may name them.

/** How a fact is discharged: constructing a definition, proving, or refuting a claim. */
export type VerificationMode = 'definition-construction' | 'proof' | 'refutation';
/** The three conclusive verdicts a verifier can reach about one fact. */
export type VerificationOutcome = 'verified' | 'disproved' | 'rejected';

/**
 * The `local` field of the status model: a conclusive verdict, or none yet. Only the AI
 * verifier ever produces the three conclusive values; the mechanical layer may return a
 * recorded verdict to `not-run` (staleness) but may never grant one.
 */
export type LocalVerificationStatus = VerificationOutcome | 'not-run';

/** Why no verdict is on record. Required whenever the local status is `not-run`. */
export type LocalNotRunReason =
  | 'nothing-to-check'   // no proof block, or an empty one
  | 'draft'              // the proof is marked `.draft`
  | 'assumed'            // the fact is marked `.assumed` — taken as given, composes as verified
  | 'not-eligible'       // the fact is broken or abandoned
  | 'out-of-scope'       // ready, but outside the selected fact/path closure
  | 'no-backend'         // no verifier is configured
  | 'verifier-error';    // the verifier failed, timed out, or returned an unusable report

/** The `global` field: the one status string every list context shows. */
export type GlobalVerificationStatus =
  'verified' | 'disproved' | 'rejected' | 'blocked' | 'unverified' | 'open' | 'broken' | 'abandoned';

/**
 * What one row of a list context may show: a real fact's `global` status, or the placeholder for a
 * cited @ID that resolves to nothing. `missing` is not a fact state — no fact ever holds it — but it
 * occupies the same column, so it shares the type and the `--status` vocabulary.
 */
export type FactListStatus = GlobalVerificationStatus | 'missing';

/** The `mechanical` field: is the fact well formed? Computed without any AI verifier. */
export type MechanicalStatus = 'ok' | 'broken';

/** The `intent` field: what the author declared through div attributes. */
export type FactIntent = 'normal' | 'disproof' | 'draft' | 'assumed' | 'abandoned';

export interface GlobalVerification {
  status: GlobalVerificationStatus;
  blockers: string[];
  /**
   * Every `.assumed` fact in this fact's dependency closure (itself included when it is assumed),
   * sorted. Empty when the fact rests on nothing taken on faith. A non-empty footprint under a
   * `verified` status is rendered as `verified modulo N assumptions`. See docs/designs/design-status.md.
   */
  assumptions: string[];
  reason?: string;
}

export interface DisproofEvidence {
  status: 'conditional' | 'global';
  summary: string;
  refutation: string;
  source: string;
  verification_key?: string;
}

/** A single verifier verdict recorded against a fact (local, before propagation). */
export interface LocalVerification {
  status: LocalVerificationStatus;
  /** Present exactly when `status` is `not-run`; the code the global composition reads. */
  reason?: LocalNotRunReason;
  /** One sentence elaborating `reason` for a human reader. Never parsed. */
  detail?: string;
  source?: string;
  cached?: boolean;
  fatal?: boolean;
  code?: string;
  error?: string;
  remediation?: string;
  report?: VerifierReport | null;
  details?: {
    command?: string;
    exit_code?: number | null;
    signal?: string | null;
    stderr_excerpt?: string;
    stdout_excerpt?: string;
    [key: string]: unknown;
  };
  inherited?: boolean;
  /** Run cost of the check that produced this outcome (a fresh call; 0-work for a cache hit). */
  metrics?: VerifierMetrics;
}

export interface VerifierReport {
  verdict: 'correct' | 'incorrect' | 'disproved';
  summary: string;
  critical_errors: string[];
  gaps: string[];
  nonblocking_comments: string[];
  repair_hints: string;
  refutation: string;
}

/** Token counts a backend reports for one check. Only fields the backend supplies are present. */
export interface VerifierUsage {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}

/**
 * Run-specific cost of one verifier invocation: wall-clock duration and, when the backend
 * reports it, token usage. These are NOT part of the verdict or the cache key — they vary per
 * run — so they travel alongside the report rather than inside it.
 */
export interface VerifierMetrics {
  duration_ms: number;
  cached?: boolean;
  usage?: VerifierUsage;
}
