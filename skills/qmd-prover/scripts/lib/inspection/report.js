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
    else if (result.facts?.some((item) => item.mechanical))
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
    // A labelled field, not a runnable command: the operation slug is hyphenated
    // (dependency-reverse-dependencies) while the invocation is space-separated.
    const lines = [`operation: ${result.operation}`];
    if (result.snapshot_id)
        lines.push(`snapshot: ${result.snapshot_id}`);
    if (typeof result.ok === 'boolean')
        lines.push(`status: ${result.ok ? 'ok' : 'failed'}`);
    if (result.computed === false)
        lines.push('analysis: not computed');
    if (result.scope)
        lines.push(`scope: ${result.scope.type} ${result.scope.id ? `@${result.scope.id}` : result.scope.path}`);
    if (result.target?.id)
        lines.push(`target: @${result.target.id} [${result.target.status ?? 'missing'}]`);
    if (result.dependencies) {
        lines.push('dependencies:');
        for (const [name, dependency] of Object.entries(result.dependencies)) {
            lines.push(`  ${name}: ${dependency.available ? 'available' : dependency.required ? 'missing (required)' : 'not configured (optional)'}${dependency.command ? ` [${dependency.command}]` : ''}`);
            if (!dependency.available && dependency.remediation)
                lines.push(`    remediation: ${dependency.remediation}`);
        }
    }
    if (result.submissions) {
        lines.push(`verification submissions: ${result.submissions.length}`);
        for (const submission of result.submissions)
            lines.push(`  ${submission.submission_id}: @${submission.target ?? 'unknown'} [${submission.outcome ?? 'unknown'}] ${submission.file}`);
    }
    if (result.summary) {
        lines.push(`files: ${result.summary.files ?? 0}`);
        lines.push(`facts: ${result.summary.facts ?? result.summary.results ?? 0}`);
        lines.push(`kinds: ${formatCounts(result.summary.kinds)}`);
        lines.push(`statuses: ${formatCounts(result.summary.statuses)}`);
        lines.push(`errors: ${result.summary.errors ?? result.diagnostics?.filter((item) => item.severity === 'error').length ?? 0}`);
    }
    if (result.verification) {
        lines.push(`verification: available=${result.verification.available}, calls=${result.verification.verifier_calls ?? 0}, cache-hits=${result.verification.cache_hits ?? 0}, time=${Math.round((result.verification.verifier_duration_ms ?? 0) / 1000)}s, tokens=${result.verification.verifier_tokens ?? 0}, local-verified=${result.verification.local_verified ?? 0}, local-disproved=${result.verification.local_disproved ?? 0}, local-rejected=${result.verification.local_rejected ?? 0}, local-errors=${result.verification.local_errors ?? 0}, local-not-run=${result.verification.local_not_run ?? 0}, global-verified=${result.verification.global_verified ?? 0}, global-disproved=${result.verification.global_disproved ?? 0}, global-blocked=${result.verification.global_blocked ?? 0}, global-unverified=${result.verification.global_unverified ?? 0}, global-rejected=${result.verification.global_rejected ?? 0}, global-invalid=${result.verification.global_invalid ?? 0}`);
    }
    if (result.staleness) {
        lines.push(`staleness: ${result.staleness.ok ? 'checked' : 'failed'}, changed=${result.staleness.changed?.length ?? 0}, invalidated=${result.staleness.invalidated?.length ?? 0}`);
        for (const item of result.staleness.changed ?? []) {
            lines.push(`  changed @${item.id}: ${item.reasons.join(', ')}`);
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
        for (const node of nodes.filter((item) => item.disproof)) {
            lines.push(`${node.disproof?.status ?? 'conditional'} disproof @${node.id}: ${node.disproof?.refutation}`);
        }
    }
    const checks = result.check ? [result.check] : (result.facts ?? []).filter((item) => item.mechanical !== undefined
        && item.local_verification !== undefined && item.global_verification !== undefined);
    if (checks.length) {
        lines.push('checks:');
        for (const check of [...checks].sort((left, right) => left.id.localeCompare(right.id))) {
            lines.push(`  @${check.id}: mechanical=${check.mechanical.status}${check.mechanical.reason ? ` (${check.mechanical.reason})` : ''}, local=${check.local_verification.status}${check.local_verification.outcome ? `, outcome=${check.local_verification.outcome}` : ''}${check.local_verification.source ? ` (${check.local_verification.source})` : ''}, global=${check.global_verification.status}`);
            if (check.global_verification.blockers.length)
                lines.push(`    global blockers: ${check.global_verification.blockers.map((id) => `@${id}`).join(', ')}`);
            for (const reference of check.mechanical.references ?? []) {
                lines.push(`    -> @${reference.dependency}: existence=${reference.existence}, scope=${reference.scope}, cycle=${reference.cycle}`);
            }
            const local = check.local_verification;
            if (local.metrics) {
                const tokens = local.metrics.usage?.total_tokens;
                lines.push(`    verifier metrics: ${local.metrics.cached ? 'cached; ' : ''}time=${(local.metrics.duration_ms / 1000).toFixed(1)}s${tokens != null ? `, tokens=${tokens}` : ''}`);
            }
            if (local.reason)
                lines.push(`    local verification: ${local.reason}`);
            if (local.error)
                lines.push(`    verifier error${local.code ? ` (${local.code})` : ''}: ${local.error}`);
            if (local.details?.command)
                lines.push(`    verifier command: ${local.details.command}`);
            if (local.details?.exit_code !== undefined || local.details?.signal)
                lines.push(`    verifier termination: exit=${local.details.exit_code ?? 'none'}, signal=${local.details.signal ?? 'none'}`);
            if (local.details?.stderr_excerpt)
                lines.push(`    verifier stderr: ${local.details.stderr_excerpt}`);
            if (local.details?.stdout_excerpt)
                lines.push(`    verifier stdout: ${local.details.stdout_excerpt}`);
            if (local.remediation)
                lines.push(`    remediation: ${local.remediation}`);
            if (local.report) {
                if (local.report.summary)
                    lines.push(`    summary: ${local.report.summary}`);
                if (local.report.refutation)
                    lines.push(`    refutation: ${local.report.refutation}`);
                for (const error of local.report.critical_errors ?? [])
                    lines.push(`    critical error: ${error}`);
                for (const gap of local.report.gaps ?? [])
                    lines.push(`    gap: ${gap}`);
                for (const comment of local.report.nonblocking_comments ?? [])
                    lines.push(`    comment: ${comment}`);
                if (local.report.repair_hints)
                    lines.push(`    repair hints: ${local.report.repair_hints}`);
            }
        }
    }
    if (result.direct_dependencies)
        lines.push(`direct dependencies: ${result.direct_dependencies.map((item) => `@${item.id}`).join(', ') || 'none'}`);
    if (result.transitive_dependencies)
        lines.push(`transitive dependencies: ${result.transitive_dependencies.map((item) => `@${item.id}`).join(', ') || 'none'}`);
    if (result.direct_reverse_dependencies)
        lines.push(`direct reverse dependencies: ${result.direct_reverse_dependencies.map((item) => `@${item.id}`).join(', ') || 'none'}`);
    const blockers = result.blockers ?? [];
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
        lines.push(`affected facts: ${result.affected.map((item) => `@${item.id}`).join(', ') || 'none'}`);
    if (result.matches) {
        lines.push(`matches: ${result.matches.length}`);
        for (const item of result.matches)
            lines.push(`  @${item.id} [${item.kind}, ${item.status}] ${item.file ?? ''}:${item.line ?? '?'}`);
    }
    reportFindings(lines, result.findings ?? null);
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
            lines.push(`  @${edge.from} -> @${edge.to} [existence=${checks?.existence}, scope=${checks?.scope}, cycle=${checks?.cycle}]`);
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
        const groups = new Map();
        for (const item of result.diagnostics) {
            const key = `${item.severity}\0${item.code}\0${item.id ?? ''}\0${item.message}\0${item.remediation ?? ''}`;
            const group = groups.get(key) ?? [];
            group.push(item);
            groups.set(key, group);
        }
        for (const group of groups.values()) {
            const item = group[0];
            if (!item)
                continue;
            const locations = [...new Set(group.filter((entry) => entry.file).map((entry) => `${entry.file}${entry.line ? `:${entry.line}` : ''}`))].sort();
            if (group.length > 1 && locations.length > 1) {
                lines.push(`  ${item.severity} ${item.code}${item.id ? ` @${item.id}` : ''} (${locations.length} locations): ${item.message}`);
                lines.push(`    files: ${locations.join(', ')}`);
            }
            else {
                const location = item.file ? ` ${item.file}${item.line ? `:${item.line}` : ''}` : '';
                lines.push(`  ${item.severity} ${item.code}${item.id ? ` @${item.id}` : ''}${location}: ${item.message}`);
            }
        }
    }
    return `${lines.join('\n')}\n`;
}
