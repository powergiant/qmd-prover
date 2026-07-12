import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { compileProject } from './compiler.mjs';
import { appendEvent, atomicJson, atomicWrite, AUX, readJson, stableJson, withWriteLock } from './files.mjs';
import { setProofMarker } from './source.mjs';

function reverseAdjacency(results) {
  const reverse = new Map(results.map((result) => [result.id, []]));
  for (const result of results) {
    for (const dependency of result.dependencies) {
      if (!reverse.has(dependency)) reverse.set(dependency, []);
      reverse.get(dependency).push(result.id);
    }
  }
  for (const values of reverse.values()) values.sort();
  return reverse;
}

function dependentPaths(results, roots) {
  const reverse = reverseAdjacency(results);
  const paths = new Map(roots.map((id) => [id, [id]]));
  const queue = [...roots].sort();
  while (queue.length) {
    const current = queue.shift();
    for (const dependent of reverse.get(current) ?? []) {
      const candidate = [...paths.get(current), dependent];
      const existing = paths.get(dependent);
      if (!existing || candidate.length < existing.length || candidate.join('\0').localeCompare(existing.join('\0')) < 0) {
        paths.set(dependent, candidate);
        queue.push(dependent);
      }
    }
  }
  return paths;
}

function evidenceFile(root, relative) {
  if (typeof relative !== 'string') return null;
  const verificationRoot = path.join(root, AUX, 'verification');
  const absolute = path.resolve(root, relative);
  return absolute.startsWith(`${verificationRoot}${path.sep}`) ? absolute : null;
}

async function readEvidence(root, relative) {
  const absolute = evidenceFile(root, relative);
  if (!absolute) return null;
  try { return await readJson(absolute); } catch { return null; }
}

export async function checkStaleness(root = process.cwd(), options = {}) {
  root = path.resolve(root);
  return withWriteLock(root, async () => {
    const compilation = await compileProject(root, { ...options, write: false });
    if (!compilation.complete) throw new Error('Cannot check staleness while QMD parsing fails');
    const indexFile = path.join(root, AUX, 'verification', 'index.json');
    const index = await readJson(indexFile, {});
    const results = new Map(compilation.manifest.results.map((result) => [result.id, result]));
    const files = new Map(compilation.manifest.files.map((file) => [file.path, file]));
    const changed = [];

    for (const [id, entry] of Object.entries(index).sort(([left], [right]) => left.localeCompare(right))) {
      if (entry.status !== 'verified') continue;
      const result = results.get(id);
      const reasons = [];
      if (!result) reasons.push('fact-missing');
      else {
        if (result.statement_hash !== entry.statement_hash) reasons.push('statement-changed');
        if (result.proof_hash !== entry.proof_hash) reasons.push('proof-changed');
        if (result.marker !== 'VERIFIED') reasons.push('verified-marker-missing');
      }
      const record = await readEvidence(root, entry.record);
      if (!record || record.accepted !== true || record.submission_id !== entry.submission_id || record.statement_hash !== entry.statement_hash || record.proof_hash !== entry.proof_hash) reasons.push('verification-record-invalid');
      const cache = await readEvidence(root, entry.cache);
      if (!cache || cache.id !== id || cache.statement_hash !== entry.statement_hash || cache.proof_hash !== entry.proof_hash || stableJson(cache.dependency_snapshot ?? {}, 0) !== stableJson(entry.dependency_snapshot ?? {}, 0)) reasons.push('verification-cache-invalid');
      if (result && cache && stableJson(cache.scope ?? [], 0) !== stableJson(files.get(result.file)?.imports ?? [], 0)) reasons.push('scope-changed');
      if (result && cache && cache.source?.file !== result.file) reasons.push('source-association-changed');
      if (cache && (cache.verification?.backend !== compilation.config.verification.backend || cache.verification?.model !== compilation.config.verification.model)) reasons.push('checker-contract-changed');
      if (reasons.length) changed.push({ id, reasons: [...new Set(reasons)].sort() });
    }

    if (changed.length === 0) {
      return { schema_version: 2, operation: 'check-staleness', ok: true, changed: [], invalidated: [], snapshot_id: compilation.graph.snapshot_id };
    }

    const paths = dependentPaths(compilation.manifest.results, changed.map((item) => item.id));
    const affected = [...paths.keys()].filter((id) => index[id]?.status === 'verified').sort();
    const previousIndex = structuredClone(index);
    const sourceFiles = new Map();
    const recordFiles = new Map();
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
          source.next = setProofMarker(source.next, id, null);
        }
        const reason = changed.find((item) => item.id === id)?.reasons ?? [`depends-on-stale:${paths.get(id)[0]}`];
        index[id] = { ...index[id], status: 'stale', stale_at: now, stale_reason: reason, invalidation_path: paths.get(id) };
        const recordPath = evidenceFile(root, index[id].record);
        if (recordPath) {
          try {
            const original = await readFile(recordPath, 'utf8');
            const parsed = JSON.parse(original);
            recordFiles.set(recordPath, { original, next: { ...parsed, stale: true, stale_at: now, stale_reason: reason, invalidation_path: paths.get(id) } });
          } catch { /* Missing or corrupt evidence is already a staleness reason. */ }
        }
      }
      for (const [file, source] of sourceFiles) await atomicWrite(file, source.next);
      for (const [file, record] of recordFiles) await atomicJson(file, record.next);
      await atomicJson(indexFile, index);
      const rebuilt = await compileProject(root, options);
      if (!rebuilt.complete) throw new Error('Post-invalidation inspection could not rebuild a complete graph');
      await appendEvent(root, { type: 'verification-stale', changed: changed.map((item) => item.id), invalidated: affected });
      return {
        schema_version: 2,
        operation: 'check-staleness',
        ok: true,
        changed,
        invalidated: affected.map((id) => ({ id, path: paths.get(id), reasons: index[id].stale_reason })),
        snapshot_id: rebuilt.graph.snapshot_id
      };
    } catch (error) {
      for (const [file, source] of sourceFiles) await atomicWrite(file, source.original);
      for (const [file, record] of recordFiles) await atomicWrite(file, record.original);
      await atomicJson(indexFile, previousIndex);
      await compileProject(root, options);
      throw error;
    }
  });
}
