import { stat } from 'node:fs/promises';
import path from 'node:path';
import { AUX, cleanId, readJson, relativePosix } from '../infrastructure/files.js';
import { indexBy } from '../shared/core.js';
import { adjacency, allSimplePaths, blockerPaths, boundedInteger, frontier, requireNode, shortestPath, subgraph, traverse } from './graph.js';
import { deriveGraphFindings, staleFactIds } from './findings.js';
import { aggregateSourceSignature, buildAggregateSnapshot, publishAggregateSnapshot } from './aggregate.js';
import { buildProjectInspectionIndex } from './index.js';
import { inspectWorkspace } from '../workspace/inspect.js';
function byId(items) {
    return indexBy(items, (item) => item.id);
}
function aiCheck(result, inspected = null) {
    if (inspected)
        return inspected;
    if (result.status === 'verified')
        return { status: 'pass', source: 'verification-record' };
    if (result.status === 'rejected')
        return { status: 'fail', source: 'verification-record' };
    return { status: 'not-run', reason: 'The fact was not eligible for independent verification.' };
}
function factCheck(result, diagnostics, inspected = null) {
    const relevant = diagnostics.filter((item) => item.id ? item.id === result.id : item.file === result.file);
    const referenceFailure = (result.reference_checks ?? []).some((check) => (check.existence === 'fail' || check.scope === 'fail' || check.status === 'fail' || check.cycle === 'fail'));
    const programmatic = referenceFailure || relevant.some((item) => item.severity === 'error') ? 'fail' : 'pass';
    return {
        id: result.id,
        status: result.status,
        programmatic: { status: programmatic, references: result.reference_checks ?? [] },
        ai: aiCheck(result, inspected),
        diagnostics: relevant
    };
}
function resultSummary(results) {
    const kindCounts = new Map();
    const statusCounts = new Map();
    for (const result of results) {
        kindCounts.set(result.kind, (kindCounts.get(result.kind) ?? 0) + 1);
        statusCounts.set(result.status, (statusCounts.get(result.status) ?? 0) + 1);
    }
    const kinds = Object.fromEntries([...kindCounts].sort(([left], [right]) => left.localeCompare(right)));
    const statuses = Object.fromEntries([...statusCounts].sort(([left], [right]) => left.localeCompare(right)));
    return { facts: results.length, kinds, statuses };
}
function emptyGraph() { return { schema_version: 3, nodes: [], edges: [], cycles: [] }; }
function emptyVerification() {
    return { eligible: 0, verifier_calls: 0, cache_hits: 0, passed: 0, rejected: 0, errors: 0, not_run: 0 };
}
function unknownFact(id) {
    return {
        id, file: '', kind: 'unknown', classes: [], title: '', date: '', origin: 'workspace', status: 'missing', export: null,
        statement_text: '', statement_hash: '', title_hash: '', proof_hash: '', proof_present: false, proof_text: '', marker: null,
        construction_dependencies: [], dependencies: [], uses: []
    };
}
function workspaceVerification(result) {
    return {
        eligible: result.verification.eligible,
        verifier_calls: result.verification.verifier_calls,
        cache_hits: result.verification.cache_hits,
        passed: result.verification.passed,
        rejected: result.verification.rejected,
        errors: result.verification.errors,
        not_run: result.verification.not_run
    };
}
function inspectedFactCheck(result, id) {
    const fact = result.manifest.results.find((item) => item.id === id) ?? unknownFact(id);
    const outcome = result.facts.find((item) => item.id === id);
    const diagnostics = result.diagnostics.filter((item) => item.id === id || item.file === fact.file);
    return {
        id,
        status: fact.status,
        programmatic: { status: outcome?.programmatic?.status ?? 'fail', references: fact.reference_checks ?? [] },
        ai: outcome?.ai ?? { status: 'not-run', reason: 'No workspace outcome was recorded.' },
        diagnostics
    };
}
function addVerification(total, value) {
    for (const key of ['eligible', 'verifier_calls', 'cache_hits', 'passed', 'rejected', 'errors', 'not_run'])
        total[key] += value[key];
}
function projectFailure(operation, diagnostics) {
    const graph = emptyGraph();
    return {
        schema_version: 3, operation, ok: false, snapshot_published: false,
        graph, facts: [], verification: emptyVerification(),
        staleness: { schema_version: 3, operation: 'check-staleness', ok: false, changed: [], invalidated: [] },
        diagnostics, findings: deriveGraphFindings({ graph, manifest: { schema_version: 3, files: [], results: [], proofs: [] }, diagnostics })
    };
}
export async function inspectProject(root = process.cwd(), options = {}) {
    root = path.resolve(root);
    const index = await buildProjectInspectionIndex(root, options);
    if (index.fatal) {
        return {
            ...projectFailure('inspect-project', index.globalDiagnostics),
            goals: index.goals.map(({ id, file, line, status }) => ({ id, file, line, status })),
            notes: index.notes,
            workspaces: index.workspaces.map(({ id, path: workspacePath, status, stale, diagnostics }) => ({ id, path: workspacePath, status, stale, diagnostics }))
        };
    }
    const inspected = new Map();
    for (const workspace of index.workspaces.filter((entry) => entry.status === 'initialized')) {
        inspected.set(workspace.id, await inspectWorkspace(root, workspace.id, { ...options, skipProjectPreflight: true }));
    }
    const snapshot = buildAggregateSnapshot(index, inspected);
    const snapshotPublished = await publishAggregateSnapshot(index, snapshot, options);
    const verification = emptyVerification();
    for (const result of inspected.values())
        addVerification(verification, workspaceVerification(result));
    const workspaceByGoal = new Map(index.workspaces.map((workspace) => [workspace.id, workspace]));
    const missingDiagnostics = index.goals.flatMap((goal) => {
        const workspace = workspaceByGoal.get(goal.id);
        return workspace?.status === 'initialized' ? [] : [{
                severity: 'error', code: 'WORKSPACE_MISSING', id: goal.id, file: goal.file,
                message: `Protected main goal @${goal.id} has no initialized workspace`,
                remediation: `Run workspace init @${goal.id} explicitly.`
            }];
    });
    const diagnostics = [...snapshot.diagnostics, ...missingDiagnostics];
    const facts = [...inspected.values()].flatMap((result) => result.facts.map((fact) => inspectedFactCheck(result, fact.id)));
    const represented = new Set(facts.map((fact) => fact.id));
    for (const goal of index.goals)
        if (!represented.has(goal.id))
            facts.push(factCheck(goal, diagnostics));
    facts.sort((left, right) => left.id.localeCompare(right.id));
    const ok = index.goalsCompilation.complete
        && index.goals.length > 0
        && missingDiagnostics.length === 0
        && index.workspaces.every((workspace) => workspace.status === 'initialized')
        && [...inspected.values()].every((result) => result.ok === true)
        && diagnostics.every((item) => item.severity !== 'error');
    return {
        schema_version: 3,
        operation: 'inspect-project',
        ok,
        snapshot_id: snapshot.snapshot_id,
        snapshot_published: snapshotPublished,
        scope: { type: 'project', path: '.' },
        summary: { ...snapshot.summary, initialized_workspaces: inspected.size, errors: diagnostics.filter((item) => item.severity === 'error').length },
        goals: index.goals.map(({ id, file, line, status }) => ({ id, file, line, status, workspace: workspaceByGoal.get(id)?.status ?? 'missing' })),
        notes: index.notes,
        workspaces: index.workspaces.map((workspace) => inspected.get(workspace.id) ?? {
            schema_version: 3, operation: 'workspace-inspect', ok: false, workspace: workspace.path,
            id: workspace.id, status: workspace.status, target: { id: workspace.id, status: 'missing' }, stale: workspace.stale, diagnostics: workspace.diagnostics
        }),
        facts,
        graph: snapshot.graph,
        staleness: {
            schema_version: 3, operation: 'check-staleness', ok: index.workspaces.every((workspace) => !workspace.stale),
            changed: index.workspaces.filter((workspace) => workspace.stale).map((workspace) => ({ id: workspace.id, reasons: ['workspace-snapshot-stale'] })),
            invalidated: []
        },
        verification,
        blockers: blockerPaths(snapshot.graph, index.goals.map((goal) => goal.id)),
        findings: deriveGraphFindings(snapshot),
        diagnostics
    };
}
function factFailure(id, diagnostics) {
    const fact = unknownFact(id);
    return {
        schema_version: 3, operation: 'inspect-fact', ok: false, snapshot_published: false,
        scope: { type: 'fact', id }, fact, check: factCheck(fact, diagnostics), graph: emptyGraph(), verification: emptyVerification(),
        staleness: { schema_version: 3, operation: 'check-staleness', ok: false, changed: [], invalidated: [] },
        diagnostics
    };
}
async function inspectIndexedFact(index, id, options) {
    if (index.fatal)
        return factFailure(id, index.globalDiagnostics);
    const workspace = index.workspaces.find((entry) => entry.compilation?.manifest.results.some((result) => result.id === id))
        ?? index.workspaces.find((entry) => entry.id === id && entry.status === 'initialized');
    const goal = index.goals.find((result) => result.id === id);
    if (!workspace) {
        if (goal) {
            const diagnostics = [{
                    severity: 'error', code: 'WORKSPACE_MISSING', id, file: goal.file,
                    message: `Protected main goal @${id} has no initialized workspace`, remediation: `Run workspace init @${id} explicitly.`
                }];
            return { ...factFailure(id, diagnostics), fact: goal, check: factCheck(goal, diagnostics, null), source: { statement: goal.statement_text, proof: '' } };
        }
        const parseDiagnostics = index.diagnostics.filter((item) => item.code === 'PARSE_ERROR');
        return factFailure(id, parseDiagnostics.length ? parseDiagnostics : [{
                severity: 'error', code: 'FACT_UNKNOWN', id,
                message: `No protected main goal or workspace fact named @${id} exists`
            }]);
    }
    if (workspace.status !== 'initialized') {
        const indexedFact = workspace.compilation?.manifest.results.find((result) => result.id === id);
        if (!indexedFact)
            return factFailure(id, workspace.diagnostics);
        const fact = { ...indexedFact, origin: 'workspace', workspace: workspace.id, status: 'workspace-unavailable' };
        return { ...factFailure(id, workspace.diagnostics), fact, check: factCheck(fact, workspace.diagnostics), source: { statement: fact.statement_text, proof: fact.proof_text } };
    }
    const inspected = await inspectWorkspace(index.root, workspace.id, { ...options, selectedIds: [id], skipProjectPreflight: true });
    const fact = inspected.manifest.results.find((result) => result.id === id);
    if (!fact) {
        const parseDiagnostics = inspected.diagnostics.filter((item) => item.code === 'PARSE_ERROR');
        return factFailure(id, parseDiagnostics.length ? parseDiagnostics : [{ severity: 'error', code: 'FACT_UNKNOWN', id, message: `Workspace @${workspace.id} has no fact @${id}` }]);
    }
    const dependencyIds = traverse(inspected.graph, id);
    const selected = new Set([id, ...dependencyIds]);
    const graph = subgraph(inspected.graph, selected);
    const graphNodes = byId(graph.nodes);
    const directDependencies = adjacency(graph).get(id) ?? [];
    const workspaceFact = inspected.facts.find((item) => item.id === id);
    const selectedFiles = new Set(inspected.manifest.results.filter((result) => selected.has(result.id)).flatMap((result) => [result.file, result.proof_file].filter((file) => Boolean(file))));
    const diagnostics = inspected.diagnostics.filter((item) => item.id ? selected.has(item.id) : !item.file || selectedFiles.has(item.file) || item.code === 'WORKSPACE_STALE');
    const check = {
        id,
        status: fact.status,
        programmatic: {
            status: workspaceFact?.programmatic?.status ?? 'fail',
            references: fact.reference_checks ?? []
        },
        ai: workspaceFact?.ai ?? { status: 'not-run', reason: 'No workspace outcome was recorded.' },
        diagnostics: diagnostics.filter((item) => item.id === id || item.file === fact.file)
    };
    const aggregate = buildAggregateSnapshot(index, new Map([[workspace.id, inspected]]));
    const snapshotPublished = await publishAggregateSnapshot(index, aggregate, options);
    return {
        schema_version: 3,
        operation: 'inspect-fact',
        ok: check.programmatic.status === 'pass' && check.ai.status === 'pass',
        snapshot_id: aggregate.snapshot_id,
        snapshot_published: snapshotPublished,
        scope: { type: 'fact', id, workspace: workspace.id },
        fact,
        check,
        source: { statement: fact.statement_text, proof: fact.proof_text },
        graph,
        direct_dependencies: directDependencies.map((dependency) => graphNodes.get(dependency)).filter(Boolean),
        transitive_dependencies: [...dependencyIds].sort().map((dependency) => graphNodes.get(dependency)).filter(Boolean),
        direct_reverse_dependencies: [],
        blockers: blockerPaths(graph, [id]),
        staleness: inspected.staleness,
        verification: workspaceVerification(inspected),
        diagnostics
    };
}
export async function inspectFact(root, requested, options = {}) {
    const index = await buildProjectInspectionIndex(root, options);
    return inspectIndexedFact(index, cleanId(requested), options);
}
function isWithinPath(file, selected, isDirectory) {
    return isDirectory ? file === selected || file.startsWith(`${selected}/`) : file === selected;
}
export async function inspectPath(root, requestedPath, options = {}) {
    root = path.resolve(root);
    const absolute = path.resolve(root, requestedPath);
    const relative = relativePosix(root, absolute);
    const failure = (diagnostics) => ({
        schema_version: 3, operation: 'inspect-path', ok: false, snapshot_published: false,
        scope: { type: 'path', path: relative }, summary: { files: 0, facts: 0, errors: diagnostics.length },
        facts: [], graph: emptyGraph(), verification: emptyVerification(),
        staleness: { schema_version: 3, operation: 'check-staleness', ok: false, changed: [], invalidated: [] },
        findings: deriveGraphFindings({ graph: emptyGraph(), manifest: { schema_version: 3, files: [], results: [], proofs: [] }, diagnostics }), diagnostics
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
    if (index.fatal)
        return failure(index.globalDiagnostics);
    const containing = index.workspaces.find((workspace) => absolute === workspace.directory || absolute.startsWith(`${workspace.directory}${path.sep}`));
    if (containing) {
        if (containing.status !== 'initialized' || !containing.compilation)
            return failure(containing.diagnostics);
        const selectedFiles = new Set(containing.compilation.manifest.files.filter((file) => isWithinPath(file.path, relative, info.isDirectory())).map((file) => file.path));
        const selectedIds = new Set(containing.compilation.manifest.results.filter((result) => selectedFiles.has(result.file)).map((result) => result.id));
        for (const proof of containing.compilation.manifest.proofs)
            if (selectedFiles.has(proof.file))
                selectedIds.add(proof.target);
        if (absolute === containing.directory) {
            for (const result of containing.compilation.manifest.results)
                selectedIds.add(result.id);
            selectedIds.add(containing.id);
        }
        if (selectedIds.size === 0) {
            const aggregate = buildAggregateSnapshot(index);
            const published = await publishAggregateSnapshot(index, aggregate, options);
            return {
                schema_version: 3, operation: 'inspect-path', ok: true, snapshot_id: aggregate.snapshot_id, snapshot_published: published,
                scope: { type: info.isDirectory() ? 'folder' : 'file', path: relative, workspace: containing.id },
                summary: { files: selectedFiles.size, facts: 0, errors: 0 }, facts: [], graph: emptyGraph(), verification: emptyVerification(),
                staleness: { schema_version: 3, operation: 'check-staleness', ok: true, changed: [], invalidated: [] },
                findings: deriveGraphFindings({ graph: emptyGraph(), manifest: { schema_version: 3, files: [], results: [], proofs: [] }, diagnostics: [] }), diagnostics: []
            };
        }
        const inspected = await inspectWorkspace(root, containing.id, { ...options, selectedIds, skipProjectPreflight: true });
        const contextIds = new Set(selectedIds);
        for (const id of selectedIds)
            for (const dependency of traverse(inspected.graph, id))
                contextIds.add(dependency);
        const graph = subgraph(inspected.graph, contextIds);
        graph.nodes = graph.nodes.map((node) => ({ ...node, scope: selectedIds.has(node.id) ? 'selected' : 'external' }));
        const selectedFacts = inspected.facts.filter((fact) => selectedIds.has(fact.id));
        const facts = selectedFacts.map((fact) => inspectedFactCheck(inspected, fact.id));
        const diagnostics = inspected.diagnostics.filter((item) => (item.id && contextIds.has(item.id)) || (item.file && selectedFiles.has(item.file)));
        const aggregate = buildAggregateSnapshot(index, new Map([[containing.id, inspected]]));
        const published = await publishAggregateSnapshot(index, aggregate, options);
        return {
            schema_version: 3, operation: 'inspect-path',
            ok: facts.every((fact) => fact.programmatic.status === 'pass' && fact.ai.status === 'pass') && diagnostics.every((item) => item.severity !== 'error'),
            snapshot_id: aggregate.snapshot_id, snapshot_published: published,
            scope: { type: info.isDirectory() ? 'folder' : 'file', path: relative, workspace: containing.id },
            summary: { files: selectedFiles.size, facts: facts.length, errors: diagnostics.filter((item) => item.severity === 'error').length },
            facts, graph, blockers: blockerPaths(graph, [...selectedIds]),
            findings: deriveGraphFindings({ graph, manifest: inspected.manifest, diagnostics }, { selectedIds, selectedFiles }),
            staleness: inspected.staleness, verification: workspaceVerification(inspected), diagnostics
        };
    }
    const goals = index.goals.filter((goal) => isWithinPath(goal.file, relative, info.isDirectory()));
    const parseDiagnostics = index.goalsCompilation.diagnostics.filter((item) => item.code === 'PARSE_ERROR' && item.file && isWithinPath(item.file, relative, info.isDirectory()));
    if (parseDiagnostics.length)
        return failure(parseDiagnostics);
    if (!goals.length) {
        const aggregate = buildAggregateSnapshot(index);
        const published = await publishAggregateSnapshot(index, aggregate, options);
        return {
            schema_version: 3, operation: 'inspect-path', ok: true, snapshot_id: aggregate.snapshot_id, snapshot_published: published,
            scope: { type: info.isDirectory() ? 'folder' : 'file', path: relative }, summary: { files: info.isDirectory() ? index.notes.filter((note) => isWithinPath(note.path, relative, true)).length : 1, facts: 0, errors: 0 },
            facts: [], graph: emptyGraph(), verification: emptyVerification(), staleness: { schema_version: 3, operation: 'check-staleness', ok: true, changed: [], invalidated: [] }, diagnostics: [],
            findings: deriveGraphFindings({ graph: emptyGraph(), manifest: { schema_version: 3, files: [], results: [], proofs: [] }, diagnostics: [] })
        };
    }
    const factResults = [];
    for (const goal of goals)
        factResults.push(await inspectIndexedFact(index, goal.id, options));
    const facts = factResults.map((result) => result.check);
    const diagnostics = factResults.flatMap((result) => result.diagnostics);
    const verification = emptyVerification();
    for (const result of factResults)
        addVerification(verification, result.verification);
    const ids = new Set(factResults.flatMap((result) => result.graph.nodes.map((node) => node.id)));
    const aggregate = buildAggregateSnapshot(index);
    return {
        schema_version: 3, operation: 'inspect-path', ok: factResults.every((result) => result.ok === true), snapshot_id: aggregate.snapshot_id,
        scope: { type: info.isDirectory() ? 'folder' : 'file', path: relative }, summary: { files: info.isDirectory() ? index.notes.filter((note) => isWithinPath(note.path, relative, true)).length : 1, facts: facts.length, errors: diagnostics.filter((item) => item.severity === 'error').length },
        facts, graph: subgraph(aggregate.graph, ids), verification,
        staleness: { schema_version: 3, operation: 'check-staleness', ok: factResults.every((result) => result.staleness.ok === true), changed: [], invalidated: [] },
        findings: deriveGraphFindings(aggregate, { selectedIds: goals.map((goal) => goal.id) }), diagnostics
    };
}
async function latestSnapshot(root, options = {}) {
    const index = await buildProjectInspectionIndex(root, options);
    if (index.fatal)
        throw Object.assign(new Error('Global duplicate IDs block dependency analysis'), { code: 'GLOBAL_DUPLICATE_ID', diagnostics: index.globalDiagnostics });
    const current = buildAggregateSnapshot(index);
    try {
        const pointer = await readJson(path.join(index.root, AUX, 'graphs', 'latest.json'));
        const snapshotFile = path.resolve(index.root, pointer.file);
        const graphsRoot = path.join(index.root, AUX, 'graphs');
        if (!snapshotFile.startsWith(`${graphsRoot}${path.sep}`))
            throw new Error('Aggregate snapshot pointer escapes the graph directory');
        const saved = await readJson(snapshotFile);
        if (saved.schema_version === 3
            && saved.snapshot_id === pointer.snapshot_id
            && aggregateSourceSignature(saved) === aggregateSourceSignature(current))
            return saved;
    }
    catch { /* Missing, legacy, corrupt, or stale snapshots are rebuilt below. */ }
    await publishAggregateSnapshot(index, current, options);
    return current;
}
export async function analyzeDependencies(root, operation, args = [], options = {}) {
    let snapshot;
    try {
        snapshot = await latestSnapshot(root, options);
    }
    catch (error) {
        const failure = error;
        return {
            schema_version: 3, operation: `dependency-${operation}`, ok: false,
            diagnostics: failure.diagnostics ?? [{ severity: 'error', code: failure.code ?? 'DEPENDENCY_SNAPSHOT_FAILED', message: failure.message ?? String(error) }]
        };
    }
    const { graph } = snapshot;
    const requested = args[0];
    const requiredIds = [
        ...(['dependencies', 'reverse-dependencies', 'impact', 'frontier'].includes(operation) ? [requested] : []),
        ...(['path', 'alternative-paths'].includes(operation) ? [requested, args[1]] : []),
        ...(operation === 'search' ? [options.relatedTo, options.usedBy, options.dependsOn, options.affectedBy, options.staleAffectedBy, options.frontierOf] : [])
    ].filter((value) => typeof value === 'string' && value.length > 0);
    const missing = requiredIds.map(cleanId).filter((id) => !graph.nodes.some((node) => node.id === id));
    if (missing.length)
        return {
            schema_version: 3, operation: `dependency-${operation}`, ok: false, snapshot_id: snapshot.snapshot_id,
            diagnostics: missing.map((id) => ({ severity: 'error', code: 'FACT_UNKNOWN', id, message: `Unknown fact in aggregate workspace graph: @${id}` }))
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
        result = { from, to, ...paths, alternatives: paths.paths.slice(1) };
    }
    else if (operation === 'cycles') {
        result = { cycles: graph.cycles ?? [] };
    }
    else if (operation === 'impact') {
        const node = requireNode(graph, requested);
        const nodes = byId(graph.nodes);
        result = {
            target: node,
            affected: [...traverse(graph, node.id, true)].sort().map((id) => nodes.get(id)).filter((item) => item?.status === 'workspace-verified')
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
    return {
        schema_version: 3,
        operation: `dependency-${operation}`,
        ok: diagnostics.every((item) => item.severity !== 'error'),
        snapshot_id: snapshot.snapshot_id,
        graph,
        diagnostics,
        ...result
    };
}
