/** The single compact fact reference used wherever a result lists facts. */
export function refNode(node) {
    return {
        id: node.id,
        ...(node.kind !== undefined ? { kind: node.kind } : {}),
        status: node.status ?? 'missing',
        ...(node.file !== undefined ? { file: node.file } : {}),
        ...(node.line !== undefined ? { line: node.line } : {})
    };
}
function reuseRef(item) {
    return {
        ...refNode(item.fact),
        direct_dependents: item.direct_dependents,
        transitive_dependents: item.transitive_dependents,
        verified_dependents: item.verified_dependents
    };
}
function leanBlockers(blockers) {
    return blockers.map((blocker) => ({ root: blocker.root, blocker: refNode(blocker.blocker), path: blocker.path }));
}
/** Category counts for the aggregate findings view (the full lists have dedicated commands). */
function findingCounts(findings) {
    return {
        unused_imports: findings.unused_imports.length,
        unused_exports: findings.unused_exports.length,
        isolated_facts: findings.isolated_facts.length,
        unreachable: findings.unreachable.applicable === false ? 'not-applicable' : findings.unreachable.facts.length,
        invalid_evidence_dependents: findings.invalid_evidence_dependents.length,
        candidate_ready_for_ai: findings.candidate_ready_for_ai.length,
        heavily_reused: findings.heavily_reused.length
    };
}
function record(result) {
    return { ...result };
}
/** inspect project / inspect path: dashboard summary + compact facts, no embedded graph. */
function leanInspect(result, options) {
    const graph = result.graph;
    const nodes = new Map((graph?.nodes ?? []).map((node) => [node.id, node]));
    const facts = (result.facts ?? []).map((fact) => {
        const entry = {
            id: fact.id,
            ...(fact.kind !== undefined ? { kind: fact.kind } : {}),
            status: fact.status,
            ...(fact.file !== undefined ? { file: fact.file } : {}),
            ...(fact.line !== undefined ? { line: fact.line } : {}),
            mechanical: fact.mechanical?.status,
            local: fact.local_verification?.outcome ?? fact.local_verification?.status,
            global: fact.global_verification?.status
        };
        // A disproved fact keeps its refutation evidence so the whole-project view still
        // answers "which facts are disproved and why" without an extra inspect-fact call.
        const disproof = nodes.get(fact.id)?.disproof;
        if (disproof)
            entry.disproof = disproof;
        return entry;
    });
    const lean = record(result);
    lean.facts = facts;
    if (result.blockers)
        lean.blockers = leanBlockers(result.blockers);
    if (result.findings)
        lean.findings = findingCounts(result.findings);
    // The embedded staleness block is always a not-computed stub; `check staleness` is the real audit.
    delete lean.staleness;
    if (!options.graph)
        delete lean.graph;
    return lean;
}
/** inspect fact: keep the per-fact detail, compact the dependency lists, drop the subgraph. */
function leanInspectFact(result, options) {
    const lean = record(result);
    if (result.direct_dependencies)
        lean.direct_dependencies = result.direct_dependencies.map(refNode);
    if (result.transitive_dependencies)
        lean.transitive_dependencies = result.transitive_dependencies.map(refNode);
    if (result.direct_reverse_dependencies)
        lean.direct_reverse_dependencies = result.direct_reverse_dependencies.map(refNode);
    if (result.blockers)
        lean.blockers = leanBlockers(result.blockers);
    delete lean.staleness;
    if (!options.graph)
        delete lean.graph;
    return lean;
}
function leanDependencies(result) {
    const direct = result.direct;
    const transitive = result.transitive;
    const lean = record(result);
    if (result.target)
        lean.target = refNode(result.target);
    lean.counts = { direct: direct?.length ?? 0, transitive: transitive?.length ?? 0 };
    if (direct)
        lean.direct = direct.map(refNode);
    if (transitive)
        lean.transitive = transitive.map(refNode);
    return lean;
}
function leanImpact(result) {
    const affected = result.affected;
    const lean = record(result);
    if (result.target)
        lean.target = refNode(result.target);
    lean.count = affected?.length ?? 0;
    if (affected)
        lean.affected = affected.map(refNode);
    return lean;
}
function leanFrontier(result) {
    const frontier = result.frontier;
    const lean = record(result);
    if (result.target)
        lean.target = refNode(result.target);
    lean.count = frontier?.length ?? 0;
    if (frontier)
        lean.frontier = frontier.map((item) => ({ fact: refNode(item.fact), path: item.path }));
    return lean;
}
function leanSearch(result) {
    const matches = result.matches;
    const lean = record(result);
    lean.count = matches?.length ?? 0;
    if (matches)
        lean.matches = matches.map(refNode);
    return lean;
}
function leanFindings(result) {
    const findings = result.findings;
    if (!findings)
        return result;
    const lean = record(result);
    lean.findings = {
        counts: findingCounts(findings),
        unused_imports: findings.unused_imports,
        unused_exports: findings.unused_exports,
        isolated_facts: findings.isolated_facts.map(refNode),
        unreachable: {
            applicable: findings.unreachable.applicable,
            roots: findings.unreachable.roots,
            facts: findings.unreachable.facts.map(refNode)
        },
        invalid_evidence_dependents: findings.invalid_evidence_dependents.map((item) => ({ fact: refNode(item.fact), invalid_sources: item.invalid_sources })),
        candidate_ready_for_ai: findings.candidate_ready_for_ai.map(refNode),
        heavily_reused: findings.heavily_reused.map(reuseRef)
    };
    return lean;
}
function leanReadyForAi(result) {
    const candidates = result.candidates;
    const lean = record(result);
    lean.count = candidates?.length ?? 0;
    if (candidates)
        lean.candidates = candidates.map(refNode);
    return lean;
}
function leanReused(result) {
    const facts = result.facts;
    const lean = record(result);
    if (facts)
        lean.facts = facts.map(reuseRef);
    return lean;
}
/** dependency isolated / unreachable: list of facts as compact refs. */
function leanNodeFacts(result) {
    const facts = result.facts;
    const lean = record(result);
    lean.count = facts?.length ?? 0;
    if (facts)
        lean.facts = facts.map(refNode);
    return lean;
}
/** Project a rich operation result down to the lean default CLI JSON view. */
export function leanView(result, options = {}) {
    switch (result.operation) {
        case 'inspect-project':
        case 'inspect-path':
            return leanInspect(result, options);
        case 'inspect-fact':
            return leanInspectFact(result, options);
        case 'dependency-dependencies':
        case 'dependency-reverse-dependencies':
            return leanDependencies(result);
        case 'dependency-impact':
            return leanImpact(result);
        case 'dependency-frontier':
            return leanFrontier(result);
        case 'dependency-search':
            return leanSearch(result);
        case 'dependency-findings':
            return leanFindings(result);
        case 'dependency-ready':
            return leanReadyForAi(result);
        case 'dependency-reused':
            return leanReused(result);
        case 'dependency-isolated':
        case 'dependency-unreachable':
            return leanNodeFacts(result);
        default:
            return result;
    }
}
