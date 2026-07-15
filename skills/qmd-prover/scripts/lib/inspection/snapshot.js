import path from 'node:path';
import { AUX, atomicJson, readJson, relativePosix, sha256, stableJson } from '../infrastructure/files.js';
import { SCHEMA_VERSION } from '../shared/core.js';
function uniqueDiagnostics(items) {
    const seen = new Set();
    return items.filter((item) => {
        const key = stableJson(item, 0);
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    }).sort((left, right) => `${left.file ?? ''}:${left.line ?? 0}:${left.code}:${left.id ?? ''}`.localeCompare(`${right.file ?? ''}:${right.line ?? 0}:${right.code}:${right.id ?? ''}`));
}
function compilationSource(compilation) {
    return {
        complete: compilation.complete,
        files: compilation.manifest.files,
        results: compilation.manifest.results.map((result) => ({
            id: result.id, file: result.file, kind: result.kind, classes: result.classes, date: result.date,
            statement_hash: result.statement_hash, title_hash: result.title_hash, proof_hash: result.proof_hash,
            proof_present: result.proof_present, dependencies: result.dependencies, export: result.export, marker: result.marker
        })),
        proofs: compilation.manifest.proofs,
        diagnostics: compilation.diagnostics
    };
}
/** Content signature of everything a published snapshot depends on. */
export function projectSourceSignature(compilation, contextHash) {
    return sha256(stableJson({ context_hash: contextHash, compilation: compilationSource(compilation) }, 0));
}
export function buildProjectSnapshot(index, diagnostics = index.diagnostics) {
    const results = index.compilation.manifest.results;
    const nodes = [
        ...results.map((result) => ({
            id: result.id,
            title: result.title,
            kind: result.kind,
            status: result.status,
            file: result.file,
            line: result.line,
            origin: result.origin === 'user' ? 'main-goal' : 'fact',
            ownership: result.origin,
            identity: { statement_hash: result.statement_hash, proof_hash: result.proof_hash },
            local_verification: result.local_verification ?? { status: 'not-run', reason: 'No local verification result is available.' },
            global_verification: result.global_verification ?? { status: 'unverified', blockers: [], reason: 'local-verification-not-run' },
            ...(result.disproof ? { disproof: result.disproof } : {})
        })),
        ...index.compilation.graph.nodes.filter((node) => node.origin === 'unresolved')
    ];
    const graph = {
        schema_version: SCHEMA_VERSION,
        nodes,
        edges: index.compilation.graph.edges,
        cycles: index.compilation.graph.cycles
    };
    graph.snapshot_id = sha256(stableJson({ graph, context_hash: index.contextHash }, 0));
    const manifest = { ...index.compilation.manifest, snapshot_id: graph.snapshot_id };
    const sorted = uniqueDiagnostics(diagnostics);
    return {
        schema_version: SCHEMA_VERSION,
        snapshot_id: graph.snapshot_id,
        context_hash: index.contextHash,
        source_signature: projectSourceSignature(index.compilation, index.contextHash),
        goals: index.goals.map(({ id, file, line, status }) => ({ id, file, line, status })),
        notes: index.notes,
        manifest,
        graph,
        diagnostics: sorted,
        summary: {
            goals: index.goals.length,
            notes: index.notes.length,
            facts: results.length,
            errors: sorted.filter((item) => item.severity === 'error').length
        }
    };
}
export async function publishProjectSnapshot(index, snapshot, options = {}) {
    if (options.write === false || !index.compilation.complete)
        return false;
    const graphsRoot = path.join(index.root, AUX, 'graphs');
    const snapshotFile = path.join(graphsRoot, `${snapshot.snapshot_id.replace(/^sha256:/, '')}.json`);
    await Promise.all([
        atomicJson(snapshotFile, snapshot),
        atomicJson(path.join(index.root, AUX, 'manifest.json'), snapshot.manifest),
        atomicJson(path.join(index.root, AUX, 'graph.json'), snapshot.graph),
        atomicJson(path.join(index.root, AUX, 'diagnostics.json'), snapshot.diagnostics)
    ]);
    await atomicJson(path.join(graphsRoot, 'latest.json'), {
        schema_version: SCHEMA_VERSION,
        snapshot_id: snapshot.snapshot_id,
        file: relativePosix(index.root, snapshotFile)
    });
    return true;
}
/** Read the published snapshot when it is still current for the index's sources. */
export async function readPublishedSnapshot(index) {
    try {
        const pointer = await readJson(path.join(index.root, AUX, 'graphs', 'latest.json'));
        const graphsRoot = path.join(index.root, AUX, 'graphs');
        const snapshotFile = path.resolve(index.root, pointer.file);
        if (!snapshotFile.startsWith(`${graphsRoot}${path.sep}`))
            return null;
        const saved = await readJson(snapshotFile);
        if (pointer.schema_version !== SCHEMA_VERSION || saved.schema_version !== SCHEMA_VERSION
            || saved.snapshot_id !== pointer.snapshot_id
            || saved.source_signature !== projectSourceSignature(index.compilation, index.contextHash)
            || !Array.isArray(saved.manifest?.results)
            || !Array.isArray(saved.graph?.nodes)
            || !Array.isArray(saved.diagnostics))
            return null;
        return saved;
    }
    catch {
        return null;
    }
}
/** The valid published snapshot, or a freshly built and published one. */
export async function resolveProjectSnapshot(index, options = {}) {
    const saved = await readPublishedSnapshot(index);
    if (saved)
        return saved;
    const current = buildProjectSnapshot(index);
    await publishProjectSnapshot(index, current, options);
    return current;
}
