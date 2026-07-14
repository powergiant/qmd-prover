import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { externalPolicyHash } from '../infrastructure/external.js';
import { AUX, cleanId, readJson, relativePosix, sha256, stableJson } from '../infrastructure/files.js';
import { accepted, checkerContract, verifierErrorDetails } from '../verification/protocol.js';
import {
  asErrorLike, asRecord, asStringArray, CONTROL_MARKER_SET, hasErrorCode, isRecord
} from '../shared/core.js';
import type {
  AiCheck, Compilation, ImportDeclaration, JsonObject, ReferenceCheck, SemanticResult, UnknownRecord,
  VerifierPacket, VerifierReport
} from '../shared/types.js';

export interface WorkspaceMetadata {
  schema_version: number;
  target: string;
  status: string;
  created_at: string;
  canonical: {
    file: string;
    statement_hash: string;
    title_hash: string;
    proof_hash: string;
    status: string;
    dependencies: Record<string, { statement_hash: string; proof_hash: string; status: string }>;
  };
}

export interface WorkspaceReferenceCheck extends ReferenceCheck { origin: 'workspace' | 'main-goal' | 'unresolved' }
export interface WorkspaceProgrammaticCheck {
  status: 'pass' | 'fail';
  verification_mode: 'definition-construction' | 'proof';
  references: WorkspaceReferenceCheck[];
  diagnostics: string[];
  reason?: string;
}
export interface WorkspaceOutcome extends AiCheck {
  verification_key?: string;
  failed_target?: string;
  failure_report?: string;
}
export interface WorkspaceVerification {
  eligible: number;
  verifier_calls: number;
  cache_hits: number;
  cache_misses: number;
  invalid_cache_entries: number;
  passed: number;
  rejected: number;
  errors: number;
  not_run: number;
  stopped_after: string | null;
  facts: Array<{ id: string } & WorkspaceOutcome>;
}
interface WorkspaceCacheRecord extends JsonObject {
  workspace: string;
  target: string;
  verification_key: string;
  packet_hash: string;
  checker_contract: JsonObject;
  report: VerifierReport;
  accepted: boolean;
}
interface WorkspaceCacheLookup {
  location: { relative: string; file: string };
  record: WorkspaceCacheRecord | null;
  invalid: boolean;
}

export function cleanVerifierText(value: unknown, markerPosition: 'first' | 'last' | null = null): string {
  const lines = String(value ?? '').split(/\r?\n/);
  if (markerPosition === 'first') {
    const index = lines.findIndex((line) => line.trim() !== '');
    if (index >= 0 && CONTROL_MARKER_SET.has(lines[index].trim())) lines.splice(index, 1);
  } else if (markerPosition === 'last') {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (!lines[index].trim()) continue;
      if (CONTROL_MARKER_SET.has(lines[index].trim())) lines.splice(index, 1);
      break;
    }
  }
  return lines.join('\n').trim();
}

export function workspaceStatus(result: SemanticResult, marker = result.marker): string {
  if (marker === 'OPEN') return 'workspace-open';
  if (marker === 'REJECTED') return 'workspace-rejected';
  if (marker === 'REVOKED') return 'workspace-revoked';
  return result.kind === 'definition' || result.proof_present
    ? 'workspace-candidate'
    : 'workspace-open';
}

export function normalizeImports(imports: ImportDeclaration[] = []): ImportDeclaration[] {
  return imports.map((item) => ({
    from: String(item.from ?? ''),
    use: [...new Set((item.use ?? []).map(String))].sort()
  })).sort((left, right) => `${left.from}:${left.use.join(',')}`.localeCompare(`${right.from}:${right.use.join(',')}`));
}

export function topologicalOrder(results: SemanticResult[]): SemanticResult[] {
  const ids = new Set<string>(results.map((result) => result.id));
  const byId = new Map<string, SemanticResult>(results.map((result) => [result.id, result]));
  const pending = new Map<string, Set<string>>(results.map((result) => [
    result.id,
    new Set(result.dependencies.filter((dependency) => ids.has(dependency)))
  ]));
  const dependents = new Map<string, string[]>(results.map((result) => [result.id, []]));
  for (const result of results) {
    for (const dependency of pending.get(result.id) ?? []) dependents.get(dependency)?.push(result.id);
  }
  for (const values of dependents.values()) values.sort();
  const ready = [...pending].filter(([, dependencies]) => dependencies.size === 0).map(([id]) => id).sort();
  const scheduled = new Set<string>(ready);
  const ordered: SemanticResult[] = [];
  while (ready.length) {
    const id = ready.shift();
    if (!id) continue;
    const selected = byId.get(id);
    if (!selected) continue;
    ordered.push(selected);
    for (const dependent of dependents.get(id) ?? []) {
      pending.get(dependent)?.delete(id);
      if (pending.get(dependent)?.size === 0 && !scheduled.has(dependent)) {
        ready.push(dependent);
        scheduled.add(dependent);
        ready.sort();
      }
    }
  }
  const seen = new Set(ordered.map((result) => result.id));
  ordered.push(...results.filter((result) => !seen.has(result.id)).sort((left, right) => left.id.localeCompare(right.id)));
  return ordered;
}

