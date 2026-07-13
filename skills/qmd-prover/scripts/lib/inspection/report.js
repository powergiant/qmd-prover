import { indexBy } from '../shared/core.js';
import { blockerPaths } from './graph.js';
import { deriveGraphFindings } from './findings.js';
function byId(items) {
    return indexBy(items, (item) => item.id);
}
function formatPath(ids) {
    return ids?.map((id) => `@${id}`).join(' -> ') ?? 'none';
}
function formatCounts(counts = {}) {
    const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
    return entries.map(([name, count]) => `${name}=${count}`).join(', ') || 'none';
}
function inspectedNodes(result) {
    if (!result.graph?.nodes)
        return [];
    const nodes = byId(result.graph.nodes);
    let ids = [];
    if (result.fact)
        ids = [result.fact.id];
    else if (result.facts?.some((item) => item.programmatic))
        ids = result.facts.map((item) => item.id);
    else if (result.manifest?.results)
        ids = result.manifest.results.map((item) => item.id);
    else
        ids = result.graph.nodes.filter((node) => node.scope !== 'external' && node.origin !== 'unresolved').map((node) => node.id);
    return [...new Set(ids)].map((id) => nodes.get(id))
        .filter((node) => node !== undefined)
        .sort((left, right) => left.id.localeCompare(right.id));
}
function reportFindings(lines, findings) {
    if (!findings)
        return;
    lines.push('graph findings:');
    if (findings.unused_imports !== undefined) {
        lines.push(`  unused imports: ${findings.unused_imports.length}`);
        for (const item of findings.unused_imports)
            lines.push(`    ${item.file}: @${item.id} from ${item.from}`);
    }
    if (findings.unused_exports !== undefined) {
        lines.push(`  unused exports: ${findings.unused_exports.length}`);
        for (const item of findings.unused_exports)
            lines.push(`    @${item.id} (${item.export}) ${item.file}:${item.line ?? '?'}`);
    }
    if (findings.isolated_facts !== undefined) {
        lines.push(`  isolated facts: ${findings.isolated_facts.length}`);
        for (const item of findings.isolated_facts)
            lines.push(`    @${item.id} [${item.status}] ${item.file ?? ''}`.trimEnd());
    }
    if (findings.unreachable !== undefined) {
        const unreachable = findings.unreachable;
        lines.push(`  unreachable facts: ${unreachable.applicable === false ? 'not applicable (no goal root)' : unreachable.facts.length}`);
        for (const item of unreachable.facts)
            lines.push(`    @${item.id} [${item.status}] ${item.file ?? ''}`.trimEnd());
    }
    if (findings.candidate_ready_for_ai !== undefined) {
        lines.push(`  candidates ready for AI: ${findings.candidate_ready_for_ai.length}`);
        for (const item of findings.candidate_ready_for_ai)
            lines.push(`    @${item.id} [${item.kind}] ${item.file ?? ''}`.trimEnd());
    }
    if (findings.invalid_evidence_dependents !== undefined) {
        lines.push(`  invalid-evidence dependents: ${findings.invalid_evidence_dependents.length}`);
        for (const item of findings.invalid_evidence_dependents)
            lines.push(`    @${item.fact.id} via ${item.invalid_sources.map((id) => `@${id}`).join(', ')}`);
    }
    if (findings.heavily_reused !== undefined) {
        lines.push(`  heavily reused facts: ${findings.heavily_reused.length}`);
        for (const item of findings.heavily_reused.slice(0, 20)) {
            lines.push(`    @${item.fact.id}: direct=${item.direct_dependents}, transitive=${item.transitive_dependents}, verified=${item.verified_dependents}`);
        }
    }
}
export function printReport(input) {
    const result = input;
    const lines = [`qmd-prover ${result.operation}`, `snapshot: ${result.snapshot_id ?? 'none'}`];
    if (typeof result.ok === 'boolean')
        lines.push(`status: ${result.ok ? 'ok' : 'failed'}`);
    if (result.scope)
        lines.push(`scope: ${result.scope.type} ${result.scope.id ? `@${result.scope.id}` : result.scope.path}`);
    if (result.workspace)
        lines.push(`workspace: ${result.workspace}`);
    if (result.target?.id)
        lines.push(`target: @${result.target.id} [${result.target.status ?? 'missing'}]`);
    if (result.workspace_staleness)
        lines.push(`workspace snapshot: ${result.workspace_staleness.stale ? 'stale' : 'current'} (target=${result.workspace_staleness.target_stale ? 'stale' : 'current'}, dependencies=${result.workspace_staleness.dependency_stale ? 'stale' : 'current'})`);
    if (result.summary) {
        lines.push(`files: ${result.summary.files ?? 0}`);
        lines.push(`facts: ${result.summary.facts ?? result.summary.results ?? 0}`);
        lines.push(`kinds: ${formatCounts(result.summary.kinds)}`);
        lines.push(`statuses: ${formatCounts(result.summary.statuses)}`);
        lines.push(`errors: ${result.summary.errors ?? result.diagnostics?.filter((item) => item.severity === 'error').length ?? 0}`);
    }
    if (result.verification) {
        lines.push(`verification: calls=${result.verification.verifier_calls ?? 0}, cache-hits=${result.verification.cache_hits ?? 0}, passed=${result.verification.passed ?? 0}, rejected=${result.verification.rejected ?? 0}, errors=${result.verification.errors ?? 0}, not-run=${result.verification.not_run ?? 0}`);
    }
    if (result.staleness) {
        lines.push(`staleness: ${result.staleness.ok ? 'checked' : 'failed'}, changed=${result.staleness.changed?.length ?? 0}, invalidated=${result.staleness.invalidated?.length ?? 0}`);
        for (const item of result.staleness.changed ?? []) {
            lines.push(`  changed @${item.id}: ${item.reasons.join(', ')}`);
            if (item.previous !== undefined)
                lines.push(`    previous: ${JSON.stringify(item.previous)}`);
            if (item.current !== undefined)
                lines.push(`    current: ${JSON.stringify(item.current)}`);
        }
        for (const item of result.staleness.invalidated ?? [])
            lines.push(`  invalidated @${item.id}: ${formatPath(item.path)}`);
    }
    if (result.fact)
        lines.push(`fact: @${result.fact.id} [${result.fact.kind}, ${result.fact.status}] ${result.fact.file}:${result.fact.line ?? '?'}`);
    const nodes = inspectedNodes(result);
    if (nodes.length) {
        if (!result.summary) {
            const kinds = {};
            const statuses = {};
            for (const node of nodes) {
                const kind = node.kind ?? 'unknown';
                kinds[kind] = (kinds[kind] ?? 0) + 1;
                statuses[node.status] = (statuses[node.status] ?? 0) + 1;
            }
            lines.push(`facts: ${nodes.length}`, `kinds: ${formatCounts(kinds)}`, `statuses: ${formatCounts(statuses)}`);
        }
        const byFile = new Map();
        for (const node of nodes) {
            if (!byFile.has(node.file ?? '(unknown)'))
                byFile.set(node.file ?? '(unknown)', []);
            byFile.get(node.file ?? '(unknown)')?.push(node);
        }
        lines.push('facts by file:');
        for (const [file, facts] of [...byFile].sort(([left], [right]) => left.localeCompare(right))) {
            lines.push(`  ${file}: ${facts.map((item) => `@${item.id} [${item.kind}, ${item.status}]`).join(', ')}`);
        }
    }
    if (result.manifest?.canonical_results?.length) {
        lines.push('canonical facts used by workspace:');
        for (const item of [...result.manifest.canonical_results].sort((left, right) => left.id.localeCompare(right.id))) {
            lines.push(`  @${item.id} [${item.kind}, ${item.status}] ${item.file}:${item.line ?? '?'}`);
        }
    }
    const checks = result.check ? [result.check] : (result.facts ?? []).filter((item) => item.programmatic !== undefined && item.ai !== undefined);
    if (checks.length) {
        lines.push('checks:');
        for (const check of [...checks].sort((left, right) => left.id.localeCompare(right.id))) {
            lines.push(`  @${check.id}: programmatic=${check.programmatic.status}, ai=${check.ai.status}${check.ai.source ? ` (${check.ai.source})` : ''}`);
            for (const reference of check.programmatic.references ?? []) {
                lines.push(`    -> @${reference.dependency}: existence=${reference.existence}, scope=${reference.scope}, status=${reference.status}, cycle=${reference.cycle}, ai=${reference.ai_sufficiency}`);
            }
            if (check.ai.reason)
                lines.push(`    AI: ${check.ai.reason}`);
            if (check.ai.error)
                lines.push(`    AI error${check.ai.code ? ` (${check.ai.code})` : ''}: ${check.ai.error}`);
            if (check.ai.details?.command)
                lines.push(`    verifier command: ${check.ai.details.command}`);
            if (check.ai.details?.exit_code !== undefined || check.ai.details?.signal)
                lines.push(`    verifier termination: exit=${check.ai.details.exit_code ?? 'none'}, signal=${check.ai.details.signal ?? 'none'}`);
            if (check.ai.details?.stderr_excerpt)
                lines.push(`    verifier stderr: ${check.ai.details.stderr_excerpt}`);
            if (check.ai.details?.stdout_excerpt)
                lines.push(`    verifier stdout: ${check.ai.details.stdout_excerpt}`);
            if (check.ai.remediation)
                lines.push(`    remediation: ${check.ai.remediation}`);
            if (check.ai.report) {
                if (check.ai.report.summary)
                    lines.push(`    summary: ${check.ai.report.summary}`);
                for (const error of check.ai.report.critical_errors ?? [])
                    lines.push(`    critical error: ${error}`);
                for (const gap of check.ai.report.gaps ?? [])
                    lines.push(`    gap: ${gap}`);
                for (const comment of check.ai.report.nonblocking_comments ?? [])
                    lines.push(`    comment: ${comment}`);
                if (check.ai.report.repair_hints)
                    lines.push(`    repair hints: ${check.ai.report.repair_hints}`);
            }
        }
    }
    if (result.direct_dependencies)
        lines.push(`direct dependencies: ${result.direct_dependencies.map((item) => `@${item.id}`).join(', ') || 'none'}`);
    if (result.transitive_dependencies)
        lines.push(`transitive dependencies: ${result.transitive_dependencies.map((item) => `@${item.id}`).join(', ') || 'none'}`);
    if (result.direct_reverse_dependencies)
        lines.push(`direct reverse dependencies: ${result.direct_reverse_dependencies.map((id) => `@${id}`).join(', ') || 'none'}`);
    const blockers = result.blockers ?? (result.graph && result.manifest?.target ? blockerPaths(result.graph, [result.manifest.target]) : []);
    if (blockers.length) {
        lines.push('blocking dependency paths:');
        for (const item of blockers)
            lines.push(`  @${item.root}: @${item.blocker.id} [${item.blocker.status}] via ${formatPath(item.path)}`);
    }
    if (result.frontier) {
        lines.push('frontier:');
        for (const item of result.frontier)
            lines.push(`  @${item.fact.id} [${item.fact.status}] via ${formatPath(item.path)}`);
    }
    if (result.changed?.length) {
        lines.push('stale identities:');
        for (const item of result.changed) {
            lines.push(`  @${item.id}: ${item.reasons.join(', ')}`);
            if (item.previous !== undefined)
                lines.push(`    previous: ${JSON.stringify(item.previous)}`);
            if (item.current !== undefined)
                lines.push(`    current: ${JSON.stringify(item.current)}`);
        }
        for (const item of result.invalidated ?? [])
            if (!result.changed.some((changed) => changed.id === item.id))
                lines.push(`  @${item.id}: via ${formatPath(item.path)}`);
        lines.push(`invalidated facts (stale history retained when present): ${(result.invalidated ?? []).map((item) => `@${item.id}`).join(', ') || 'none'}`);
    }
    else if (result.changed)
        lines.push('stale identities: none');
    if (result.direct)
        lines.push(`direct: ${result.direct.map((item) => `@${item.id}`).join(', ') || 'none'}`);
    if (result.transitive)
        lines.push(`transitive: ${result.transitive.map((item) => `@${item.id}`).join(', ') || 'none'}`);
    if (Object.hasOwn(result, 'path'))
        lines.push(`path: ${formatPath(result.path)}`);
    if (result.paths) {
        lines.push(`paths (${result.paths.length}${result.truncated ? ', truncated' : ''}):`);
        for (const [index, item] of result.paths.entries())
            lines.push(`  ${index + 1}. ${formatPath(item)}`);
    }
    if (result.cycles) {
        lines.push('cycles:');
        if (result.cycles.length === 0)
            lines.push('  none');
        for (const cycle of result.cycles)
            lines.push(`  ${formatPath(cycle)}`);
    }
    if (result.affected)
        lines.push(`affected verified facts: ${result.affected.map((item) => `@${item.id}`).join(', ') || 'none'}`);
    if (result.matches) {
        lines.push(`matches: ${result.matches.length}`);
        for (const item of result.matches)
            lines.push(`  @${item.id} [${item.kind}, ${item.status}] ${item.file ?? ''}:${item.line ?? '?'}`);
    }
    const reportDerivedFindings = result.findings ?? (result.operation === 'workspace-inspect' && result.graph && result.manifest
        ? deriveGraphFindings({ graph: result.graph, manifest: result.manifest, diagnostics: result.diagnostics ?? [] })
        : null);
    reportFindings(lines, reportDerivedFindings);
    if (result.unused_imports)
        reportFindings(lines, { unused_imports: result.unused_imports });
    if (result.unused_exports)
        reportFindings(lines, { unused_exports: result.unused_exports });
    if (result.candidates) {
        lines.push('candidates ready for AI:');
        for (const item of result.candidates)
            lines.push(`  @${item.id} [${item.kind}, ${item.status}] ${item.file ?? ''}`.trimEnd());
    }
    if (result.operation === 'dependency-isolated' || result.operation === 'dependency-unreachable') {
        lines.push(`${result.operation.slice('dependency-'.length)} facts:`);
        for (const item of result.facts ?? [])
            lines.push(`  @${item.id} [${item.kind}, ${item.status}] ${item.file ?? ''}`.trimEnd());
    }
    if (result.operation === 'dependency-reused') {
        lines.push(`heavily reused facts (${result.total} total):`);
        for (const item of result.facts ?? [])
            if (item.fact)
                lines.push(`  @${item.fact.id}: direct=${item.direct_dependents}, transitive=${item.transitive_dependents}, verified=${item.verified_dependents}`);
    }
    if (result.graph?.edges?.length) {
        const graphNodes = byId(result.graph.nodes);
        lines.push('dependencies:');
        for (const edge of result.graph.edges) {
            const checks = edge.checks;
            lines.push(`  @${edge.from} -> @${edge.to} [existence=${checks?.existence}, scope=${checks?.scope}, status=${checks?.status}, cycle=${checks?.cycle}, ai=${checks?.ai_sufficiency}]`);
        }
        const crossFile = result.graph.edges.filter((edge) => {
            const from = graphNodes.get(edge.from)?.file;
            const to = graphNodes.get(edge.to)?.file;
            return from && to && from !== to;
        });
        if (crossFile.length) {
            lines.push('cross-file dependencies:');
            for (const edge of crossFile)
                lines.push(`  ${graphNodes.get(edge.from)?.file} @${edge.from} -> ${graphNodes.get(edge.to)?.file} @${edge.to}`);
        }
    }
    if (result.diagnostics?.length) {
        lines.push('diagnostics:');
        for (const item of result.diagnostics)
            lines.push(`  ${item.severity} ${item.code}${item.id ? ` @${item.id}` : ''}: ${item.message}`);
    }
    return `${lines.join('\n')}\n`;
}
