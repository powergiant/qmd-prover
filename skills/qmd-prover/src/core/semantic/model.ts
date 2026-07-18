/**
 * The semantic data model produced by the compiler: the manifest of source files,
 * results, and proofs discovered across a project's QMD documents. Verification
 * verdicts ({@link AiCheck}, {@link GlobalVerification}, {@link DisproofEvidence})
 * are overlaid onto results by the inspection layer.
 */
import type { ControlMarker, ResultKind } from '../shared/core.js';
import type { AiCheck, DisproofEvidence, GlobalVerification } from '../shared/verdicts.js';

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
  marker?: ControlMarker | null;
  marker_index?: number | null;
  markers?: Array<{ marker: ControlMarker; index: number }>;
  blocks?: unknown[];
}

export interface SemanticResult {
  id: string;
  file: string;
  line?: number;
  kind: ResultKind;
  classes: string[];
  title: string;
  date: string;
  status: string;
  statement_text: string;
  statement_hash: string;
  title_hash: string;
  proof_hash: string;
  proof_present: boolean;
  proof_text: string;
  proof_file?: string;
  proof_line?: number;
  marker?: ControlMarker | null;
  marker_valid?: boolean;
  export?: string | null;
  construction_dependencies: string[];
  dependencies: string[];
  reference_checks?: ReferenceCheck[];
  stale_reasons?: string[];
  disproof?: DisproofEvidence;
  local_verification?: AiCheck;
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