function cacheLocation(directory: string, key: string): { relative: string; file: string } {
  const digest = key.replace(/^sha256:/, '');
  return {
    relative: `verification/checks/${digest}.json`,
    file: path.join(directory, 'verification', 'checks', `${digest}.json`)
  };
}

function verifierReport(value: unknown): VerifierReport | null {
  if (!isRecord(value) || (value.verdict !== 'correct' && value.verdict !== 'incorrect')) return null;
  return {
    verdict: value.verdict,
    summary: typeof value.summary === 'string' ? value.summary : '',
    critical_errors: asStringArray(value.critical_errors),
    gaps: asStringArray(value.gaps),
    nonblocking_comments: asStringArray(value.nonblocking_comments),
    repair_hints: typeof value.repair_hints === 'string' ? value.repair_hints : ''
  };
}

export async function cachedWorkspaceDecision(directory: string, workspace: string, target: string, key: string, packet: VerifierPacket): Promise<WorkspaceCacheLookup> {
  const location = cacheLocation(directory, key);
  let record: UnknownRecord;
  try { record = await readJson<UnknownRecord>(location.file); } catch (error) {
    return { location, record: null, invalid: !hasErrorCode(error, 'ENOENT') };
  }
  const report = verifierReport(record.report);
  if (!report || typeof record.accepted !== 'boolean') return { location, record: null, invalid: true };
  const valid = record.workspace === workspace
    && record?.target === target
    && record?.verification_key === key
    && record?.packet_hash === sha256(stableJson(packet, 0))
    && stableJson(record?.checker_contract ?? {}, 0) === stableJson(packet.checker_contract ?? {}, 0)
    && record.accepted === accepted(report);
  const cached: WorkspaceCacheRecord | null = valid && report ? {
    ...record,
    workspace,
    target,
    verification_key: key,
    packet_hash: String(record.packet_hash),
    checker_contract: asRecord(record.checker_contract),
    report,
    accepted: record.accepted
  } : null;
  return { location, record: cached, invalid: !valid };
}

export async function workspaceSourceFingerprint(directory: string): Promise<string> {
  const files = await discoverActive(directory);
  const entries: Array<[string, string]> = [];
  for (const file of files) entries.push([relativePosix(directory, file), sha256(await readFile(file, 'utf8'))]);
  return sha256(stableJson(entries, 0));
}

export function protectedGoalContextFingerprint(compilation: Compilation, target: string, externalBasis: JsonObject): string {
  const byId = new Map<string, SemanticResult>(compilation.manifest.results.map((result) => [result.id, result]));
  const result = byId.get(target);
  return sha256(stableJson({
    complete: compilation.complete,
    target: result ? {
      id: target, statement_hash: result.statement_hash, proof_hash: result.proof_hash,
      title_hash: result.title_hash, status: result.status, file: result.file
    } : { id: target, status: 'missing' },
    checker_contract: checkerContract(compilation.config),
    external_basis_hash: externalPolicyHash(externalBasis)
  }, 0));
}

export function workspaceSnapshotSourceSignature(
  workspaceFingerprint: string,
  metadata: WorkspaceMetadata,
  target: SemanticResult | undefined,
  contextHash: string
): string {
  return sha256(stableJson({
    workspace_fingerprint: workspaceFingerprint,
    protected_snapshot: metadata.canonical,
    current_target: target ? {
      id: target.id,
      file: target.file,
      statement_hash: target.statement_hash,
      title_hash: target.title_hash,
      proof_hash: target.proof_hash,
      status: target.status
    } : { id: metadata.target, status: 'missing' },
    context_hash: contextHash
  }, 0));
}

export function verifierFailure(error: unknown, target: string, inherited = false): WorkspaceOutcome {
  const failure = asErrorLike(error);
  const details = inherited ? failure.details : verifierErrorDetails(error);
  return {
    status: 'error',
    code: String(failure.code ?? 'WORKSPACE_VERIFIER_FAILED'),
    error: inherited
      ? `Independent verification stopped after the verifier command failed while checking @${target}`
      : failure.message,
    remediation: 'Repair verification.command or QMD_PROVER_VERIFIER, then rerun workspace inspect. The workspace fact remains unverified; never add VERIFIED manually.',
    ...(isRecord(details) ? { details } : {}),
    fatal: true,
    ...(inherited ? { inherited: true, failed_target: target } : {})
  };
}

export async function discoverActive(directory: string, output: string[] = []): Promise<string[]> {
  const excluded = new Set(['attempts', 'dead-ends', 'proposals', 'verification', 'context', 'snapshots', 'generated', 'rendered', '_site']);
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith('.') || excluded.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await discoverActive(absolute, output);
    else if (entry.isFile() && entry.name.endsWith('.qmd') && !['target.qmd', 'progress.qmd'].includes(entry.name)) output.push(absolute);
  }
  return output;
}

export function workspaceDirectory(root: string, requested: string): { id: string; directory: string } {
  const id = cleanId(requested);
  if (!/^thm-main-[A-Za-z0-9._:-]+$/.test(id)) throw new Error('A goal workspace requires a thm-main-* ID');
  return { id, directory: path.join(path.resolve(root), AUX, 'workspaces', id) };
}
