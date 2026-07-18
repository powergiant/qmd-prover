import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { AUX, cleanId, readJson, relativePosix } from '../../core/infrastructure/files.js';
import { SCHEMA_VERSION, byId, hasErrorCode } from '../../core/shared/core.js';
import { adjacency, blockerPaths, subgraph, traverse } from '../../core/graph/algorithms.js';
import { deriveGraphFindings } from '../../core/graph/findings.js';
import { buildProjectSnapshot, publishProjectSnapshot, resolveProjectSnapshot } from '../../core/graph/snapshot.js';
import { compileProject } from '../../core/semantic/compiler.js';
import { verificationContext } from '../../core/verification/protocol.js';
import { verifyFacts } from '../../core/graph/verify.js';
function emptyGraph() { return { schema_version: SCHEMA_VERSION, nodes: [], edges: [], cycles: [] }; }
function emptyVerification() {
    return {
        available: false, eligible: 0, verifier_calls: 0, cache_hits: 0, cache_misses: 0, invalid_cache_entries: 0,
        verifier_duration_ms: 0, verifier_tokens: 0,
        local_verified: 0, local_disproved: 0, local_rejected: 0, local_errors: 0, local_not_run: 0,
        global_verified: 0, global_disproved: 0, global_blocked: 0, global_unverified: 0,
        global_rejected: 0, global_invalid: 0
    };
}
function stalenessReport(ok, snapshotId) {
    return {
        schema_version: SCHEMA_VERSION, operation: 'check-staleness', ok, changed: [], invalidated: [],
        ...(snapshotId ? { snapshot_id: snapshotId } : {})
    };
}
function unknownFact(id) {
    return {
        id, file: '', kind: 'unknown', classes: [], title: '', date: '', origin: 'agent', status: 'missing', export: null,
        statement_text: '', statement_hash: '', title_hash: '', proof_hash: '', proof_present: false, proof_text: '', marker: null,
        construction_dependencies: [], dependencies: []
    };
}
function factCheck(fact, diagnostics) {
    return {
        id: fact.id,
        status: fact.status,
        kind: fact.kind,
        file: fact.file,
        line: fact.line,
        mechanical: fact.mechanical,
        local_verification: fact.local_verification,
        global_verification: fact.global_verification,
        diagnostics: diagnostics.filter((item) => item.id ? item.id === fact.id : item.file === fact.file)
    };
}
/** Count occurrences of a key across facts, e.g. a kind or status tally for a summary header. */
function tally(facts, key) {
    const counts = {};
    for (const fact of facts) {
        const value = fact[key] ?? 'unknown';
        counts[value] = (counts[value] ?? 0) + 1;
    }
    return counts;
}
/** Past verifier decisions recorded for one fact, ordered oldest-first, for `inspect fact`. */
async function history(root, id) {
    const directory = path.join(root, AUX, 'verification');
    try {
        const records = [];
        for (const selected of [directory, path.join(directory, 'checks')]) {
            let entries = [];
            try {
                entries = await readdir(selected);
            }
            catch (error) {
                if (!hasErrorCode(error, 'ENOENT'))
                    throw error;
            }
            for (const name of entries.filter((entry) => entry.endsWith('.json')).sort()) {
                const record = await readJson(path.join(selected, name));
                if (record.target === id && typeof record.verdict === 'string')
                    records.push(record);
            }
        }
        return records.sort((left, right) => `${left.verified_at ?? ''}\0${left.submission_id ?? ''}`.localeCompare(`${right.verified_at ?? ''}\0${right.submission_id ?? ''}`));
    }
    catch (error) {
        if (hasErrorCode(error, 'ENOENT'))
            return [];
        throw error;
    }
}
export async function inspectProject(root = process.cwd(), options = {}) {
    root = path.resolve(root);
    const compilation = await compileProject(root, options);
    const context = await verificationContext(compilation);
    const run = await verifyFacts(compilation, context, options);
    const snapshot = buildProjectSnapshot(compilation, context.contextHash, run.diagnostics);
    const snapshotPublished = await publishProjectSnapshot(compilation, snapshot, options);
    const diagnostics = snapshot.diagnostics;
    const facts = run.facts.map((fact) => factCheck(fact, diagnostics));
    const goalIds = new Set(compilation.goals.map((goal) => goal.id));
    const ok = compilation.complete
        && facts.every((fact) => fact.local_verification.status !== 'error')
        && diagnostics.every((item) => item.severity !== 'error');
    return {
        schema_version: SCHEMA_VERSION,
        operation: 'inspect-project',
        ok,
        complete: compilation.complete,
        snapshot_id: snapshot.snapshot_id,
        snapshot_published: snapshotPublished,
        scope: { type: 'project', path: '.' },
        summary: {
            ...snapshot.summary,
            files: compilation.manifest.files.length,
            kinds: tally(facts, 'kind'),
            statuses: tally(facts, 'status'),
            globally_verified_goals: facts.filter((fact) => goalIds.has(fact.id) && fact.global_verification.status === 'verified').length,
            globally_disproved_goals: facts.filter((fact) => goalIds.has(fact.id) && fact.global_verification.status === 'disproved').length
        },
        goals: compilation.goals.map(({ id, file, line, status }) => ({ id, file, line, status })),
        notes: compilation.notes,
        facts,
        graph: snapshot.graph,
        staleness: stalenessReport(true, snapshot.snapshot_id),
        verification: run.verification,
        blockers: blockerPaths(snapshot.graph, compilation.goals.map((goal) => goal.id)),
        findings: deriveGraphFindings(snapshot),
        diagnostics
    };
}
function factFailure(id, diagnostics) {
    const fact = unknownFact(id);
    const reason = diagnostics.some((item) => item.code === 'PARSE_ERROR') ? 'blocked-by-parse-error' : 'fact-unavailable';
    return {
        schema_version: SCHEMA_VERSION, operation: 'inspect-fact', ok: false, snapshot_published: false,
        scope: { type: 'fact', id }, fact,
        check: {
            id, status: fact.status,
            mechanical: { status: 'fail', references: [], reason },
            local_verification: { status: 'not-run', reason: 'No local conditional verification is available.' },
            global_verification: { status: 'invalid', blockers: [], reason },
            diagnostics
        },
        graph: emptyGraph(), verification: emptyVerification(),
        staleness: stalenessReport(false),
        diagnostics
    };
}
export async function inspectFact(root, requested, options = {}) {
    root = path.resolve(root);
    const id = cleanId(requested);
    const compilation = await compileProject(root, options);
    const context = await verificationContext(compilation);
    const result = compilation.manifest.results.find((item) => item.id === id);
    if (!result) {
        const parseDiagnostics = compilation.diagnostics.filter((item) => item.code === 'PARSE_ERROR');
        const failure = factFailure(id, parseDiagnostics.length ? parseDiagnostics : [{
                severity: 'error', code: 'FACT_UNKNOWN', id,
                message: `No fact named @${id} exists in the project`
            }]);
        failure.verification_history = await history(root, id);
        return failure;
    }
    const run = await verifyFacts(compilation, context, { ...options, selectedIds: [id] });
    const snapshot = buildProjectSnapshot(compilation, context.contextHash, run.diagnostics);
    const snapshotPublished = await publishProjectSnapshot(compilation, snapshot, options);
    const dependencyIds = traverse(snapshot.graph, id);
    const selected = new Set([id, ...dependencyIds]);
    const graph = subgraph(snapshot.graph, selected);
    const graphNodes = byId(graph.nodes);
    const projectNodes = byId(snapshot.graph.nodes);
    const directDependencies = adjacency(graph).get(id) ?? [];
    // Reverse dependencies live outside this fact's downward closure, so resolve
    // them against the whole project graph rather than the (downward) subgraph.
    const directReverseDependencies = (adjacency(snapshot.graph, true).get(id) ?? [])
        .map((dependency) => projectNodes.get(dependency)).filter(Boolean);
    const selectedFiles = new Set(compilation.manifest.results
        .filter((item) => selected.has(item.id))
        .flatMap((item) => [item.file, item.proof_file].filter((file) => Boolean(file))));
    const diagnostics = run.diagnostics.filter((item) => item.id ? selected.has(item.id) : !item.file || selectedFiles.has(item.file));
    const record = run.facts.find((fact) => fact.id === id);
    const check = record
        ? factCheck(record, diagnostics.filter((item) => item.id === id || item.file === result.file))
        : factFailure(id, diagnostics).check;
    return {
        schema_version: SCHEMA_VERSION,
        operation: 'inspect-fact',
        ok: check.mechanical.status === 'pass' && check.local_verification.status !== 'error',
        verified: check.global_verification.status === 'verified',
        disproved: check.global_verification.status === 'disproved',
        global_status: check.global_verification.status,
        snapshot_id: snapshot.snapshot_id,
        snapshot_published: snapshotPublished,
        scope: { type: 'fact', id },
        fact: result,
        check,
        graph,
        direct_dependencies: directDependencies.map((dependency) => graphNodes.get(dependency)).filter(Boolean),
        transitive_dependencies: [...dependencyIds].sort().map((dependency) => graphNodes.get(dependency)).filter(Boolean),
        direct_reverse_dependencies: directReverseDependencies,
        blockers: blockerPaths(graph, [id]),
        staleness: stalenessReport(true, snapshot.snapshot_id),
        verification: run.verification,
        diagnostics,
        verification_history: await history(root, id)
    };
}
function isWithinPath(file, selected, isDirectory) {
    return isDirectory ? file === selected || file.startsWith(`${selected}/`) : file === selected;
}
export async function inspectPath(root, requestedPath, options = {}) {
    root = path.resolve(root);
    const absolute = path.resolve(root, requestedPath);
    const relative = relativePosix(root, absolute);
    const failure = (diagnostics) => ({
        schema_version: SCHEMA_VERSION, operation: 'inspect-path', ok: false, snapshot_published: false,
        scope: { type: 'path', path: relative }, summary: { files: 0, facts: 0, errors: diagnostics.length },
        facts: [], graph: emptyGraph(), verification: emptyVerification(),
        staleness: stalenessReport(false),
        findings: deriveGraphFindings({ graph: emptyGraph(), manifest: { schema_version: SCHEMA_VERSION, files: [], results: [], proofs: [] }, diagnostics }), diagnostics
    });
    if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative))
        return failure([{ severity: 'error', code: 'PATH_OUTSIDE_PROJECT', message: 'Inspection path must stay inside the project' }]);
    let info;
    try {
        info = await stat(absolute);
    }
    catch {
        return failure([{ severity: 'error', code: 'PATH_NOT_FOUND', message: `Inspection path does not exist: ${relative}`, file: relative }]);
    }
    if (!info.isDirectory() && !(info.isFile() && absolute.endsWith('.qmd')))
        return failure([{ severity: 'error', code: 'PATH_TYPE_INVALID', message: 'Inspection path must be a QMD file or directory', file: relative }]);
    const compilation = await compileProject(root, options);
    const context = await verificationContext(compilation);
    const manifest = compilation.manifest;
    const parseDiagnostics = compilation.diagnostics.filter((item) => item.code === 'PARSE_ERROR' && item.file && isWithinPath(item.file, relative, info.isDirectory()));
    if (parseDiagnostics.length)
        return failure(parseDiagnostics);
    const selectedFiles = new Set(manifest.files.filter((file) => isWithinPath(file.path, relative, info.isDirectory())).map((file) => file.path));
    const selectedIds = new Set(manifest.results.filter((result) => selectedFiles.has(result.file)).map((result) => result.id));
    for (const proof of manifest.proofs)
        if (selectedFiles.has(proof.file))
            selectedIds.add(proof.target);
    if (selectedIds.size === 0) {
        const snapshot = await resolveProjectSnapshot(compilation, context.contextHash, options);
        return {
            schema_version: SCHEMA_VERSION, operation: 'inspect-path', ok: true, snapshot_id: snapshot.snapshot_id, snapshot_published: true,
            scope: { type: info.isDirectory() ? 'folder' : 'file', path: relative },
            summary: { files: selectedFiles.size, facts: 0, errors: 0 }, facts: [], graph: emptyGraph(), verification: emptyVerification(),
            staleness: stalenessReport(true, snapshot.snapshot_id),
            findings: deriveGraphFindings({ graph: emptyGraph(), manifest: { schema_version: SCHEMA_VERSION, files: [], results: [], proofs: [] }, diagnostics: [] }), diagnostics: []
        };
    }
    const run = await verifyFacts(compilation, context, { ...options, selectedIds });
    const snapshot = buildProjectSnapshot(compilation, context.contextHash, run.diagnostics);
    const published = await publishProjectSnapshot(compilation, snapshot, options);
    const contextIds = new Set(selectedIds);
    for (const id of selectedIds)
        for (const dependency of traverse(snapshot.graph, id))
            contextIds.add(dependency);
    const graph = subgraph(snapshot.graph, contextIds);
    graph.nodes = graph.nodes.map((node) => ({ ...node, scope: selectedIds.has(node.id) ? 'selected' : 'external' }));
    const diagnostics = run.diagnostics.filter((item) => (item.id && contextIds.has(item.id)) || (item.file && selectedFiles.has(item.file)));
    const facts = run.facts.filter((fact) => selectedIds.has(fact.id)).map((fact) => factCheck(fact, diagnostics));
    return {
        schema_version: SCHEMA_VERSION, operation: 'inspect-path',
        ok: facts.every((fact) => fact.mechanical.status === 'pass' && fact.local_verification.status !== 'error')
            && diagnostics.every((item) => item.severity !== 'error'),
        snapshot_id: snapshot.snapshot_id, snapshot_published: published,
        scope: { type: info.isDirectory() ? 'folder' : 'file', path: relative },
        summary: {
            files: selectedFiles.size, facts: facts.length,
            kinds: tally(facts, 'kind'),
            statuses: tally(facts, 'status'),
            globally_verified: facts.filter((fact) => fact.global_verification.status === 'verified').length,
            globally_disproved: facts.filter((fact) => fact.global_verification.status === 'disproved').length,
            errors: diagnostics.filter((item) => item.severity === 'error').length
        },
        facts, graph, blockers: blockerPaths(graph, [...selectedIds]),
        findings: deriveGraphFindings({ graph, manifest, diagnostics }, { selectedIds, selectedFiles }),
        staleness: stalenessReport(true, snapshot.snapshot_id), verification: run.verification, diagnostics
    };
}
