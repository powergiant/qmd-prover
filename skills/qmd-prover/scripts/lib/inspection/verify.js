import path from 'node:path';
import { compileProject, factStatus } from '../semantic/compiler.js';
import { externalPolicyHash } from '../infrastructure/external.js';
import { atomicJson, relativePosix, sha256, stableJson } from '../infrastructure/files.js';
import { readLocatedBlock, readLocatedProof } from '../semantic/source.js';
import { buildVerifierPacket, checkerContract, configured, invokeVerifier, verificationContext, verificationKey, verificationOutcome } from '../verification/protocol.js';
import { cachedDecision, verifierFailure } from '../verification/cache.js';
import { asErrorLike, CONTROL_MARKER_SET, SCHEMA_VERSION } from '../shared/core.js';
import { projectSourceSignature, readPublishedSnapshot } from './snapshot.js';
export function cleanVerifierText(value, markerPosition = null) {
    const lines = String(value ?? '').split(/\r?\n/);
    if (markerPosition === 'first') {
        const index = lines.findIndex((line) => line.trim() !== '');
        if (index >= 0 && CONTROL_MARKER_SET.has(lines[index].trim()))
            lines.splice(index, 1);
    }
    else if (markerPosition === 'last') {
        for (let index = lines.length - 1; index >= 0; index -= 1) {
            if (!lines[index].trim())
                continue;
            if (CONTROL_MARKER_SET.has(lines[index].trim()))
                lines.splice(index, 1);
            break;
        }
    }
    return lines.join('\n').trim();
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
 */
export async function verifyFacts(compilation, context, options = {}) {
    const root = compilation.root;
    const config = compilation.config;
    const results = compilation.manifest.results;
    const resultById = new Map(results.map((result) => [result.id, result]));
    const diagnostics = [...compilation.diagnostics];
    const externalBasis = context.externalBasis;
    const requestedIds = options.selectedIds
        ? new Set([...options.selectedIds].map((selected) => String(selected).replace(/^@/, '')))
        : null;
    const verificationIds = requestedIds ? new Set() : new Set(results.map((result) => result.id));
    function selectDependencyClosure(selected) {
        if (verificationIds.has(selected))
            return;
        const result = resultById.get(selected);
        if (!result)
            return;
        verificationIds.add(selected);
        for (const dependency of result.dependencies)
            if (resultById.has(dependency))
                selectDependencyClosure(dependency);
    }
    for (const selected of requestedIds ?? [])
        selectDependencyClosure(selected);
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
    if (requestedIds && previousSnapshot)
        diagnostics.push(...previousSnapshot.diagnostics.filter((item) => (item.id !== undefined && !verificationIds.has(item.id) && item.code.startsWith('AI_'))));
    const mechanicalDiagnostics = diagnostics.slice();
    function relevantErrors(result) {
        return mechanicalDiagnostics.filter((item) => item.severity === 'error' && (item.id
            ? item.id === result.id
            : item.file === result.file || (result.proof_file && item.file === result.proof_file)));
    }
    function references(result) {
        return [...(result.reference_checks ?? [])].sort((left, right) => left.dependency.localeCompare(right.dependency));
    }
    function mechanicalCheck(result) {
        const checks = references(result);
        const errors = relevantErrors(result);
        let reason = null;
        if (!compilation.complete)
            reason = 'semantic-parse-incomplete';
        else if (errors.length)
            reason = 'mechanical-check-failed';
        else if (checks.some((check) => (check.existence !== 'pass' || check.scope !== 'pass' || check.cycle !== 'pass')))
            reason = 'reference-check-failed';
        return {
            status: reason ? 'fail' : 'pass',
            verification_mode: result.kind === 'definition'
                ? 'definition-construction'
                : result.marker === 'DISPROVED' ? 'refutation' : 'proof',
            references: checks,
            diagnostics: errors.map((item) => item.code).sort(),
            ...(reason ? { reason } : {})
        };
    }
    function localEligibility(result) {
        if (!compilation.complete)
            return { ready: false, reason: 'semantic-parse-incomplete' };
        if (result.marker === 'OPEN')
            return { ready: false, reason: 'explicitly-open' };
        if (result.marker === 'REJECTED')
            return { ready: false, reason: 'explicitly-rejected' };
        if (result.marker === 'VERIFIED' || result.marker === 'REVOKED')
            return { ready: false, reason: 'protected-marker-forbidden' };
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
    }
    const locatedBlocks = new Map();
    async function located(result) {
        const key = `${result.id}:${result.file}`;
        const cached = locatedBlocks.get(key);
        if (cached)
            return cached;
        const value = await readLocatedBlock(path.join(root, result.file), result.id);
        if (!value)
            throw Object.assign(new Error(`Source block for @${result.id} disappeared during inspection`), { code: 'SOURCE_STALE' });
        locatedBlocks.set(key, value);
        return value;
    }
    async function packetFor(result) {
        const block = await located(result);
        const statement = cleanVerifierText(block.statement?.text, result.kind === 'definition' ? 'last' : null);
        let proof;
        if (result.proof_file && result.proof_file !== result.file) {
            const proofBlock = await readLocatedProof(path.join(root, result.proof_file), result.id);
            if (!proofBlock)
                throw Object.assign(new Error(`Linked proof of @${result.id} disappeared during inspection`), { code: 'SOURCE_STALE' });
            proof = cleanVerifierText(proofBlock.proof?.text, 'first');
        }
        else {
            proof = cleanVerifierText(block.proof?.text, 'first');
        }
        const dependencies = [];
        for (const dependency of [...new Set(result.dependencies)].sort()) {
            const dependencyResult = resultById.get(dependency);
            // Unresolved @IDs are rejected mechanically. Permitted outside mathematics
            // is supplied only through externalBasis, never as an implicit graph fact.
            if (!dependencyResult)
                continue;
            const dependencyBlock = await located(dependencyResult);
            const dependencyStatement = cleanVerifierText(dependencyBlock.statement?.text, dependencyResult.kind === 'definition' ? 'last' : null);
            dependencies.push({
                id: dependency,
                kind: dependencyResult.kind,
                title: dependencyResult.title,
                semantic_text: dependencyStatement,
                statement: dependencyStatement,
                origin: dependencyResult.origin === 'user' ? 'main-goal' : 'fact',
                identity: {
                    statement_hash: dependencyResult.statement_hash
                },
                source: { file: dependencyResult.file }
            });
        }
        const scope = {
            type: 'local-conditional-check',
            source_file: result.file,
            direct_dependency_ids: dependencies.map((dependency) => dependency.id),
            semantic_context: {
                definitions: dependencies.filter((dependency) => dependency.kind === 'definition').map((dependency) => ({
                    id: dependency.id,
                    construction: dependency.statement,
                    identity: dependency.identity
                }))
            }
        };
        return buildVerifierPacket({
            target: {
                id: result.id,
                kind: result.kind,
                title: result.title,
                semantic_text: statement,
                ...(result.kind === 'definition' ? { construction: statement } : { statement }),
                proof,
                cited_dependencies: [...new Set(result.dependencies)].sort(),
                identity: { statement_hash: result.statement_hash, proof_hash: result.proof_hash },
                source: { file: result.file },
                verification_mode: result.marker === 'DISPROVED' ? 'refutation' : result.kind === 'definition' ? 'definition-construction' : 'proof'
            },
            dependencies,
            externalBasis,
            scope,
            config
        });
    }
    const outcomes = new Map();
    const verifierAvailable = configured(config);
    const verification = {
        available: verifierAvailable,
        eligible: 0,
        verifier_calls: 0,
        cache_hits: 0,
        cache_misses: 0,
        invalid_cache_entries: 0,
        local_verified: 0,
        local_disproved: 0,
        local_rejected: 0,
        local_errors: 0,
        local_not_run: 0,
        global_verified: 0,
        global_disproved: 0,
        global_blocked: 0,
        global_unverified: 0,
        global_rejected: 0,
        global_invalid: 0,
        stopped_after: null
    };
    let fatal = null;
    const initialSourceSignature = projectSourceSignature(compilation, context.contextHash);
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
        const eligibility = localEligibility(result);
        if (!eligibility.ready) {
            outcomes.set(result.id, {
                status: 'not-run',
                reason: eligibility.reason === 'proof-missing'
                    ? 'No complete proof is present.'
                    : eligibility.reason === 'explicitly-open'
                        ? 'The active attempt is explicitly OPEN.'
                        : eligibility.reason === 'explicitly-rejected'
                            ? 'The active attempt is explicitly REJECTED.'
                            : `Local conditional verification did not run because ${eligibility.reason}.`
            });
            continue;
        }
        verification.eligible += 1;
        if (!verifierAvailable) {
            outcomes.set(result.id, {
                status: 'not-run',
                reason: 'No verifier is configured; the machine dependency analysis remains available and this local result is unverified.'
            });
            continue;
        }
        let packet;
        try {
            packet = await packetFor(result);
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
            verification.invalid_cache_entries += 1;
        let report;
        let source;
        let cachedResult = false;
        if (cached.record) {
            report = cached.record.report;
            source = 'verification-cache';
            cachedResult = true;
            verification.cache_hits += 1;
        }
        else if (fatal) {
            outcomes.set(result.id, fatal.failed_target
                ? verifierFailure(fatal, fatal.failed_target, true)
                : { ...fatal, inherited: true });
            continue;
        }
        else {
            verification.cache_misses += 1;
            verification.verifier_calls += 1;
            try {
                report = await invokeVerifier(packet, config);
            }
            catch (error) {
                const failure = verifierFailure(error, result.id);
                failure.failed_target = result.id;
                const now = new Date().toISOString();
                const digest = key.replace(/^sha256:/, '');
                const failureFile = path.join(root, '.qmd-prover', 'verification', 'failures', digest, `${now.replace(/[-:.TZ]/g, '')}.json`);
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
                verification.stopped_after = result.id;
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
                verification.stopped_after = result.id;
                continue;
            }
            const record = {
                schema_version: SCHEMA_VERSION,
                operation: 'local-conditional-verification',
                target: result.id,
                verified_at: new Date().toISOString(),
                outcome: verificationOutcome(report, packet),
                accepted: verificationOutcome(report, packet) !== 'rejected',
                report,
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
                verification.stopped_after = result.id;
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
            report
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
    for (const result of results) {
        if (!outcomes.has(result.id))
            outcomes.set(result.id, {
                status: 'not-run',
                reason: 'Local conditional verification did not run because the fact was not eligible.'
            });
        const outcome = outcomes.get(result.id);
        if (!outcome)
            throw new Error(`Verification outcome for @${result.id} was not recorded`);
        if (outcome.status === 'fail')
            diagnostics.push({
                severity: 'warning', code: result.marker === 'DISPROVED' ? 'AI_DISPROOF_REJECTED' : 'AI_CHECK_REJECTED',
                message: result.marker === 'DISPROVED'
                    ? `Local conditional verification did not confirm the proposed refutation of @${result.id}: ${outcome.report?.summary || 'critical errors or gaps remain'}`
                    : `Local conditional verification rejected the submitted proof of @${result.id}: ${outcome.report?.summary || 'critical errors or gaps remain'}`,
                file: result.file, line: result.proof_line ?? result.line, id: result.id,
                repair_hints: outcome.report?.repair_hints ?? ''
            });
        if (outcome.status === 'error')
            diagnostics.push({
                severity: 'error', code: outcome.code ?? 'AI_CHECK_FAILED',
                message: `Local conditional verification could not check @${result.id}: ${outcome.error}`,
                file: result.file, line: result.proof_line ?? result.line, id: result.id,
                remediation: outcome.remediation
            });
    }
    const globalById = new Map();
    const factRecords = [];
    for (const result of topologicalOrder(results)) {
        const mechanical = mechanicalCheck(result);
        const local = outcomes.get(result.id) ?? { status: 'not-run' };
        let global;
        if (mechanical.status !== 'pass') {
            const blockers = references(result)
                .filter((check) => check.existence !== 'pass' || check.scope !== 'pass' || check.cycle !== 'pass')
                .map((check) => check.dependency).sort();
            global = { status: 'invalid', blockers, reason: mechanical.reason ?? 'mechanical-check-failed' };
        }
        else if (local.status === 'fail') {
            global = { status: 'rejected', blockers: [], reason: 'local-verification-rejected' };
        }
        else if (local.status !== 'pass' || !local.outcome || local.outcome === 'rejected') {
            global = { status: 'unverified', blockers: [], reason: local.reason ?? local.error ?? 'local-verification-unavailable' };
        }
        else {
            const blockers = result.dependencies.filter((dependency) => (resultById.has(dependency) && globalById.get(dependency)?.status !== 'verified')).sort();
            global = blockers.length
                ? { status: 'blocked', blockers, reason: 'dependency-closure-not-verified' }
                : { status: local.outcome === 'disproved' ? 'disproved' : 'verified', blockers: [] };
        }
        globalById.set(result.id, global);
        result.global_verification = global;
        result.local_verification = local.status === 'pass' || local.status === 'fail'
            ? {
                status: local.status,
                outcome: local.outcome,
                source: 'local-verifier-evidence',
                verification_key: local.verification_key,
                report: local.report
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
        factRecords.push({
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
    factRecords.sort((left, right) => left.id.localeCompare(right.id));
    const scopedFacts = factRecords.filter((fact) => verificationIds.has(fact.id));
    verification.local_verified = scopedFacts.filter((fact) => fact.local_verification.status === 'pass' && fact.local_verification.outcome === 'verified').length;
    verification.local_disproved = scopedFacts.filter((fact) => fact.local_verification.status === 'pass' && fact.local_verification.outcome === 'disproved').length;
    verification.local_rejected = scopedFacts.filter((fact) => fact.local_verification.status === 'fail').length;
    verification.local_errors = scopedFacts.filter((fact) => fact.local_verification.status === 'error').length;
    verification.local_not_run = scopedFacts.filter((fact) => fact.local_verification.status === 'not-run').length;
    verification.global_verified = scopedFacts.filter((fact) => fact.global_verification.status === 'verified').length;
    verification.global_disproved = scopedFacts.filter((fact) => fact.global_verification.status === 'disproved').length;
    verification.global_blocked = scopedFacts.filter((fact) => fact.global_verification.status === 'blocked').length;
    verification.global_unverified = scopedFacts.filter((fact) => fact.global_verification.status === 'unverified').length;
    verification.global_rejected = scopedFacts.filter((fact) => fact.global_verification.status === 'rejected').length;
    verification.global_invalid = scopedFacts.filter((fact) => fact.global_verification.status === 'invalid').length;
    diagnostics.sort((left, right) => `${left.file ?? ''}:${left.line ?? 0}:${left.code}:${left.id ?? ''}`.localeCompare(`${right.file ?? ''}:${right.line ?? 0}:${right.code}:${right.id ?? ''}`));
    return { verification, facts: factRecords, diagnostics, selected: verificationIds };
}
