// The verifier result vocabulary: the verdict, report, and run-cost types shared
// across the engine. Semantic results carry these as overlaid status, the
// verification protocol produces them, the graph folds them into global status,
// and the CLI output renders them. They are pure data with no dependency on the
// protocol machinery, so they live in shared where every layer may name them.

/** How a fact is discharged: constructing a definition, proving, or refuting a claim. */
export type VerificationMode = 'definition-construction' | 'proof' | 'refutation';
export type VerificationOutcome = 'verified' | 'disproved' | 'rejected';
export type GlobalVerificationStatus =
  'verified' | 'disproved' | 'blocked' | 'unverified' | 'rejected' | 'invalid';

export interface GlobalVerification {
  status: GlobalVerificationStatus;
  blockers: string[];
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
export interface AiCheck {
  status: 'pass' | 'fail' | 'error' | 'not-run';
  source?: string;
  reason?: string;
  cached?: boolean;
  fatal?: boolean;
  code?: string;
  error?: string;
  remediation?: string;
  report?: VerifierReport | null;
  outcome?: VerificationOutcome;
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
