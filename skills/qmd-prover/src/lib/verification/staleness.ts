import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { compileProject } from '../semantic/compiler.js';
import { externalPolicyHash, readExternalPolicy } from '../infrastructure/external.js';
import { appendEvent, atomicJson, atomicWrite, AUX, readJson, sha256, stableJson, withWriteLock } from '../infrastructure/files.js';
import { setFactMarker } from '../semantic/source.js';
import { checkerContract } from './protocol.js';
import { asRecord } from '../shared/core.js';
import type { JsonObject, RuntimeOptions, SemanticResult, StalenessChange, StalenessReport } from '../shared/types.js';

function reverseAdjacency(results: SemanticResult[]): Map<string, string[]> {
  const reverse = new Map<string, string[]>(results.map((result) => [result.id, []]));
  for (const result of results) {
    for (const dependency of result.dependencies) {
      if (!reverse.has(dependency)) reverse.set(dependency, []);
      reverse.get(dependency)?.push(result.id);
    }
  }
  for (const values of reverse.values()) values.sort();
  return reverse;
}

function dependentPaths(results: SemanticResult[], roots: string[]): Map<string, string[]> {
  const reverse = reverseAdjacency(results);
  const paths = new Map<string, string[]>(roots.map((id) => [id, [id]]));
  const queue = [...roots].sort();
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    for (const dependent of reverse.get(current) ?? []) {
      const candidate = [...(paths.get(current) ?? [current]), dependent];
      const existing = paths.get(dependent);
      if (!existing || candidate.length < existing.length || candidate.join('\0').localeCompare(existing.join('\0')) < 0) {
        paths.set(dependent, candidate);
        queue.push(dependent);
      }
    }
  }
  return paths;
}

function evidenceFile(root: string, relative: unknown): string | null {
  if (typeof relative !== 'string') return null;
  const verificationRoot = path.join(root, AUX, 'verification');
  const absolute = path.resolve(root, relative);
  return absolute.startsWith(`${verificationRoot}${path.sep}`) ? absolute : null;
}

async function readEvidence(root: string, relative: unknown): Promise<JsonObject | null> {
  const absolute = evidenceFile(root, relative);
  if (!absolute) return null;
  try { return await readJson(absolute); } catch { return null; }
}

