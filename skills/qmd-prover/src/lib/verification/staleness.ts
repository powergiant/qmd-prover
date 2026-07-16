import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { compileProject } from '../semantic/compiler.js';
import { resolveProjectSnapshot } from '../inspection/snapshot.js';
import { externalPolicyHash } from '../infrastructure/external.js';
import { AUX, readJson, stableJson } from '../infrastructure/files.js';
import { SCHEMA_VERSION, hasErrorCode, isRecord } from '../shared/core.js';
import { checkerContract, verificationContext, verificationOutcome } from './protocol.js';
import type { JsonObject, OperationResult, RuntimeOptions } from '../shared/types.js';
import type { VerifierPacket, VerifierReport } from './protocol.js';

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

async function jsonFiles(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(directory, entry.name))
      .sort();
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return [];
    throw error;
  }
}

export async function checkStaleness(root = process.cwd(), options: RuntimeOptions = {}): Promise<StalenessReport> {
  root = path.resolve(root);
  const compilation = await compileProject(root, { ...options, write: false });
  const context = await verificationContext(compilation);
  // Report the same graph snapshot identity the inspect/dependency commands use,
  // so a caller can correlate a staleness audit with the graph it audited.
  const snapshot = await resolveProjectSnapshot(compilation, context.contextHash, { ...options, write: false });
  const externalHash = externalPolicyHash(context.externalBasis);
  const contract = checkerContract(compilation.config);
  const resultById = new Map(compilation.manifest.results.map((result) => [result.id, result]));
  const reasonsByTarget = new Map<string, Set<string>>();
  const flag = (target: string, reason: string): void => {
    const reasons = reasonsByTarget.get(target) ?? new Set<string>();
    reasons.add(reason);
    reasonsByTarget.set(target, reasons);
  };

  for (const file of await jsonFiles(path.join(root, AUX, 'verification', 'checks'))) {
    let record: JsonObject;
    try { record = await readJson<JsonObject>(file); }
    catch { flag(path.basename(file, '.json'), 'cache-invalid'); continue; }
    const target = typeof record.target === 'string' ? record.target : path.basename(file, '.json');
    if (!isRecord(record.report) || !isRecord(record.packet) || !isRecord(record.packet.target)) {
      flag(target, 'cache-invalid');
    } else {
      const outcome = verificationOutcome(record.report as Partial<VerifierReport>, record.packet as VerifierPacket);
      if (record.outcome !== outcome || record.accepted !== (outcome !== 'rejected')) flag(target, 'cache-invalid');
    }
    if (record.external_basis_hash !== externalHash) flag(target, 'external-basis-changed');
    if (stableJson(record.checker_contract ?? {}, 0) !== stableJson(contract, 0)) flag(target, 'checker-contract-changed');
    const current = resultById.get(target);
    if (!current || record.statement_hash !== current.statement_hash || record.proof_hash !== current.proof_hash) flag(target, 'source-changed');
    const dependencySnapshot = isRecord(record.dependency_snapshot) ? record.dependency_snapshot : {};
    for (const [dependencyId, saved] of Object.entries(dependencySnapshot)) {
      const dependency = resultById.get(dependencyId);
      const identity = isRecord(saved) && isRecord(saved.identity) ? saved.identity : {};
      if (!dependency || identity.statement_hash !== dependency.statement_hash) flag(target, 'dependency-context-changed');
    }
  }

  const changed: StalenessChange[] = [...reasonsByTarget].map(([id, reasons]) => ({
    id,
    reasons: [...reasons].sort(),
    current: {
      status: resultById.get(id)?.status ?? 'missing',
      external_basis_hash: externalHash,
      checker_contract: contract
    }
  })).sort((left, right) => left.id.localeCompare(right.id));
  return {
    schema_version: SCHEMA_VERSION,
    operation: 'check-staleness',
    ok: compilation.complete && changed.every((item) => !item.reasons.includes('cache-invalid')),
    changed,
    invalidated: changed.map((item) => ({ id: item.id, path: [item.id], reasons: item.reasons })),
    snapshot_id: snapshot.snapshot_id
  };
}
