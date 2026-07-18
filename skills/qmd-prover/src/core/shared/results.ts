// Result DTOs shared across more than one command. The staleness report is
// produced by `check` but also embedded (as a placeholder) by `inspect` and
// rendered by the CLI output layer, so its shape lives in core where every
// command may name it without importing another command.
import type { OperationResult } from './types.js';

export interface StalenessChange {
  id: string;
  reasons: string[];
  current?: unknown;
}

export interface StalenessInvalidation {
  id: string;
  path: string[];
  reasons?: unknown;
}

export interface StalenessReport extends OperationResult {
  schema_version: number;
  operation: string;
  ok: boolean;
  changed: StalenessChange[];
  invalidated: StalenessInvalidation[];
  snapshot_id?: string;
}
