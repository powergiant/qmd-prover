import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { buildProjectInspectionIndex } from '../inspection/index.js';
import { externalPolicyHash, readExternalPolicy } from '../infrastructure/external.js';
import { AUX, readJson, stableJson } from '../infrastructure/files.js';
import { hasErrorCode } from '../shared/core.js';
import { checkerContract } from './protocol.js';
import type { JsonObject, RuntimeOptions, StalenessChange, StalenessReport } from '../shared/types.js';

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
  const index = await buildProjectInspectionIndex(root, { ...options, write: false });
  const [externalBasis, legacyIndex] = await Promise.all([
    readExternalPolicy(root),
    readJson<Record<string, JsonObject>>(path.join(root, AUX, 'verification', 'index.json'), {})
  ]);
  const externalHash = externalPolicyHash(externalBasis);
  const contract = checkerContract(index.goalsCompilation.config);
  const changed: StalenessChange[] = [];

  for (const workspace of index.workspaces) {
    const reasons = new Set<string>();
    if (workspace.status === 'uninitialized') reasons.add('workspace-uninitialized');
    if (workspace.status === 'orphan') reasons.add('workspace-orphan');
    if (workspace.status === 'invalid') reasons.add('workspace-invalid');
    if (workspace.stale) reasons.add('main-goal-snapshot-changed');
    if (workspace.compilation?.complete === false) reasons.add('workspace-parse-incomplete');
    for (const file of await jsonFiles(path.join(workspace.directory, 'verification', 'checks'))) {
      let record: JsonObject;
      try { record = await readJson<JsonObject>(file); }
      catch { reasons.add('workspace-cache-invalid'); continue; }
      if (record.external_basis_hash !== externalHash) reasons.add('external-basis-changed');
      if (stableJson(record.checker_contract ?? {}, 0) !== stableJson(contract, 0)) reasons.add('checker-contract-changed');
      const target = workspace.compilation?.manifest.results.find((result) => result.id === record.target);
      if (target && (record.statement_hash !== target.statement_hash || record.proof_hash !== target.proof_hash)) reasons.add('workspace-source-changed');
      if (!target && record.target === workspace.id) {
        const goal = index.goals.find((result) => result.id === workspace.id);
        const proofs = workspace.compilation?.manifest.proofs.filter((proof) => proof.target === workspace.id) ?? [];
        const proof = proofs.length === 1 ? proofs[0] : null;
        if (!goal || record.statement_hash !== goal.statement_hash || record.proof_hash !== proof?.proof_hash) reasons.add('workspace-source-changed');
      }
    }
    if (reasons.size) changed.push({
      id: workspace.id,
      reasons: [...reasons].sort(),
      previous: workspace.metadata?.canonical ?? null,
      current: { status: workspace.status, stale: workspace.stale, files: workspace.files.length, external_basis_hash: externalHash, checker_contract: contract }
    });
  }

  for (const id of Object.keys(legacyIndex).sort()) changed.push({
    id,
    reasons: ['legacy-canonical-verification-record'],
    previous: legacyIndex[id],
    current: { status: 'legacy-read-only', remediation: 'Use workspace inspection; qmd-prover will not migrate, delete, or rewrite this record or its user-QMD marker.' }
  });
  changed.sort((left, right) => left.id.localeCompare(right.id));
  return {
    schema_version: 3,
    operation: 'check-staleness',
    ok: !index.fatal && index.goalsCompilation.complete && index.workspaces.every((workspace) => workspace.compilation?.complete !== false),
    changed,
    invalidated: changed.map((item) => ({ id: item.id, path: [item.id], reasons: item.reasons })),
    snapshot_id: index.goalsCompilation.graph.snapshot_id
  };
}
