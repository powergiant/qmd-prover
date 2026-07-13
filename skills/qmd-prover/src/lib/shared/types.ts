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
}

export type ResultKind = 'definition' | 'lemma' | 'theorem' | 'proposition' | 'corollary' | 'unknown';
export type CanonicalStatus = 'open' | 'candidate' | 'rejected' | 'verified' | 'revoked' | 'stale';
export type ResultOrigin = 'user' | 'agent' | 'workspace';
export type ControlMarker = 'OPEN' | 'REJECTED' | 'VERIFIED' | 'REVOKED';
export type CheckStatus = 'pass' | 'fail' | 'pending' | 'not-run' | 'not-applicable';

export interface ReferenceCheck {
  dependency: string;
  existence: CheckStatus;
  scope: CheckStatus;
  status: CheckStatus;
  cycle?: CheckStatus;
  ai_sufficiency?: CheckStatus;
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
  origin: ResultOrigin;
  workspace?: string;
}

export interface Manifest {
  schema_version: number;
  snapshot_id?: string;
  target?: string;
  files: SourceFileRecord[];
  results: SemanticResult[];
  proofs: ProofRecord[];
  stale?: boolean;
  canonical_results?: GraphNode[];
}

export interface GraphNode {
  id: string;
  status: string;
  kind?: ResultKind;
  title?: string;
  file?: string;
  line?: number;
  origin?: string;
  ownership?: string;
  scope?: 'selected' | 'external';
  workspace?: string;
  identity?: { statement_hash: string; proof_hash: string };
  ai?: { status: string };
}

export interface GraphEdgeChecks {
  existence: CheckStatus;
  scope: CheckStatus;
  status: CheckStatus;
  cycle?: CheckStatus;
  ai_sufficiency?: CheckStatus;
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
  externalTargets?: string[];
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
  verdict: 'correct' | 'incorrect';
  summary: string;
  critical_errors: string[];
  gaps: string[];
  nonblocking_comments: string[];
  repair_hints: string;
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
}

export interface VerifierPacket extends JsonObject {
  schema_version: number;
  checker_contract: JsonObject;
  target: VerifierTarget;
  dependencies: JsonObject[];
  external_basis: JsonObject;
  scope: unknown;
}

export interface ProgrammaticEligibility {
  ready: boolean;
  reason?: string;
  references?: ReferenceCheck[];
  diagnostics?: Diagnostic[];
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
  details?: {
    command?: string;
    exit_code?: number | null;
    signal?: string | null;
    stderr_excerpt?: string;
    stdout_excerpt?: string;
    [key: string]: unknown;
  };
  inherited?: boolean;
  programmatic?: ProgrammaticEligibility;
  submission_id?: string;
  decision_id?: string;
}

export interface VerifierDecisionLocation { id: string; relative: string; file: string }

export interface VerificationDecisionRecord extends JsonObject {
  submission_id: string;
  accepted: boolean;
  source: string;
  report: VerifierReport;
}

export interface VerifierDecisionLookup {
  location: VerifierDecisionLocation;
  record: VerificationDecisionRecord | null;
  invalid: boolean;
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
  eligible: number;
  verifier_calls: number;
  cache_hits: number;
  passed: number;
  rejected: number;
  errors: number;
  not_run: number;
}

export interface FactInspectionCheck {
  id: string;
  status: string;
  programmatic: { status: 'pass' | 'fail'; references: ReferenceCheck[] };
  ai: AiCheck;
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

export interface CanonicalScopeInspection {
  compilation: Compilation;
  selected: SemanticResult[];
  aiChecks: Map<string, AiCheck>;
  staleness: StalenessReport;
  diagnostics: Diagnostic[];
  verification: InspectionVerificationSummary;
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

export interface SubmissionResult extends OperationResult {
  submission_id?: string;
  proposal_id?: string;
  target: string;
  status: string;
  report?: VerifierReport;
}

export interface RenderResult extends OperationResult {
  status: string;
  output: string;
  graph: string;
  report: string;
  render_command: string;
  summary: CompilationSummary;
}

export interface InitializeWorkspaceResult extends OperationResult {
  status: string;
  workspace: string;
  metadata: unknown;
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
  workspace_root?: string;
}

export interface WorkspaceInspectResult extends OperationResult {
  stale: boolean;
  manifest: Manifest;
  graph: DependencyGraph;
  diagnostics: Diagnostic[];
  verification: {
    eligible: number;
    verifier_calls: number;
    cache_hits: number;
    cache_misses: number;
    invalid_cache_entries: number;
    passed: number;
    rejected: number;
    errors: number;
    not_run: number;
  };
  facts: Array<{
    id: string;
    kind: ResultKind;
    status: string;
    file: string;
    line?: number;
    ai: AiCheck;
  }>;
}
