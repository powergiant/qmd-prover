import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { compileProject, factStatus } from '../semantic/compiler.js';
import { externalPolicyHash } from '../infrastructure/external.js';
import { atomicJson, atomicWrite, relativePosix, sha256, stableJson } from '../infrastructure/files.js';
import { auxLayout } from '../infrastructure/aux.js';
import { locateDiv, locateProofs, readLocatedBlock, readLocatedProof, setStatusAttribute } from '../semantic/source.js';
import { buildVerifierPacket, checkerContract, configured, invokeVerifier, verificationContext, verificationKey, verificationOutcome } from '../verification/protocol.js';
import { cachedDecision, verifierFailure } from '../verification/cache.js';
import { asErrorLike, SCHEMA_VERSION } from '../shared/core.js';
import { projectSourceSignature, readPublishedSnapshot } from './snapshot.js';
/** The trimmed body text of a located block, or '' when absent. Markers no longer live in the body,
 *  so the verifier packet uses the block text verbatim. */
function blockText(value) {
    return String(value ?? '').trim();
}
function references(result) {
    return [...(result.reference_checks ?? [])].sort((left, right) => left.dependency.localeCompare(right.dependency));
}
export function topologicalOrder(results) {
    const ids = new Set(results.map((result) => result.id));
    const byId = new Map(results.map((result) => [result.id, result]));
    const pending = new Map(results.map((result) => [
        result.id,
        new Set(result.dependencies.filter((dependency) => ids.has(dependency)))
    ]));
    const dependents = new Map(results.map((result) => [result.id, []]));
    for (const result of results) {
        for (const dependency of pending.get(result.id) ?? [])
            dependents.get(dependency)?.push(result.id);
    }
    for (const values of dependents.values())
        values.sort();
    const ready = [...pending].filter(([, dependencies]) => dependencies.size === 0).map(([id]) => id).sort();
    const scheduled = new Set(ready);
    const ordered = [];
    while (ready.length) {
        const id = ready.shift();
        if (!id)
            continue;
        const selected = byId.get(id);
        if (!selected)
            continue;
        ordered.push(selected);
        for (const dependent of dependents.get(id) ?? []) {
            pending.get(dependent)?.delete(id);
            if (pending.get(dependent)?.size === 0 && !scheduled.has(dependent)) {
                ready.push(dependent);
                scheduled.add(dependent);
                ready.sort();
            }
        }
    }
    const seen = new Set(ordered.map((result) => result.id));
    ordered.push(...results.filter((result) => !seen.has(result.id)).sort((left, right) => left.id.localeCompare(right.id)));
    return ordered;
}
/**
 * Machine analysis, local conditional verification, and global composition for the
 * whole project (or the dependency closure of the selected facts). Mutates the
 * indexed results' status, local_verification, global_verification, and disproof.
 *
 * Data dependencies between the stages (each name is a `const` below):
 *
 *   selection   {requestedIds, verificationIds}
 *       │   verificationIds also scopes localVerification, composition, counts, and `selected`
 *       ▼
 *   baseline   {previousById, diagnostics}   —— mutates results in place
 *       │ diagnostics                          │ previousById
 *       ▼                                      │
 *   mechanicalDiagnostics                      │
 *       │  (read by the references /           │
 *       │   relevantErrors toolkit)            │
 *       ├──────────────── toolkit ──────┐      │
 *       │ toolkit                       ▼      ▼
 *       │                          localVerification   {outcomes, tally}
 *       │                               │             │
 *       ▼                               │ outcomes    └─ outcomes ─▶ aiDiagnostics
 *   composition   ◄──── outcomes ───────┘
 *   {facts}
 *       │
 *       ▼
 *   counts
 *
 *   verification = {...localVerification.tally, ...counts}
 *   diagnostics  = sort(mechanicalDiagnostics ++ aiDiagnostics)
 *   return { verification, facts: composition.facts, diagnostics, selected: verificationIds }
 */
