import path from 'node:path';
import { atomicJson, readJson, relativePosix, sha256, stableJson } from '../infrastructure/files.js';
import { auxLayout, scaffoldAuxGitignore } from '../infrastructure/aux.js';
import { SCHEMA_VERSION } from '../shared/core.js';
// A graph node is a topology-plus-status view. The verbose per-fact detail
// (verifier reasons/reports, statement and proof hashes) lives in the manifest
// results and each operation's `facts[]`/`check`, so nodes carry only the
// compact status an agent needs to reason about the graph. This keeps whole-graph
// payloads small instead of repeating the same reason string on every node.
function nodeLocalVerification(check) {
    if (!check)
        return { status: 'not-run' };
    return check.outcome ? { status: check.status, outcome: check.outcome } : { status: check.status };
}
function nodeGlobalVerification(global) {
    if (!global)
        return { status: 'unverified', blockers: [] };
    return { status: global.status, blockers: global.blockers ?? [] };
}
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
            proof_present: result.proof_present, dependencies: result.dependencies, export: result.export,
            // The author's checking intent is part of the source identity; the engine-written `status`
            // attribute is deliberately excluded, so projecting a verdict back never re-keys the snapshot.
            refutation: result.refutation, abandon: result.abandon
        })),
        proofs: compilation.manifest.proofs,
        diagnostics: compilation.diagnostics
    };
}
/** Content signature of everything a published snapshot depends on. */
export function projectSourceSignature(compilation, contextHash) {
    return sha256(stableJson({ context_hash: contextHash, compilation: compilationSource(compilation) }, 0));
}
export function buildProjectSnapshot(compilation, contextHash, diagnostics = compilation.diagnostics) {
    const results = compilation.manifest.results;
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
            local_verification: nodeLocalVerification(result.local_verification),
            global_verification: nodeGlobalVerification(result.global_verification),
            ...(result.disproof ? { disproof: result.disproof } : {})
        })),
        ...compilation.graph.nodes.filter((node) => node.origin === 'unresolved')
    ];
    const graph = {
        schema_version: SCHEMA_VERSION,
        nodes,
        edges: compilation.graph.edges,
        cycles: compilation.graph.cycles
    };
    // Graph nodes no longer carry statement/proof hashes, so mix the content
    // signature into the snapshot identity: it must still change whenever the
    // exact mathematical content changes, not only when node topology/status does.
    const sourceSignature = projectSourceSignature(compilation, contextHash);
    graph.snapshot_id = sha256(stableJson({ graph, context_hash: contextHash, source_signature: sourceSignature }, 0));
    const manifest = { ...compilation.manifest, snapshot_id: graph.snapshot_id };
    const sorted = uniqueDiagnostics(diagnostics);
    return {
        schema_version: SCHEMA_VERSION,
        snapshot_id: graph.snapshot_id,
        context_hash: contextHash,
        source_signature: sourceSignature,
        goals: compilation.goals.map(({ id, file, line, status }) => ({ id, file, line, status })),
        notes: compilation.notes,
        manifest,
        graph,
        diagnostics: sorted,
        summary: {
            goals: compilation.goals.length,
            notes: compilation.notes.length,
            facts: results.length,
            errors: sorted.filter((item) => item.severity === 'error').length
        }
    };
}
export async function publishProjectSnapshot(compilation, snapshot, options = {}) {
    if (options.write === false || !compilation.complete)
        return false;
    const root = compilation.root;
    await scaffoldAuxGitignore(root);
    const layout = auxLayout(root);
    const snapshotFile = layout.snapshot(snapshot.snapshot_id);
    await Promise.all([
        atomicJson(snapshotFile, snapshot),
        atomicJson(layout.manifest, snapshot.manifest),
        atomicJson(layout.graph, snapshot.graph),
        atomicJson(layout.diagnostics, snapshot.diagnostics)
    ]);
    await atomicJson(layout.graphsLatest, {
        schema_version: SCHEMA_VERSION,
        snapshot_id: snapshot.snapshot_id,
        file: relativePosix(root, snapshotFile)
    });
    return true;
}
/** Read the published snapshot when it is still current for the compilation's sources. */
export async function readPublishedSnapshot(compilation, contextHash) {
    try {
        const root = compilation.root;
        const layout = auxLayout(root);
        const pointer = await readJson(layout.graphsLatest);
        const graphsRoot = layout.graphs;
        const snapshotFile = path.resolve(root, pointer.file);
        if (!snapshotFile.startsWith(`${graphsRoot}${path.sep}`))
            return null;
        const saved = await readJson(snapshotFile);
        if (pointer.schema_version !== SCHEMA_VERSION || saved.schema_version !== SCHEMA_VERSION
            || saved.snapshot_id !== pointer.snapshot_id
            || saved.source_signature !== projectSourceSignature(compilation, contextHash)
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
export async function resolveProjectSnapshot(compilation, contextHash, options = {}) {
    const saved = await readPublishedSnapshot(compilation, contextHash);
    if (saved)
        return saved;
    const current = buildProjectSnapshot(compilation, contextHash);
    await publishProjectSnapshot(compilation, current, options);
    return current;
}
