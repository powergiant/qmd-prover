/**
 * The semantic data model produced by the compiler: the manifest of source files,
 * results, and proofs discovered across a project's QMD documents. Verification
 * verdicts ({@link LocalVerification}, {@link GlobalVerification}, {@link DisproofEvidence})
 * are overlaid onto results by the inspection layer.
 */
import type { ResultKind } from '../shared/core.js';
import type {
  DisproofEvidence, FactIntent, FactListStatus, GlobalVerification, LocalVerification, MechanicalStatus
} from '../shared/verdicts.js';

/** Whether a result was authored by the user (a protected goal) or by an agent. */
export type ResultOrigin = 'user' | 'agent';

/** Outcome of a single mechanical reference check. */
export type CheckStatus = 'pass' | 'fail' | 'pending' | 'not-run' | 'not-applicable';

export interface ReferenceCheck {
  dependency: string;
  existence: CheckStatus;
  scope: CheckStatus;
  cycle?: CheckStatus;
  source?: string;
  target?: string;
}

export interface ImportDeclaration {
  from: string;
  use: string[];
}

export interface SourceFileRecord {
  path: string;
  imports: ImportDeclaration[];
  results: string[];
  proofs: string[];
}

export interface ProofRecord {
  target: string;
  file: string;
  line?: number;
  dependencies: string[];
  proof_hash: string;
  proof_present: boolean;
  proof_text: string;
  /** Author flag: this proof is a proposed refutation (`.disproof` class on the proof div). */
  refutation: boolean;
  /** Author flag: this proof is deliberately unfinished (`.draft` class) — never sent to the verifier. */
  draft: boolean;
  /** Author flag: this proof is detached (`.abandon` class) — kept for memory, not linked or checked. */
  abandon: boolean;
}

export interface SemanticResult {
  id: string;
  file: string;
  line?: number;
  kind: ResultKind;
  classes: string[];
  title: string;
  date: string;
  // The four fields of the status model, plus the single string they project to.
  // See docs/designs/design-status.md.
  /** What the author declared, read off the div attributes alone. */
  intent: FactIntent;
  /** Whether the fact is well formed: shape, ID, date, references, cycles. */
  mechanical: MechanicalStatus;
  /** The composed `global` status: the one string list contexts show. */
  status: FactListStatus;
  statement_text: string;
  statement_hash: string;
  title_hash: string;
  proof_hash: string;
  proof_present: boolean;
  proof_text: string;
  proof_file?: string;
  proof_line?: number;
  /** Author flag: the active proof is a proposed refutation (checked in refutation mode). */
  refutation: boolean;
  /** Author flag: the proof is deliberately unfinished — never checked, and the fact stays open. */
  draft: boolean;
  /** Author flag: this fact is detached — kept for memory, skipped by inspection. */
  abandon: boolean;
  export?: string | null;
  construction_dependencies: string[];
  dependencies: string[];
  reference_checks?: ReferenceCheck[];
  disproof?: DisproofEvidence;
  local_verification?: LocalVerification;
  global_verification?: GlobalVerification;
  origin: ResultOrigin;
}

export interface Manifest {
  schema_version: number;
  snapshot_id?: string;
  files: SourceFileRecord[];
  results: SemanticResult[];
  proofs: ProofRecord[];
}