export async function verifyFacts(compilation, context, options = {}) {
    const root = compilation.root;
    const config = compilation.config;
    const results = compilation.manifest.results;
    const resultById = new Map(results.map((result) => [result.id, result]));
    const externalBasis = context.externalBasis;
    const verifierAvailable = configured(config);
    // Stage: which facts this run actually re-verifies — everything, or the
    // dependency closure of the explicitly requested ids.
    const { requestedIds, verificationIds } = (() => {
        const requestedIds = options.selectedIds
            ? new Set([...options.selectedIds].map((selected) => String(selected).replace(/^@/, '')))
            : null;
        const verificationIds = requestedIds ? new Set() : new Set(results.map((result) => result.id));
        const selectDependencyClosure = (selected) => {
            if (verificationIds.has(selected))
                return;
            const result = resultById.get(selected);
            if (!result)
                return;
            verificationIds.add(selected);
            for (const dependency of result.dependencies)
                if (resultById.has(dependency))
                    selectDependencyClosure(dependency);
        };
        for (const selected of requestedIds ?? [])
            selectDependencyClosure(selected);
        return { requestedIds, verificationIds };
    })();
    // Stage: fold the last published snapshot into the live results (carrying
    // unchanged prior verdicts forward), and surface the prior AI diagnostics
    // that fall outside the current selection. The carry-over mutates `results`,
    // which is this function's documented contract.
    const baseline = await (async () => {
        const previousSnapshot = await readPublishedSnapshot(compilation, context.contextHash);
        const previousById = new Map((previousSnapshot?.manifest.results ?? []).map((result) => [result.id, result]));
        for (const result of results) {
            const previous = previousById.get(result.id);
            if (!previous || previous.statement_hash !== result.statement_hash || previous.proof_hash !== result.proof_hash
                || stableJson(previous.dependencies, 0) !== stableJson(result.dependencies, 0))
                continue;
            if (previous.global_verification) {
                result.status = previous.status;
                result.global_verification = previous.global_verification;
                if (previous.disproof)
                    result.disproof = previous.disproof;
            }
        }
        const diagnostics = (requestedIds && previousSnapshot)
            ? previousSnapshot.diagnostics.filter((item) => (item.id !== undefined && !verificationIds.has(item.id) && item.code.startsWith('AI_')))
            : [];
        return { previousById, diagnostics };
    })();
    const previousById = baseline.previousById;
    // The mechanical baseline: compilation errors plus carried-over AI diagnostics.
    // The verification toolkit reads exactly this set; AI verdicts raised later in
    // this run are appended only to the final diagnostics, never to this base.
    const mechanicalDiagnostics = [...compilation.diagnostics, ...baseline.diagnostics];
    function relevantErrors(result) {
        return mechanicalDiagnostics.filter((item) => item.severity === 'error' && (item.id
            ? item.id === result.id
            : item.file === result.file || (result.proof_file && item.file === result.proof_file)));
    }
    // Stage: local conditional verification. Walks the graph in dependency order,
    // producing one LocalOutcome per fact plus the run-cost tally. Verifier cache
    // writes and the `result.disproof` updates are the side effects kept local to
    // this stage.
    const localVerification = await (async () => {
        const outcomes = new Map();
        const tally = {
            available: verifierAvailable,
            eligible: 0,
            verifier_calls: 0,
            cache_hits: 0,
            cache_misses: 0,
            invalid_cache_entries: 0,
            verifier_duration_ms: 0,
            verifier_tokens: 0,
            stopped_after: null
        };
        let fatal = null;
        const initialSourceSignature = projectSourceSignature(compilation, context.contextHash);
        // Source blocks read for the verifier packets, memoised for this stage only.
        const locatedBlocks = new Map();
        const located = async (result) => {
            const key = `${result.id}:${result.file}`;
            const cached = locatedBlocks.get(key);
            if (cached)
                return cached;
            const value = await readLocatedBlock(path.join(root, result.file), result.id);
            if (!value)
                throw Object.assign(new Error(`Source block for @${result.id} disappeared during inspection`), { code: 'SOURCE_STALE' });
            locatedBlocks.set(key, value);
            return value;
        };
        for (const result of topologicalOrder(results)) {
            if (!verificationIds.has(result.id)) {
                const previous = previousById.get(result.id);
                if (previous?.local_verification) {
                    outcomes.set(result.id, previous.local_verification);
                }
                else {
                    outcomes.set(result.id, {
                        status: 'not-run',
                        reason: 'Local verification was outside the selected fact/path dependency closure.'
                    });
                }
                continue;
            }
            const eligibility = (() => {
                if (!compilation.complete)
                    return { ready: false, reason: 'semantic-parse-incomplete' };
                if (result.abandon)
                    return { ready: false, reason: 'abandoned' };
                if (result.kind !== 'definition' && !result.proof_present)
                    return { ready: false, reason: 'proof-missing' };
                if (references(result).some((check) => check.existence !== 'pass')) {
                    return { ready: false, reason: 'dependency-context-unavailable' };
                }
                const blockingErrors = relevantErrors(result).filter((item) => ![
                    'DEPENDENCY_UNAVAILABLE', 'DEPENDENCY_CYCLE', 'IMPORT_CYCLE'
                ].includes(item.code));
                if (blockingErrors.length)
                    return { ready: false, reason: 'local-context-invalid' };
                return { ready: true };
            })();
            if (!eligibility.ready) {
                outcomes.set(result.id, {
                    status: 'not-run',
                    reason: eligibility.reason === 'proof-missing'
                        ? 'No complete proof is present.'
                        : eligibility.reason === 'abandoned'
                            ? 'The proof is abandoned: detached from its result and kept only for memory.'
                            : `Local conditional verification did not run because ${eligibility.reason}.`
                });
                continue;
            }
            tally.eligible += 1;
            if (!verifierAvailable) {
                outcomes.set(result.id, {
                    status: 'not-run',
                    reason: 'No verifier is configured; the machine dependency analysis remains available and this local result is unverified.'
                });
                continue;
            }
            let packet;
            try {
                packet = await (async () => {
                    const block = await located(result);
                    const statement = blockText(block.statement?.text);
                    const proof = await (async () => {
                        if (result.proof_file && result.proof_file !== result.file) {
                            const proofBlock = await readLocatedProof(path.join(root, result.proof_file), result.id);
                            if (!proofBlock)
                                throw Object.assign(new Error(`Linked proof of @${result.id} disappeared during inspection`), { code: 'SOURCE_STALE' });
                            return blockText(proofBlock.proof?.text);
                        }
                        return blockText(block.proof?.text);
                    })();
                    const dependencies = await (async () => {
                        const collected = [];
                        for (const dependency of [...new Set(result.dependencies)].sort()) {
                            const dependencyResult = resultById.get(dependency);
                            // Unresolved @IDs are rejected mechanically. Permitted outside mathematics
                            // is supplied only through externalBasis, never as an implicit graph fact.
                            if (!dependencyResult)
                                continue;
                            const dependencyBlock = await located(dependencyResult);
                            const dependencyStatement = blockText(dependencyBlock.statement?.text);
                            collected.push({
                                id: dependency,
                                kind: dependencyResult.kind,
                                title: dependencyResult.title,
                                statement: dependencyStatement,
                                origin: dependencyResult.origin === 'user' ? 'main-goal' : 'fact',
                                identity: {
                                    statement_hash: dependencyResult.statement_hash
                                },
                                source: { file: dependencyResult.file }
                            });
                        }
                        return collected;
                    })();
                    // The definition entries in `dependencies` are the semantic context (see reviewPrompt);
                    // scope states the frontier as a flat id list rather than re-embedding those bodies.
                    const scope = {
                        type: 'local-conditional-check',
                        source_file: result.file,
                        direct_dependency_ids: dependencies.map((dependency) => dependency.id)
                    };
                    return buildVerifierPacket({
                        target: {
                            id: result.id,
                            kind: result.kind,
                            title: result.title,
                            ...(result.kind === 'definition' ? { construction: statement } : { statement }),
                            proof,
                            identity: { statement_hash: result.statement_hash, proof_hash: result.proof_hash },
                            source: { file: result.file },
                            verification_mode: result.refutation ? 'refutation' : result.kind === 'definition' ? 'definition-construction' : 'proof'
                        },
                        dependencies,
                        externalBasis,
                        scope,
                        config
                    });
                })();
            }
            catch (error) {
                const failure = verifierFailure(error, result.id);
                failure.code = String(asErrorLike(error).code ?? 'SOURCE_STALE');
                failure.failed_target = result.id;
                outcomes.set(result.id, failure);
                continue;
            }
            const key = verificationKey(packet);
            const cached = await cachedDecision(root, result.id, key, packet);
            if (cached.invalid)
                tally.invalid_cache_entries += 1;
            let report;
            let source;
            let cachedResult = false;
            let metrics;
            if (cached.record) {
                report = cached.record.report;
                source = 'verification-cache';
                cachedResult = true;
                tally.cache_hits += 1;
                // Surface the originally-recorded cost, flagged as cached (this run did no verifier work).
                const recorded = cached.record.metrics;
                metrics = recorded ? { ...recorded, cached: true } : { duration_ms: 0, cached: true };
            }
            else if (fatal) {
                outcomes.set(result.id, fatal.failed_target
                    ? verifierFailure(fatal, fatal.failed_target, true)
                    : { ...fatal, inherited: true });
                continue;
            }
            else {
                tally.cache_misses += 1;
                tally.verifier_calls += 1;
                try {
                    ({ report, metrics } = await invokeVerifier(packet, config));
                }
                catch (error) {
                    const failure = verifierFailure(error, result.id);
                    failure.failed_target = result.id;
                    const now = new Date().toISOString();
                    const failureFile = auxLayout(root).failure(key, now.replace(/[-:.TZ]/g, ''));
                    try {
                        await atomicJson(failureFile, {
                            schema_version: 1,
                            operation: 'local-conditional-verification-failed',
                            target: result.id,
                            failed_at: now,
                            verification_key: key,
                            checker_contract: checkerContract(config),
                            error: failure.details ?? { code: failure.code, message: failure.error },
                            remediation: failure.remediation
                        });
                        failure.failure_report = relativePosix(root, failureFile);
                    }
                    catch { /* The structured command error remains the primary result. */ }
                    fatal = failure;
                    outcomes.set(result.id, failure);
                    tally.stopped_after = result.id;
                    continue;
                }
                let contextCurrent = false;
                try {
                    const currentCompilation = await compileProject(root, { ...options, write: false });
                    const currentContext = await verificationContext(currentCompilation);
                    contextCurrent = projectSourceSignature(currentCompilation, currentContext.contextHash) === initialSourceSignature;
                }
                catch {
                    contextCurrent = false;
                }
                if (!contextCurrent) {
                    fatal = verifierFailure(Object.assign(new Error(`Project sources or verification context changed while @${result.id} was being checked`), { code: 'SOURCE_STALE' }), result.id);
                    fatal.failed_target = result.id;
                    outcomes.set(result.id, fatal);
                    tally.stopped_after = result.id;
                    continue;
                }
                if (metrics) {
                    tally.verifier_duration_ms += metrics.duration_ms;
                    tally.verifier_tokens += metrics.usage?.total_tokens ?? 0;
                }
                const record = {
                    schema_version: SCHEMA_VERSION,
                    operation: 'local-conditional-verification',
                    target: result.id,
                    verified_at: new Date().toISOString(),
                    outcome: verificationOutcome(report, packet),
                    accepted: verificationOutcome(report, packet) !== 'rejected',
                    report,
                    ...(metrics ? { metrics } : {}),
                    statement_hash: result.statement_hash,
                    proof_hash: result.proof_hash,
                    dependency_snapshot: Object.fromEntries(packet.dependencies.map((dependency) => [String(dependency.id), {
                            origin: dependency.origin,
                            identity: dependency.identity
                        }])),
                    scope: packet.scope,
                    external_basis_hash: externalPolicyHash(externalBasis),
                    checker_contract: checkerContract(config),
                    verification_key: key,
                    packet_hash: sha256(stableJson(packet, 0)),
                    packet
                };
                try {
                    await atomicJson(cached.location.file, record);
                }
                catch (error) {
                    fatal = verifierFailure(Object.assign(new Error(`Verifier result for @${result.id} could not be cached safely: ${asErrorLike(error).message}`), { code: 'CACHE_WRITE_FAILED' }), result.id);
                    fatal.failed_target = result.id;
                    outcomes.set(result.id, fatal);
                    tally.stopped_after = result.id;
                    continue;
                }
                source = 'independent-verifier';
            }
            const decision = verificationOutcome(report, packet);
            const pass = decision !== 'rejected';
            const outcome = {
                status: pass ? 'pass' : 'fail',
                outcome: decision,
                source,
                cached: cachedResult,
                verification_key: key,
                report,
                ...(metrics ? { metrics } : {})
            };
            outcomes.set(result.id, outcome);
            if (decision === 'disproved') {
                result.disproof = {
                    status: 'conditional',
                    summary: report.summary,
                    refutation: report.refutation,
                    source: 'local-verifier-evidence',
                    verification_key: key
                };
            }
            else
                delete result.disproof;
        }
        return { outcomes, tally };
    })();
    const outcomes = localVerification.outcomes;
    // Stage: the AI diagnostics implied by the local outcomes — a rejected proof
    // becomes a warning, a checker failure an error. Produced as data rather than
    // pushed into a shared array, and kept separate from `mechanicalDiagnostics`.
    const aiDiagnostics = (() => {
        const items = [];
        for (const result of results) {
            const outcome = outcomes.get(result.id);
            if (!outcome)
                throw new Error(`Verification outcome for @${result.id} was not recorded`);
            if (outcome.status === 'fail')
                items.push({
                    severity: 'warning', code: result.refutation ? 'AI_DISPROOF_REJECTED' : 'AI_CHECK_REJECTED',
                    message: result.refutation
                        ? `Local conditional verification did not confirm the proposed refutation of @${result.id}: ${outcome.report?.summary || 'critical errors or gaps remain'}`
                        : `Local conditional verification rejected the submitted proof of @${result.id}: ${outcome.report?.summary || 'critical errors or gaps remain'}`,
                    file: result.file, line: result.proof_line ?? result.line, id: result.id,
                    repair_hints: outcome.report?.repair_hints ?? ''
                });
            if (outcome.status === 'error')
                items.push({
                    severity: 'error', code: outcome.code ?? 'AI_CHECK_FAILED',
                    message: `Local conditional verification could not check @${result.id}: ${outcome.error}`,
                    file: result.file, line: result.proof_line ?? result.line, id: result.id,
                    remediation: outcome.remediation
                });
        }
        return items;
    })();
    // Stage: global composition. Combines the mechanical check and the local
    // outcome for each fact, walking in dependency order so a fact can read its
    // dependencies' already-computed global verdicts. Writing the composed verdict
    // and status back onto `results` is this function's documented contract.
    const composition = (() => {
        const globalById = new Map();
        const facts = [];
        for (const result of topologicalOrder(results)) {
            const mechanical = (() => {
                const checks = references(result);
                const errors = relevantErrors(result);
                const reason = !compilation.complete
                    ? 'semantic-parse-incomplete'
                    : errors.length
                        ? 'mechanical-check-failed'
                        : checks.some((check) => check.existence !== 'pass' || check.scope !== 'pass' || check.cycle !== 'pass')
                            ? 'reference-check-failed'
                            : null;
                return {
                    status: reason ? 'fail' : 'pass',
                    verification_mode: result.kind === 'definition'
                        ? 'definition-construction'
                        : result.refutation ? 'refutation' : 'proof',
                    references: checks,
                    diagnostics: errors.map((item) => item.code).sort(),
                    ...(reason ? { reason } : {})
                };
            })();
            const local = outcomes.get(result.id) ?? { status: 'not-run' };
            const global = (() => {
                if (mechanical.status !== 'pass') {
                    const blockers = references(result)
                        .filter((check) => check.existence !== 'pass' || check.scope !== 'pass' || check.cycle !== 'pass')
                        .map((check) => check.dependency).sort();
                    return { status: 'invalid', blockers, reason: mechanical.reason ?? 'mechanical-check-failed' };
                }
                if (local.status === 'fail') {
                    return { status: 'rejected', blockers: [], reason: 'local-verification-rejected' };
                }
                if (local.status !== 'pass' || !local.outcome || local.outcome === 'rejected') {
                    return { status: 'unverified', blockers: [], reason: local.reason ?? local.error ?? 'local-verification-unavailable' };
                }
                const blockers = result.dependencies.filter((dependency) => (resultById.has(dependency) && globalById.get(dependency)?.status !== 'verified')).sort();
                return blockers.length
                    ? { status: 'blocked', blockers, reason: 'dependency-closure-not-verified' }
                    : { status: local.outcome === 'disproved' ? 'disproved' : 'verified', blockers: [] };
            })();
            globalById.set(result.id, global);
            result.global_verification = global;
            result.local_verification = local.status === 'pass' || local.status === 'fail'
                ? {
                    status: local.status,
                    outcome: local.outcome,
                    source: 'local-verifier-evidence',
                    verification_key: local.verification_key,
                    report: local.report,
                    ...(local.metrics ? { metrics: local.metrics } : {})
                }
                : local;
            // A fact whose local check simply has not run keeps its marker- and
            // proof-derived machine status (open, candidate, rejected, ...).
            result.status = local.status === 'not-run' && mechanical.status === 'pass'
                ? factStatus(result)
                : global.status;
            if (verificationIds.has(result.id) && !(local.status === 'pass' && local.outcome === 'disproved'))
                delete result.disproof;
            if (result.disproof)
                result.disproof.status = global.status === 'disproved' ? 'global' : 'conditional';
            facts.push({
                id: result.id,
                kind: result.kind,
                status: result.status,
                file: result.file,
                line: result.line,
                mechanical,
                local_verification: local,
                global_verification: global
            });
        }
        facts.sort((left, right) => left.id.localeCompare(right.id));
        return { facts };
    })();
    // Stage: the per-status counts over the facts inside the current selection.
    const counts = (() => {
        const scopedFacts = composition.facts.filter((fact) => verificationIds.has(fact.id));
        return {
            local_verified: scopedFacts.filter((fact) => fact.local_verification.status === 'pass' && fact.local_verification.outcome === 'verified').length,
            local_disproved: scopedFacts.filter((fact) => fact.local_verification.status === 'pass' && fact.local_verification.outcome === 'disproved').length,
            local_rejected: scopedFacts.filter((fact) => fact.local_verification.status === 'fail').length,
            local_errors: scopedFacts.filter((fact) => fact.local_verification.status === 'error').length,
            local_not_run: scopedFacts.filter((fact) => fact.local_verification.status === 'not-run').length,
            global_verified: scopedFacts.filter((fact) => fact.global_verification.status === 'verified').length,
            global_disproved: scopedFacts.filter((fact) => fact.global_verification.status === 'disproved').length,
            global_blocked: scopedFacts.filter((fact) => fact.global_verification.status === 'blocked').length,
            global_unverified: scopedFacts.filter((fact) => fact.global_verification.status === 'unverified').length,
            global_rejected: scopedFacts.filter((fact) => fact.global_verification.status === 'rejected').length,
            global_invalid: scopedFacts.filter((fact) => fact.global_verification.status === 'invalid').length
        };
    })();
    const verification = { ...localVerification.tally, ...counts };
    const diagnostics = [...mechanicalDiagnostics, ...aiDiagnostics]
        .sort((left, right) => `${left.file ?? ''}:${left.line ?? 0}:${left.code}:${left.id ?? ''}`.localeCompare(`${right.file ?? ''}:${right.line ?? 0}:${right.code}:${right.id ?? ''}`));
    return { verification, facts: composition.facts, diagnostics, selected: verificationIds };
}
/**
 * The `status` value a checked fact's local outcome projects to, or null to clear it. A proof claims
 * "the statement holds", a refutation claims "the statement is false"; `verified` means that claim
 * was confirmed, `rejected` that it was not. A fact that was not conclusively checked carries no status.
 */
