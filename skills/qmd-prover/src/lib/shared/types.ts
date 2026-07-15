/** JSON-compatible values persisted by qmd-prover's stable output protocol. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Untrusted object read from JSON, YAML, Pandoc, or a verifier process. */
export type UnknownRecord = Record<string, unknown>;
export type JsonObject = UnknownRecord;

export interface ExternalPolicy extends JsonObject {
  path: string;
  mode: 'unrestricted' | 'declared' | 'none';
  content: string | null;
}

export type DiagnosticSeverity = 'error' | 'warning';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  file?: string;
  line?: number;
  id?: string;
  remediation?: string;
  repair_hints?: string;
  dependency?: string;
  locations?: string[];
}

export type ResultKind = 'definition' | 'lemma' | 'theorem' | 'proposition' | 'corollary' | 'unknown';
export type ResultOrigin = 'user' | 'agent';
export type GraphNodeOrigin = 'main-goal' | 'fact' | 'unresolved';
export type ControlMarker = 'OPEN' | 'REJECTED' | 'DISPROVED' | 'VERIFIED' | 'REVOKED';
export type CheckStatus = 'pass' | 'fail' | 'pending' | 'not-run' | 'not-applicable';
export type VerificationMode = 'definition-construction' | 'proof' | 'refutation';
export type VerificationOutcome = 'verified' | 'disproved' | 'rejected';
export type GlobalVerificationStatus = 'verified' | 'disproved' | 'blocked' | 'unverified' | 'rejected' | 'invalid';

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
  construction_text?: string;
  construction_hash?: string;
  construction_dependencies: string[];
  dependencies: string[];
  uses: string[];
  reference_checks?: ReferenceCheck[];
  stale_reasons?: string[];
  rejection_stale_reasons?: string[];
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

export interface GraphNode {
  id: string;
  status: string;
  kind?: ResultKind;
  title?: string;
  file?: string;
  line?: number;
  origin?: GraphNodeOrigin;
  ownership?: string;
  scope?: 'selected' | 'external';
  identity?: { statement_hash: string; proof_hash: string };
  local_verification?: AiCheck;
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
  source?: string;
}

export interface DependencyGraph {
  schema_version: number;
  snapshot_id?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  cycles: string[][];
}

export interface ProjectConfig {
  name: string;
  root: string;
  'discover-qmd-recursively': boolean;
  exclude: string[];
}

export interface GoalsConfig {
  'id-prefix': string;
  'protect-statements': boolean;
}

export interface SemanticConfig { 'wildcard-imports': boolean }

export interface VerificationConfig {
  backend: string;
  model: string;
  effort: string;
  'fresh-context': boolean;
  'require-zero-gaps': boolean;
  command?: string;
  args?: string[];
  timeout?: number;
  [key: string]: unknown;
}

export interface RenderConfig {
  'graph-engine': string;
  'output-dir': string;
}

export interface QmdProverConfig {
  project: ProjectConfig;
  goals: GoalsConfig;
  semantic: SemanticConfig;
  verification: VerificationConfig;
  render: RenderConfig;
}

export interface CompilerOptions {
  pandoc?: string;
  write?: boolean;
  files?: string[];
  excludeFiles?: string[];
  protectStatements?: boolean;
}

export interface RuntimeOptions extends CompilerOptions {
  destination?: string;
  maxPaths?: number | string;
  maxDepth?: number | string;
  maxExplored?: number | string;
  limit?: number | string;
  selectedIds?: Iterable<string>;
  selectedFiles?: Iterable<string>;
  kind?: string;
  status?: string;
  origin?: string;
  path?: string;
  relatedTo?: string;
  usedBy?: string;
  dependsOn?: string;
  affectedBy?: string;
  staleAffectedBy?: string;
  frontierOf?: string;
  direct?: boolean;
  reverse?: boolean;
  cycleParticipant?: boolean;
  allowErrors?: boolean;
}

export interface CompilationSummary {
  files: number;
  results: number;
  proofs?: number;
  errors: number;
  warnings: number;
  statuses?: Record<string, number>;
  kinds?: Record<string, number>;
  goals?: Array<{ id: string; status: string; file: string; line?: number }>;
}

