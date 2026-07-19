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

/**
 * The options each pipeline stage consumes are split by responsibility rather than
 * pooled in one bag: a function's signature names exactly the cluster it reads, and
 * a caller composes the clusters it needs with `&`. Only the CLI boundary (parse.ts,
 * run.ts) handles the full `CliOptions` union.
 */

/** Inputs to compilation: which sources to read and how to emit. */
export interface CompilerOptions {
  pandoc?: string;
  write?: boolean;
  files?: string[];
  excludeFiles?: string[];
  protectStatements?: boolean;
}

/** Bounds for dependency-graph path search. */
export interface PathSearchOptions {
  maxPaths?: number | string;
  maxDepth?: number | string;
  maxExplored?: number | string;
}

/** Narrows an operation to a subset of facts/files, resolved from the CLI query. */
export interface SelectionOptions {
  selectedIds?: Iterable<string>;
  selectedFiles?: Iterable<string>;
}

/** Tolerate a failed compile instead of aborting — render only. */
export interface RenderOptions {
  allowErrors?: boolean;
}

/** Raw CLI query for the dependency command: attribute facets plus graph traversals. */
export interface DependencyQuery {
  limit?: number | string;
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

/** The full option surface the CLI parser can produce; only the CLI layer sees this. */
export type CliOptions = CompilerOptions & PathSearchOptions & SelectionOptions & RenderOptions & DependencyQuery;