function projectedStatus(result, outcome) {
    if (outcome.status !== 'pass' && outcome.status !== 'fail')
        return null;
    const confirmed = result.refutation ? outcome.outcome === 'disproved' : outcome.outcome === 'verified';
    return confirmed ? 'verified' : 'rejected';
}
/**
 * Project each freshly checked fact's local verdict into a display-only `status` attribute on its
 * source div — the linked proof div for a theorem-like result, the result div for a definition.
 * The attribute is excluded from every content hash, the verifier packet, the cache key, and the
 * snapshot identity, and is never read back, so writing it can never invalidate a cached decision.
 * Only facts re-checked this run (`run.selected`) are touched; a fact not conclusively checked has
 * any prior status cleared. A no-op when write mode is off.
 */
export async function writeStatusProjection(compilation, run, options = {}) {
    if (options.write === false)
        return;
    const root = compilation.root;
    const resultById = new Map(compilation.manifest.results.map((result) => [result.id, result]));
    const factById = new Map(run.facts.map((fact) => [fact.id, fact]));
    const perFact = [];
    for (const id of run.selected) {
        const result = resultById.get(id);
        const fact = factById.get(id);
        if (!result || !fact)
            continue;
        // A theorem-like carries status on its proof div (wherever it lives); a definition on its own div.
        const file = result.kind === 'definition' ? result.file : result.proof_file ?? result.file;
        perFact.push({ file, kind: result.kind, id, proofLine: result.proof_line, status: projectedStatus(result, fact.local_verification) });
    }
    for (const file of new Set(perFact.map((entry) => entry.file))) {
        const absolute = path.join(root, file);
        let source;
        try {
            source = await readFile(absolute, 'utf8');
        }
        catch {
            continue;
        }
        const edits = [];
        for (const entry of perFact.filter((item) => item.file === file)) {
            if (entry.kind === 'definition') {
                const div = locateDiv(source, entry.id);
                if (div)
                    edits.push({ div, status: entry.status });
                continue;
            }
            // The active proof carries the verdict; any abandoned attempt beside it is cleared.
            const proofs = locateProofs(source, entry.id);
            const active = proofs.find((div) => div.startLine === entry.proofLine) ?? proofs[0];
            for (const div of proofs)
                edits.push({ div, status: div === active ? entry.status : null });
        }
        // Apply from the bottom of the file up so each fence edit leaves earlier offsets valid.
        let next = source;
        for (const { div, status } of edits.sort((left, right) => right.div.start - left.div.start)) {
            next = setStatusAttribute(next, div, status);
        }
        if (next !== source)
            await atomicWrite(absolute, next);
    }
}
