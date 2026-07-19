import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { compileProject } from '../../core/semantic/compiler.js';
import { resolveProjectSnapshot } from '../../core/graph/snapshot.js';
import { externalPolicyHash } from '../../core/infrastructure/external.js';
import { readJson, stableJson } from '../../core/infrastructure/files.js';
import { auxLayout } from '../../core/infrastructure/aux.js';
import { SCHEMA_VERSION, hasErrorCode, isRecord } from '../../core/shared/core.js';
import { checkerContract, verificationContext, verificationOutcome } from '../../core/verification/protocol.js';
import type { JsonObject, CompilerOptions } from '../../core/shared/types.js';
import type { VerifierPacket } from '../../core/verification/protocol.js';
import type { VerifierReport } from '../../core/shared/verdicts.js';
import type { StalenessChange, StalenessReport } from '../../core/shared/results.js';

// The `check staleness` command: audit the on-disk verification cache against the
// current sources, external basis, and checker contract without mutating any QMD.
// Its result shape (StalenessReport) lives in core/shared/results so `inspect` can
// embed it and the CLI output layer can render it.

// One cache record on disk, reduced to how it bears on its target's staleness.
interface StalenessCandidate { reasons: Set<string>; matchesSource: boolean; verifiedAt: string }

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

export async function checkStaleness(root = process.cwd(), options: CompilerOptions = {}): Promise<StalenessReport> {
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

  // Each cache file is named after its verification key, so editing a proof (or the
  // checker contract, or the external basis) and re-verifying writes a fresh file while
  // the superseded one lingers on disk. Collect every record under its target, then judge
  // the target from a single representative — one that still matches the current source,
  // and among those the most recently verified — so an obsolete leftover cannot make a
  // result that already has a valid current cache entry look stale.
  const candidatesByTarget = new Map<string, StalenessCandidate[]>();
  const addCandidate = (target: string, candidate: StalenessCandidate): void => {
    const list = candidatesByTarget.get(target) ?? [];
    list.push(candidate);
    candidatesByTarget.set(target, list);
  };

  for (const file of await jsonFiles(auxLayout(root).checks)) {
    let record: JsonObject;
    try { record = await readJson<JsonObject>(file); }
    catch { addCandidate(path.basename(file, '.json'), { reasons: new Set(['cache-invalid']), matchesSource: false, verifiedAt: '' }); continue; }
    const target = typeof record.target === 'string' ? record.target : path.basename(file, '.json');
    const reasons = new Set<string>();
    if (!isRecord(record.report) || !isRecord(record.packet) || !isRecord(record.packet.target)) {
      reasons.add('cache-invalid');
    } else {
      const outcome = verificationOutcome(record.report as Partial<VerifierReport>, record.packet as VerifierPacket);
      if (record.outcome !== outcome || record.accepted !== (outcome !== 'rejected')) reasons.add('cache-invalid');
    }
    if (record.external_basis_hash !== externalHash) reasons.add('external-basis-changed');
    if (stableJson(record.checker_contract ?? {}, 0) !== stableJson(contract, 0)) reasons.add('checker-contract-changed');
    const current = resultById.get(target);
    const matchesSource = !!current && record.statement_hash === current.statement_hash && record.proof_hash === current.proof_hash;
    if (!matchesSource) reasons.add('source-changed');
    const dependencySnapshot = isRecord(record.dependency_snapshot) ? record.dependency_snapshot : {};
    for (const [dependencyId, saved] of Object.entries(dependencySnapshot)) {
      const dependency = resultById.get(dependencyId);
      const identity = isRecord(saved) && isRecord(saved.identity) ? saved.identity : {};
      if (!dependency || identity.statement_hash !== dependency.statement_hash) reasons.add('dependency-context-changed');
    }
    addCandidate(target, { reasons, matchesSource, verifiedAt: typeof record.verified_at === 'string' ? record.verified_at : '' });
  }

  for (const [target, candidates] of candidatesByTarget) {
    // Prefer records still matching the current source; if none do, the target has no
    // current cache entry, so its newest record carries the genuine source-changed signal.
    const pool = candidates.some((candidate) => candidate.matchesSource) ? candidates.filter((candidate) => candidate.matchesSource) : candidates;
    const chosen = pool.reduce((best, candidate) => (candidate.verifiedAt >= best.verifiedAt ? candidate : best));
    for (const reason of chosen.reasons) flag(target, reason);
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
