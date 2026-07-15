import { stat } from 'node:fs/promises';
import path from 'node:path';
import { cleanId, relativePosix } from '../infrastructure/files.js';
import { SCHEMA_VERSION, indexBy } from '../shared/core.js';
import { adjacency, allSimplePaths, blockerPaths, boundedInteger, frontier, requireNode, shortestPath, subgraph, traverse } from './graph.js';
import { deriveGraphFindings, staleFactIds } from './findings.js';
import { buildProjectSnapshot, publishProjectSnapshot, resolveProjectSnapshot } from './snapshot.js';
import { buildProjectInspectionIndex } from './index.js';
import { verifyFacts } from './verify.js';
function byId(items) {
    return indexBy(items, (item) => item.id);
}
function emptyGraph() { return { schema_version: SCHEMA_VERSION, nodes: [], edges: [], cycles: [] }; }
function emptyVerification() {
    return {
        available: false, eligible: 0, verifier_calls: 0, cache_hits: 0, cache_misses: 0, invalid_cache_entries: 0,
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
        construction_dependencies: [], dependencies: [], uses: []
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
export async function inspectProject(root = process.cwd(), options = {}) {
    root = path.resolve(root);
    const index = await buildProjectInspectionIndex(root, options);
    const run = await verifyFacts(index, options);
    const snapshot = buildProjectSnapshot(index, run.diagnostics);
    const snapshotPublished = await publishProjectSnapshot(index, snapshot, options);
    const diagnostics = snapshot.diagnostics;
    const facts = run.facts.map((fact) => factCheck(fact, diagnostics));
    const goalIds = new Set(index.goals.map((goal) => goal.id));
    const ok = index.compilation.complete
        && facts.every((fact) => fact.local_verification.status !== 'error')
        && diagnostics.every((item) => item.severity !== 'error');
    return {
        schema_version: SCHEMA_VERSION,
        operation: 'inspect-project',
        ok,
        complete: index.compilation.complete,
        snapshot_id: snapshot.snapshot_id,
        snapshot_published: snapshotPublished,
        scope: { type: 'project', path: '.' },
        summary: {
            ...snapshot.summary,
            files: index.compilation.manifest.files.length,
            kinds: tally(facts, 'kind'),
            statuses: tally(facts, 'status'),
            globally_verified_goals: facts.filter((fact) => goalIds.has(fact.id) && fact.global_verification.status === 'verified').length,
            globally_disproved_goals: facts.filter((fact) => goalIds.has(fact.id) && fact.global_verification.status === 'disproved').length
        },
        goals: index.goals.map(({ id, file, line, status }) => ({ id, file, line, status })),
        notes: index.notes,
        facts,
        graph: snapshot.graph,
        staleness: stalenessReport(true, snapshot.snapshot_id),
        verification: run.verification,
        blockers: blockerPaths(snapshot.graph, index.goals.map((goal) => goal.id)),
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
    const index = await buildProjectInspectionIndex(root, options);
    const result = index.compilation.manifest.results.find((item) => item.id === id);
    if (!result) {
        const parseDiagnostics = index.diagnostics.filter((item) => item.code === 'PARSE_ERROR');
        return factFailure(id, parseDiagnostics.length ? parseDiagnostics : [{
                severity: 'error', code: 'FACT_UNKNOWN', id,
                message: `No fact named @${id} exists in the project`
            }]);
    }
    const run = await verifyFacts(index, { ...options, selectedIds: [id] });
    const snapshot = buildProjectSnapshot(index, run.diagnostics);
    const snapshotPublished = await publishProjectSnapshot(index, snapshot, options);
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
    const selectedFiles = new Set(index.compilation.manifest.results
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
        diagnostics
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
    const index = await buildProjectInspectionIndex(root, options);
    const manifest = index.compilation.manifest;
    const parseDiagnostics = index.diagnostics.filter((item) => item.code === 'PARSE_ERROR' && item.file && isWithinPath(item.file, relative, info.isDirectory()));
    if (parseDiagnostics.length)
        return failure(parseDiagnostics);
    const selectedFiles = new Set(manifest.files.filter((file) => isWithinPath(file.path, relative, info.isDirectory())).map((file) => file.path));
    const selectedIds = new Set(manifest.results.filter((result) => selectedFiles.has(result.file)).map((result) => result.id));
    for (const proof of manifest.proofs)
        if (selectedFiles.has(proof.file))
            selectedIds.add(proof.target);
    if (selectedIds.size === 0) {
        const snapshot = await resolveProjectSnapshot(index, options);
        return {
            schema_version: SCHEMA_VERSION, operation: 'inspect-path', ok: true, snapshot_id: snapshot.snapshot_id, snapshot_published: true,
            scope: { type: info.isDirectory() ? 'folder' : 'file', path: relative },
            summary: { files: selectedFiles.size, facts: 0, errors: 0 }, facts: [], graph: emptyGraph(), verification: emptyVerification(),
            staleness: stalenessReport(true, snapshot.snapshot_id),
            findings: deriveGraphFindings({ graph: emptyGraph(), manifest: { schema_version: SCHEMA_VERSION, files: [], results: [], proofs: [] }, diagnostics: [] }), diagnostics: []
        };
    }
    const run = await verifyFacts(index, { ...options, selectedIds });
    const snapshot = buildProjectSnapshot(index, run.diagnostics);
    const published = await publishProjectSnapshot(index, snapshot, options);
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
async function latestSnapshot(root, options = {}) {
    const index = await buildProjectInspectionIndex(root, options);
    return resolveProjectSnapshot(index, options);
}
export async function analyzeDependencies(root, operation, args = [], options = {}) {
    // Validate bounded options before any project scan so syntax errors are never hidden by graph failures.
    if (operation === 'alternative-paths') {
        boundedInteger(options.maxPaths, 5, { name: 'max paths', min: 1, max: 25 });
        boundedInteger(options.maxDepth, 64, { name: 'max depth', min: 1, max: 100 });
    }
    if (operation === 'reused')
        boundedInteger(options.limit, 20, { name: 'limit', min: 1, max: 1000 });
    let snapshot;
    try {
        snapshot = await latestSnapshot(root, options);
    }
    catch (error) {
        const failure = error;
        return {
            schema_version: SCHEMA_VERSION, operation: `dependency-${operation}`, ok: false,
            computed: false,
            status: 'blocked',
            diagnostics: failure.diagnostics ?? [{ severity: 'error', code: failure.code ?? 'DEPENDENCY_SNAPSHOT_FAILED', message: failure.message ?? String(error) }]
        };
    }
    const { graph } = snapshot;
    const blockingDiagnostics = (snapshot.diagnostics ?? []).filter((item) => (item.code === 'PARSE_ERROR' || item.code === 'DUPLICATE_ID'));
    if (blockingDiagnostics.length)
        return {
            schema_version: SCHEMA_VERSION,
            operation: `dependency-${operation}`,
            ok: false,
            computed: false,
            status: 'blocked',
            snapshot_id: snapshot.snapshot_id,
            summary: { nodes_available: graph.nodes.length, blocking_errors: blockingDiagnostics.length },
            diagnostics: blockingDiagnostics,
            remediation: 'Repair the blocking parse or duplicate-ID diagnostics, then rerun the dependency command.'
        };
    const requested = args[0];
    const requiredIds = [
        ...(['dependencies', 'reverse-dependencies', 'impact', 'frontier'].includes(operation) ? [requested] : []),
        ...(['path', 'alternative-paths'].includes(operation) ? [requested, args[1]] : []),
        ...(operation === 'search' ? [options.relatedTo, options.usedBy, options.dependsOn, options.affectedBy, options.staleAffectedBy, options.frontierOf] : [])
    ].filter((value) => typeof value === 'string' && value.length > 0);
    const missing = [...new Set(requiredIds.map(cleanId).filter((id) => !graph.nodes.some((node) => node.id === id)))];
    if (missing.length)
        return {
            schema_version: SCHEMA_VERSION, operation: `dependency-${operation}`, ok: false, snapshot_id: snapshot.snapshot_id,
            diagnostics: missing.map((id) => ({ severity: 'error', code: 'FACT_UNKNOWN', id, message: `Unknown fact in project graph: @${id}` }))
        };
    let result;
    if (operation === 'dependencies' || operation === 'reverse-dependencies') {
        const node = requireNode(graph, requested);
        const reverse = operation === 'reverse-dependencies';
        const directIds = adjacency(graph, reverse).get(node.id) ?? [];
        const transitiveIds = [...traverse(graph, node.id, reverse)].sort();
        const nodes = byId(graph.nodes);
        result = {
            target: node,
            direct: directIds.map((id) => nodes.get(id)).filter((item) => item !== undefined),
            transitive: transitiveIds.map((id) => nodes.get(id)).filter((item) => item !== undefined)
        };
    }
    else if (operation === 'path') {
        requireNode(graph, requested);
        requireNode(graph, args[1]);
        result = { from: cleanId(requested), to: cleanId(args[1]), path: shortestPath(graph, cleanId(requested), cleanId(args[1])) };
    }
    else if (operation === 'alternative-paths') {
        requireNode(graph, requested);
        requireNode(graph, args[1]);
        const from = cleanId(requested);
        const to = cleanId(args[1]);
        const paths = allSimplePaths(graph, from, to, options);
        result = { from, to, ...paths };
    }
    else if (operation === 'cycles') {
        result = { cycles: graph.cycles ?? [] };
    }
    else if (operation === 'impact') {
        const node = requireNode(graph, requested);
        const nodes = byId(graph.nodes);
        result = {
            target: node,
            affected: [...traverse(graph, node.id, true)].sort()
                .map((id) => nodes.get(id))
                .filter((item) => item !== undefined)
        };
    }
    else if (operation === 'frontier') {
        result = { target: requireNode(graph, requested), frontier: frontier(graph, requested) };
    }
    else if (['findings', 'unused-imports', 'unused-exports', 'isolated', 'unreachable', 'ready', 'ready-for-ai', 'reused'].includes(operation)) {
        const findings = deriveGraphFindings(snapshot);
        if (operation === 'findings')
            result = { findings };
        else if (operation === 'unused-imports')
            result = { unused_imports: findings.unused_imports };
        else if (operation === 'unused-exports')
            result = { unused_exports: findings.unused_exports };
        else if (operation === 'isolated')
            result = { definition: findings.definitions.isolated, facts: findings.isolated_facts };
        else if (operation === 'unreachable')
            result = { definition: findings.definitions.unreachable, ...findings.unreachable };
        else if (operation === 'ready' || operation === 'ready-for-ai')
            result = { definition: findings.definitions.candidate_ready_for_ai, candidates: findings.candidate_ready_for_ai };
        else {
            const limit = boundedInteger(options.limit, 20, { name: 'limit', min: 1, max: 1000 });
            result = { definition: findings.definitions.heavily_reused, facts: findings.heavily_reused.slice(0, limit), total: findings.heavily_reused.length, limit };
        }
    }
    else if (operation === 'search') {
        const query = String(requested ?? '').toLowerCase();
        const manifestById = byId(snapshot.manifest.results);
        const staleIds = staleFactIds(snapshot);
        let matches = graph.nodes.filter((node) => {
            const fact = manifestById.get(node.id);
            const haystack = [node.id, node.title, node.file, fact?.statement_text, fact?.proof_text].filter(Boolean).join('\n').toLowerCase();
            return haystack.includes(query)
                && (!options.kind || node.kind === options.kind)
                && (!options.status || node.status === options.status)
                && (!options.origin || node.origin === options.origin)
                && (!options.path || node.file === options.path || node.file?.startsWith(`${options.path}/`));
        });
        const relatedIds = (selected, reverse = false) => {
            const target = requireNode(graph, selected);
            return options.direct === true
                ? new Set(adjacency(graph, reverse).get(target.id) ?? [])
                : traverse(graph, target.id, reverse);
        };
        if (options.relatedTo) {
            const related = relatedIds(options.relatedTo, options.reverse === true);
            matches = matches.filter((node) => related.has(node.id));
        }
        if (options.usedBy) {
            const related = relatedIds(options.usedBy);
            matches = matches.filter((node) => related.has(node.id));
        }
        if (options.dependsOn) {
            const related = relatedIds(options.dependsOn, true);
            matches = matches.filter((node) => related.has(node.id));
        }
        if (options.affectedBy) {
            const related = relatedIds(options.affectedBy, true);
            matches = matches.filter((node) => related.has(node.id));
        }
        if (options.staleAffectedBy) {
            const related = relatedIds(options.staleAffectedBy, true);
            matches = matches.filter((node) => related.has(node.id) && staleIds.has(node.id));
        }
        if (options.frontierOf) {
            const ids = new Set(frontier(graph, options.frontierOf).map((item) => item.fact.id));
            matches = matches.filter((node) => ids.has(node.id));
        }
        if (options.cycleParticipant === true) {
            const ids = new Set((graph.cycles ?? []).flatMap((cycle) => cycle.slice(0, -1)));
            matches = matches.filter((node) => ids.has(node.id));
        }
        result = {
            query: requested ?? '',
            filters: {
                ...(options.kind ? { kind: options.kind } : {}),
                ...(options.status ? { status: options.status } : {}),
                ...(options.origin ? { origin: options.origin } : {}),
                ...(options.path ? { path: options.path } : {}),
                ...(options.relatedTo ? { related_to: cleanId(options.relatedTo), reverse: options.reverse === true } : {}),
                ...(options.usedBy ? { used_by: cleanId(options.usedBy) } : {}),
                ...(options.dependsOn ? { depends_on: cleanId(options.dependsOn) } : {}),
                ...(options.affectedBy ? { affected_by: cleanId(options.affectedBy) } : {}),
                ...(options.staleAffectedBy ? { stale_affected_by: cleanId(options.staleAffectedBy) } : {}),
                ...(options.frontierOf ? { frontier_of: cleanId(options.frontierOf) } : {}),
                ...(options.direct === true ? { direct: true } : {}),
                ...(options.cycleParticipant === true ? { cycle_participant: true } : {})
            },
            matches: matches.sort((left, right) => left.id.localeCompare(right.id))
        };
    }
    else {
        throw new Error(`Unknown dependency operation: ${operation}`);
    }
    const diagnostics = snapshot.diagnostics ?? [];
    // The full project graph is deliberately not attached: each operation above
    // already returns the nodes its answer needs (target/direct/transitive/matches/
    // affected/frontier/path). Embedding the whole graph on every dependency query
    // buried the actual answer under a 50-115KB dump of unrelated nodes and edges.
    return {
        schema_version: SCHEMA_VERSION,
        operation: `dependency-${operation}`,
        ok: diagnostics.every((item) => item.severity !== 'error'),
        computed: true,
        snapshot_id: snapshot.snapshot_id,
        diagnostics,
        ...result
    };
}
