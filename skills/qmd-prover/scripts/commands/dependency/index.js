import { cleanId } from '../../core/infrastructure/files.js';
import { SCHEMA_VERSION, byId } from '../../core/shared/core.js';
import { adjacency, allSimplePaths, boundedInteger, frontier, requireNode, shortestPath, traverse } from '../../core/graph/algorithms.js';
import { deriveGraphFindings, staleFactIds } from '../../core/graph/findings.js';
import { resolveProjectSnapshot } from '../../core/graph/snapshot.js';
import { compileProject } from '../../core/semantic/compiler.js';
import { verificationContext } from '../../core/verification/protocol.js';
async function latestSnapshot(root, options = {}) {
    const compilation = await compileProject(root, options);
    const context = await verificationContext(compilation);
    return resolveProjectSnapshot(compilation, context.contextHash, options);
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