export interface Compilation {
  root: string;
  config: QmdProverConfig;
  manifest: Manifest;
  graph: DependencyGraph;
  diagnostics: Diagnostic[];
  summary: CompilationSummary;
  ok: boolean;
  complete: boolean;
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

export interface VerifierPacketInput {
  target: JsonObject;
  dependencies?: JsonObject[];
  externalBasis?: JsonObject | null;
  scope?: unknown;
  config?: QmdProverConfig | JsonObject;
}

export interface VerifierTarget extends JsonObject {
  id: string;
  kind: string;
  semantic_text: string;
  proof: string;
  cited_dependencies: string[];
  identity: { statement_hash: string; proof_hash: string };
  source: { file: string };
  verification_mode: VerificationMode;
}

export interface VerifierPacket extends JsonObject {
  schema_version: number;
  checker_contract: JsonObject;
  target: VerifierTarget;
  dependencies: JsonObject[];
  external_basis: JsonObject;
  scope: unknown;
}

export interface AiCheck {
  status: 'pass' | 'fail' | 'error' | 'not-run';
  source?: string;
  reason?: string;
  cached?: boolean;
  attempted?: boolean;
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
  submission_id?: string;
  decision_id?: string;
}

export interface StalenessChange {
  id: string;
  reasons: string[];
  previous?: unknown;
  current?: unknown;
}

export interface StalenessInvalidation { id: string; path: string[]; reasons?: unknown }

export interface StalenessReport extends OperationResult {
  schema_version: number;
  operation: string;
  ok: boolean;
  changed: StalenessChange[];
  invalidated: StalenessInvalidation[];
  snapshot_id?: string;
}

export interface InspectionVerificationSummary {
  available: boolean;
  eligible: number;
  verifier_calls: number;
  cache_hits: number;
  cache_misses: number;
  invalid_cache_entries: number;
  local_verified: number;
  local_disproved: number;
  local_rejected: number;
  local_errors: number;
  local_not_run: number;
  global_verified: number;
  global_disproved: number;
  global_blocked: number;
  global_unverified: number;
  global_rejected: number;
  global_invalid: number;
  stopped_after?: string | null;
}

export interface FactInspectionCheck {
  id: string;
  status: string;
  kind?: ResultKind;
  file?: string;
  line?: number;
  mechanical: {
    status: 'pass' | 'fail';
    verification_mode?: VerificationMode;
    references: ReferenceCheck[];
    diagnostics?: string[];
    reason?: string;
  };
  local_verification: AiCheck;
  global_verification: GlobalVerification;
  diagnostics: Diagnostic[];
}

export interface GraphFindings {
  definitions: Record<'isolated' | 'unreachable' | 'candidate_ready_for_ai' | 'heavily_reused', string>;
  unused_imports: Array<{ file: string; from: string; imported_file: string; id: string }>;
  unused_exports: Array<{ id: string; export: string | null | undefined; file: string; line?: number }>;
  isolated_facts: GraphNode[];
  unreachable: { applicable: boolean; roots: string[]; facts: GraphNode[] };
  invalid_evidence_dependents: Array<{ fact: GraphNode; invalid_sources: string[] }>;
  candidate_ready_for_ai: GraphNode[];
  heavily_reused: Array<{ fact: GraphNode; direct_dependents: number; transitive_dependents: number; verified_dependents: number }>;
}

/** Stable CLI/API result. Individual operations refine the known fields they expose. */
export interface OperationResult {
  schema_version?: number;
  operation?: string;
  ok?: boolean;
  snapshot_id?: string;
  status?: string;
  snapshot_published?: boolean;
  render_command?: string;
  [key: string]: unknown;
}

export interface InspectProjectResult extends OperationResult {
  graph: DependencyGraph;
  facts: FactInspectionCheck[];
  verification: InspectionVerificationSummary;
  staleness: StalenessReport;
  diagnostics: Diagnostic[];
  findings: GraphFindings;
}

export interface InspectFactResult extends OperationResult {
  graph: DependencyGraph;
  fact: SemanticResult;
  check: FactInspectionCheck;
  verification: InspectionVerificationSummary;
  staleness: StalenessReport;
  diagnostics: Diagnostic[];
}

export interface InspectPathResult extends OperationResult {
  graph: DependencyGraph;
  facts: FactInspectionCheck[];
  verification: InspectionVerificationSummary;
  staleness: StalenessReport;
  diagnostics: Diagnostic[];
  findings: GraphFindings;
}

export interface DependencyAnalysisResult extends OperationResult {
  graph?: DependencyGraph;
  frontier?: Array<{ fact: GraphNode; path: string[] | null }>;
  direct?: GraphNode[];
  transitive?: GraphNode[];
  affected?: GraphNode[];
  matches?: GraphNode[];
  cycles?: string[][];
  path?: string[] | null;
  paths?: string[][];
  findings?: GraphFindings;
}

export interface RenderResult extends OperationResult {
  status: string;
  output?: string;
  graph?: string;
  report?: string;
  render_command?: string;
  summary: CompilationSummary;
  diagnostics?: Diagnostic[];
}

export interface ExistingProjectInventory {
  agents_md: boolean;
  external_policy: { path: string; mode: string };
  qmd_prover_state: boolean;
  quarto_configs: string[];
  qmd_file_count: number;
  qmd_files: string[];
}

export interface InitializeProjectResult extends OperationResult {
  status: string;
  contract_version: number;
  path: string;
  existing?: ExistingProjectInventory;
}
