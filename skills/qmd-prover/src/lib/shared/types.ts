/**
 * Cross-cutting contracts shared by every layer. Domain types live with the code
 * that owns them — the semantic model in `semantic/`, verification verdicts in
 * `verification/`, config in `infrastructure/config.ts`, and so on. Only the
 * genuinely universal vocabulary (JSON values, diagnostics, the operation-result
 * envelope, and the options bag threaded through the pipeline) belongs here.
 */

/** JSON-compatible values persisted by qmd-prover's stable output protocol. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Untrusted object read from JSON, YAML, Pandoc, or a verifier process. */
export type UnknownRecord = Record<string, unknown>;
export type JsonObject = UnknownRecord;

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
}

/** Stable CLI/API result. Individual operations refine the known fields they expose. */
export interface OperationResult {
  schema_version?: number;
  operation?: string;
  ok?: boolean;
  snapshot_id?: string;
  status?: string;
  snapshot_published?: boolean;
  [key: string]: unknown;
}

export interface CompilerOptions {
  pandoc?: string;
  write?: boolean;
  files?: string[];
  excludeFiles?: string[];
  protectStatements?: boolean;
}

/** The option bag threaded through compilation, inspection, and dependency analysis. */
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