export async function checkStaleness(root = process.cwd(), options: RuntimeOptions = {}): Promise<StalenessReport> {
  root = path.resolve(root);
  return withWriteLock(root, async () => {
    const compilation = await compileProject(root, { ...options, write: false });
    if (!compilation.complete) throw new Error('Cannot check staleness while QMD parsing fails');
    const indexFile = path.join(root, AUX, 'verification', 'index.json');
    const index = await readJson<Record<string, JsonObject>>(indexFile, {});
    const results = new Map<string, SemanticResult>(compilation.manifest.results.map((result) => [result.id, result]));
    const files = new Map(compilation.manifest.files.map((file) => [file.path, file]));
    const currentExternalBasisHash = externalPolicyHash(await readExternalPolicy(root));
    const currentCheckerContract = checkerContract(compilation.config);
    const changed: StalenessChange[] = [];
    const dependencyRoots = new Map<string, JsonObject>();

    for (const [id, entry] of Object.entries(index).sort(([left], [right]) => left.localeCompare(right))) {
      if (entry.status !== 'verified') continue;
      const result = results.get(id);
      const reasons: string[] = [];
      if (!result) reasons.push('fact-missing');
      else {
        if (result.statement_hash !== entry.statement_hash) reasons.push('statement-changed');
        if (result.title_hash !== entry.title_hash) reasons.push('title-changed');
        if (result.kind !== entry.kind) reasons.push('kind-changed');
        if (result.proof_hash !== entry.proof_hash) reasons.push('proof-changed');
        if (result.marker !== 'VERIFIED') reasons.push('verified-marker-missing');
        const currentDependencySnapshot = Object.fromEntries(result.dependencies.map((dependency) => {
          const item = results.get(dependency);
          return [dependency, item ? sha256(`${item.statement_hash}:${item.proof_hash}:${item.status}`) : null];
        }));
        const previousDependencies = asRecord(entry.dependency_snapshot);
        const previousIds = Object.keys(previousDependencies).sort();
        const currentIds = Object.keys(currentDependencySnapshot).sort();
        if (stableJson(previousIds, 0) !== stableJson(currentIds, 0)) reasons.push('dependency-edge-set-changed');
        else {
          for (const dependency of currentIds) {
            if (currentDependencySnapshot[dependency] !== previousDependencies[dependency]) dependencyRoots.set(dependency, {
              previous_identity: previousDependencies[dependency],
              current_identity: currentDependencySnapshot[dependency]
            });
          }
        }
      }
      const record = await readEvidence(root, entry.record);
      if (!record || record.accepted !== true || record.submission_id !== entry.submission_id || record.statement_hash !== entry.statement_hash || record.title_hash !== entry.title_hash || record.kind !== entry.kind || record.proof_hash !== entry.proof_hash || record.external_basis_hash !== entry.external_basis_hash || record.verification_key !== entry.verification_key || stableJson(record.checker_contract ?? {}, 0) !== stableJson(entry.checker_contract ?? {}, 0)) reasons.push('verification-record-invalid');
      const cache = await readEvidence(root, entry.cache);
      if (!cache || cache.id !== id || cache.statement_hash !== entry.statement_hash || cache.title_hash !== entry.title_hash || cache.kind !== entry.kind || cache.proof_hash !== entry.proof_hash || stableJson(cache.dependency_snapshot ?? {}, 0) !== stableJson(entry.dependency_snapshot ?? {}, 0) || cache.external_basis_hash !== entry.external_basis_hash || cache.verification_key !== entry.verification_key || stableJson(cache.checker_contract ?? {}, 0) !== stableJson(entry.checker_contract ?? {}, 0)) reasons.push('verification-cache-invalid');
      if (result && cache && stableJson(cache.scope ?? [], 0) !== stableJson(files.get(result.file)?.imports ?? [], 0)) reasons.push('scope-changed');
      if (result && cache && asRecord(cache.source).file !== result.file) reasons.push('source-association-changed');
      if (cache && stableJson(cache.checker_contract ?? {
        backend: asRecord(cache.verification).backend,
        model: asRecord(cache.verification).model
      }, 0) !== stableJson(currentCheckerContract, 0)) reasons.push('checker-contract-changed');
      if (entry.external_basis_hash !== currentExternalBasisHash) reasons.push('external-basis-changed');
      if (reasons.length) {
        const currentDependencies = result ? Object.fromEntries(result.dependencies.map((dependency) => {
          const item = results.get(dependency);
          return [dependency, item ? sha256(`${item.statement_hash}:${item.proof_hash}:${item.status}`) : null];
        })) : null;
        changed.push({
          id,
          reasons: [...new Set(reasons)].sort(),
          previous: {
            statement_hash: entry.statement_hash,
            title_hash: entry.title_hash,
            kind: entry.kind,
            proof_hash: entry.proof_hash,
            source_file: asRecord(cache?.source).file ?? null,
            dependency_snapshot: entry.dependency_snapshot ?? {},
            scope: cache?.scope ?? [],
            checker_contract: entry.checker_contract ?? cache?.checker_contract ?? null,
            external_basis_hash: entry.external_basis_hash ?? null
          },
          current: result ? {
            statement_hash: result.statement_hash,
            title_hash: result.title_hash,
            kind: result.kind,
            proof_hash: result.proof_hash,
            source_file: result.file,
            dependencies: currentDependencies,
            scope: files.get(result.file)?.imports ?? [],
            checker_contract: currentCheckerContract,
            external_basis_hash: currentExternalBasisHash
          } : null
        });
      }
    }

    const changedIds = new Set(changed.map((item) => item.id));
    for (const result of compilation.manifest.results) {
      if (result.marker !== 'VERIFIED' || result.status === 'verified' || index[result.id]?.status === 'verified' || changedIds.has(result.id)) continue;
      changed.push({
        id: result.id,
        reasons: ['verified-marker-without-current-record'],
        previous: { marker: 'VERIFIED', record_status: index[result.id]?.status ?? null },
        current: {
          statement_hash: result.statement_hash,
          proof_hash: result.proof_hash,
          source_file: result.file,
          status: result.status
        }
      });
      changedIds.add(result.id);
    }

    const directlyChanged = new Set(changed.map((item) => item.id));
    for (const [id, identity] of [...dependencyRoots].sort(([left], [right]) => left.localeCompare(right))) {
      if (directlyChanged.has(id)) continue;
      const result = results.get(id);
      changed.push({
        id,
        reasons: [result ? 'dependency-identity-or-status-changed' : 'fact-missing'],
        previous: { identity: identity.previous_identity },
        current: result ? {
          identity: identity.current_identity,
          statement_hash: result.statement_hash,
          proof_hash: result.proof_hash,
          status: result.status,
          source_file: result.file
        } : null
      });
    }
    changed.sort((left, right) => left.id.localeCompare(right.id));

    if (changed.length === 0) {
      return { schema_version: 2, operation: 'check-staleness', ok: true, changed: [], invalidated: [], snapshot_id: compilation.graph.snapshot_id };
    }

    const paths = dependentPaths(compilation.manifest.results, changed.map((item) => item.id));
    const affected = [...paths.keys()].filter((id) => index[id]?.status === 'verified' || results.get(id)?.marker === 'VERIFIED').sort();
    const previousIndex = structuredClone(index);
    const sourceFiles = new Map<string, { original: string; next: string }>();
    const evidenceFiles = new Map<string, { original: string; next: JsonObject }>();
    const now = new Date().toISOString();
    try {
      for (const id of affected) {
        const result = results.get(id);
        if (result?.marker === 'VERIFIED') {
          const file = path.join(root, result.file);
          if (!sourceFiles.has(file)) {
            const original = await readFile(file, 'utf8');
            sourceFiles.set(file, { original, next: original });
          }
          const source = sourceFiles.get(file);
          if (!source) throw new Error(`Could not stage source file ${file}`);
          source.next = setFactMarker(source.next, id, result.kind, null);
        }
        const pathToId = paths.get(id) ?? [id];
        const reason = changed.find((item) => item.id === id)?.reasons ?? [`depends-on-stale:${pathToId[0] ?? id}`];
        index[id] = { ...index[id], status: 'stale', stale_at: now, stale_reason: reason, invalidation_path: paths.get(id) };
        for (const evidencePath of [evidenceFile(root, index[id].record), evidenceFile(root, index[id].cache)].filter((value): value is string => Boolean(value))) {
          try {
            const original = await readFile(evidencePath, 'utf8');
            const parsed = JSON.parse(original);
            evidenceFiles.set(evidencePath, { original, next: { ...parsed, stale: true, stale_at: now, stale_reason: reason, invalidation_path: paths.get(id) } });
          } catch { /* Missing or corrupt evidence is already a staleness reason. */ }
        }
      }
      for (const [file, source] of sourceFiles) await atomicWrite(file, source.next);
      for (const [file, evidence] of evidenceFiles) await atomicJson(file, evidence.next);
      await atomicJson(indexFile, index);
      const rebuilt = await compileProject(root, options);
      if (!rebuilt.complete) throw new Error('Post-invalidation inspection could not rebuild a complete graph');
      await appendEvent(root, { type: 'verification-stale', changed: changed.map((item) => item.id), invalidated: affected });
      return {
        schema_version: 2,
        operation: 'check-staleness',
        ok: true,
        changed,
        invalidated: affected.map((id) => ({ id, path: paths.get(id) ?? [id], reasons: index[id]?.stale_reason })),
        snapshot_id: rebuilt.graph.snapshot_id
      };
    } catch (error) {
      for (const [file, source] of sourceFiles) await atomicWrite(file, source.original);
      for (const [file, evidence] of evidenceFiles) await atomicWrite(file, evidence.original);
      await atomicJson(indexFile, previousIndex);
      await compileProject(root, options);
      throw error;
    }
  });
}
