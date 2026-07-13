import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { compileProject } from '../semantic/compiler.js';
import { externalPolicyHash, readExternalPolicy } from '../infrastructure/external.js';
import { appendEvent, atomicJson, atomicWrite, AUX, newId, readJson, sha256, stableJson, withWriteLock } from '../infrastructure/files.js';
import { readLocatedBlock, setFactMarker } from '../semantic/source.js';
import { checkStaleness } from './staleness.js';
import { accepted, buildVerifierPacket, checkerContract, invokeVerifier, readVerifierDecision, verifierErrorDetails, verifierDecisionLocation, verificationKey } from './protocol.js';
import { asErrorLike, asStringArray, CONTROL_MARKER_SET, hasErrorCode } from '../shared/core.js';
const retryableStatuses = new Set(['candidate', 'stale']);
const fatalVerifierCodes = new Set(['unconfigured', 'not-found', 'exit', 'malformed', 'schema']);
function cleanSemanticText(text, kind, markerAtEnd = false) {
    const lines = String(text ?? '').split(/\r?\n/);
    if (kind === 'definition' || markerAtEnd) {
        for (let index = lines.length - 1; index >= 0; index -= 1) {
            if (!lines[index].trim())
                continue;
            if (CONTROL_MARKER_SET.has(lines[index].trim()))
                lines.splice(index, 1);
            break;
        }
    }
    else {
        for (let index = 0; index < lines.length; index += 1) {
            if (!lines[index].trim())
                continue;
            if (CONTROL_MARKER_SET.has(lines[index].trim()))
                lines.splice(index, 1);
            break;
        }
    }
    return lines.join('\n').trim();
}
function evidencePath(root, relative) {
    if (typeof relative !== 'string')
        return null;
    const verificationRoot = path.join(path.resolve(root), AUX, 'verification');
    const absolute = path.resolve(root, relative);
    return absolute.startsWith(`${verificationRoot}${path.sep}`) ? absolute : null;
}
async function readEvidence(root, relative) {
    const file = evidencePath(root, relative);
    if (!file)
        return null;
    try {
        return await readJson(file);
    }
    catch {
        return null;
    }
}
function dependencySnapshot(compilation, result) {
    const byId = new Map(compilation.manifest.results.map((item) => [item.id, item]));
    return Object.fromEntries(result.dependencies.map((id) => {
        const dependency = byId.get(id);
        return [id, dependency ? sha256(`${dependency.statement_hash}:${dependency.proof_hash}:${dependency.status}`) : null];
    }));
}
function relevantErrors(compilation, result) {
    return compilation.diagnostics.filter((item) => item.severity === 'error' && (item.id ? item.id === result.id : item.file === result.file));
}
export function programmaticEligibility(compilation, result) {
    if (!retryableStatuses.has(result.status)) {
        return { ready: false, reason: `status-${result.status}` };
    }
    if (result.marker === 'OPEN')
        return { ready: false, reason: 'explicitly-open' };
    if (result.marker === 'REVOKED' || result.status === 'revoked')
        return { ready: false, reason: 'revoked' };
    if (result.kind !== 'definition' && !result.proof_present)
        return { ready: false, reason: 'proof-missing' };
    const failedReferences = (result.reference_checks ?? []).filter((check) => (check.existence !== 'pass'
        || check.scope !== 'pass'
        || check.status !== 'pass'
        || check.cycle !== 'pass'));
    if (failedReferences.length)
        return { ready: false, reason: 'reference-check-failed', references: failedReferences };
    const errors = relevantErrors(compilation, result).filter((item) => ![
        'VERIFIED_RECORD_INVALID',
        'VERIFIED_MARKER_MISSING'
    ].includes(item.code));
    return errors.length ? { ready: false, reason: 'programmatic-check-failed', diagnostics: errors } : { ready: true };
}
async function packetForResult(root, compilation, result) {
    const located = await readLocatedBlock(path.join(root, result.file), result.id);
    if (!located)
        throw Object.assign(new Error(`Source block for @${result.id} disappeared`), { code: 'INSPECTION_SOURCE_STALE' });
    const byId = new Map(compilation.manifest.results.map((item) => [item.id, item]));
    const dependencies = [];
    for (const id of result.dependencies) {
        const dependency = byId.get(id);
        if (!dependency)
            continue;
        const dependencyLocated = await readLocatedBlock(path.join(root, dependency.file), dependency.id);
        const semanticText = cleanSemanticText(dependencyLocated?.statement?.text, dependency.kind, dependency.kind === 'definition');
        dependencies.push({
            id: dependency.id,
            kind: dependency.kind,
            title: dependency.title,
            semantic_text: semanticText,
            statement: semanticText,
            status: dependency.status,
            identity: { statement_hash: dependency.statement_hash, proof_hash: dependency.proof_hash },
            source: { file: dependency.file }
        });
    }
    const sourceFile = compilation.manifest.files.find((item) => item.path === result.file);
    const externalBasis = await readExternalPolicy(root);
    return buildVerifierPacket({
        target: {
            id: result.id,
            kind: result.kind,
            title: result.title,
            semantic_text: cleanSemanticText(located.statement?.text, result.kind, result.kind === 'definition'),
            ...(result.kind === 'definition'
                ? { construction: cleanSemanticText(located.statement?.text, result.kind, true) }
                : { statement: cleanSemanticText(located.statement?.text, result.kind, false) }),
            proof: cleanSemanticText(located.proof?.text, 'proof', false),
            cited_dependencies: result.dependencies,
            identity: { statement_hash: result.statement_hash, proof_hash: result.proof_hash },
            source: { file: result.file }
        },
        dependencies,
        externalBasis,
        scope: sourceFile?.imports ?? [],
        config: compilation.config
    });
}
function reportFromRecord(record) {
    return {
        verdict: record.verdict === 'correct' ? 'correct' : 'incorrect',
        summary: typeof record.summary === 'string' ? record.summary : '',
        critical_errors: asStringArray(record.critical_errors),
        gaps: asStringArray(record.gaps),
        nonblocking_comments: asStringArray(record.nonblocking_comments ?? record.comments),
        repair_hints: typeof record.repair_hints === 'string' ? record.repair_hints : ''
    };
}
async function storedAiCheck(root, result) {
    const index = await readJson(path.join(root, AUX, 'verification', 'index.json'), {});
    const entry = index[result.id];
    if (!entry)
        return null;
    const record = await readEvidence(root, entry.record ?? `${AUX}/verification/${entry.submission_id}.json`);
    const report = record ? reportFromRecord(record) : null;
    if (result.status === 'verified')
        return { status: 'pass', source: 'verification-record', cached: true, report };
    if (result.status === 'rejected')
        return { status: 'fail', source: 'verification-record', cached: true, report };
    if (result.status === 'revoked')
        return { status: 'not-run', reason: 'Verification was explicitly revoked.' };
    return null;
}
async function applyDecision(root, id, expectedKey, packet, recordLocation, record, options) {
    return withWriteLock(root, async () => {
        const current = await compileProject(root, { ...options, write: false });
        if (!current.complete)
            throw Object.assign(new Error('Project changed and no longer has a complete semantic parse'), { code: 'INSPECTION_SOURCE_STALE' });
        const result = current.manifest.results.find((item) => item.id === id);
        if (!result)
            throw Object.assign(new Error(`@${id} disappeared while verification was running`), { code: 'INSPECTION_SOURCE_STALE' });
        const eligibility = programmaticEligibility(current, result);
        if (!eligibility.ready)
            throw Object.assign(new Error(`@${id} changed and is no longer eligible for verification`), { code: 'INSPECTION_SOURCE_STALE' });
        const currentPacket = await packetForResult(root, current, result);
        if (verificationKey(currentPacket) !== expectedKey) {
            throw Object.assign(new Error(`@${id} or its verification context changed while verification was running`), { code: 'INSPECTION_SOURCE_STALE' });
        }
        const indexFile = path.join(root, AUX, 'verification', 'index.json');
        const previousIndex = await readJson(indexFile, {});
        const nextIndex = structuredClone(previousIndex);
        const now = new Date().toISOString();
        if (!record.accepted) {
            const snapshot = dependencySnapshot(current, result);
            nextIndex[id] = {
                status: 'rejected',
                submission_id: record.submission_id,
                statement_hash: result.statement_hash,
                title_hash: result.title_hash,
                kind: result.kind,
                canonical_proof_hash: result.proof_hash,
                rejected_proof_hash: result.proof_hash,
                dependency_snapshot: snapshot,
                external_basis_hash: externalPolicyHash(packet.external_basis),
                verification_key: expectedKey,
                checker_contract: packet.checker_contract,
                scope: packet.scope,
                source_file: result.file,
                record: recordLocation.relative,
                rejected_at: now
            };
            await atomicJson(indexFile, nextIndex);
            await compileProject(root, options);
            await appendEvent(root, { type: 'inspection-verification-rejected', submission_id: record.submission_id, decision_cache: recordLocation.relative, target: id, verification_key: expectedKey });
            return { status: 'fail', source: record.source, cached: record.source === 'verification-cache', report: record.report };
        }
        const sourceFile = path.join(root, result.file);
        const cacheFile = path.join(root, AUX, 'verification', 'facts', `${id}.json`);
        const cacheRelative = `${AUX}/verification/facts/${id}.json`;
        const activationId = newId('inspection');
        const activeRecordFile = path.join(root, AUX, 'verification', `${activationId}.json`);
        const activeRecordRelative = `${AUX}/verification/${activationId}.json`;
        const decisionId = record.submission_id;
        const activeRecord = {
            ...record,
            submission_id: activationId,
            decision_id: decisionId,
            decision_cache: recordLocation.relative,
            activated_at: new Date().toISOString(),
            source: record.source
        };
        delete activeRecord.stale;
        delete activeRecord.stale_at;
        delete activeRecord.stale_reason;
        delete activeRecord.invalidation_path;
        const originalSource = await readFile(sourceFile, 'utf8');
        let previousCache = null;
        try {
            previousCache = await readFile(cacheFile, 'utf8');
        }
        catch (error) {
            if (!hasErrorCode(error, 'ENOENT'))
                throw error;
        }
        const nextSource = setFactMarker(originalSource, id, result.kind, 'VERIFIED');
        const snapshot = dependencySnapshot(current, result);
        const scope = current.manifest.files.find((item) => item.path === result.file)?.imports ?? [];
        const externalBasis = await readExternalPolicy(root);
        const factCache = {
            schema_version: 3,
            id,
            source: { file: result.file, line: result.line },
            statement: packet.target.semantic_text,
            proof: packet.target.proof,
            statement_hash: result.statement_hash,
            title_hash: result.title_hash,
            kind: result.kind,
            proof_hash: result.proof_hash,
            dependencies: packet.dependencies,
            dependency_snapshot: snapshot,
            external_basis: externalBasis,
            external_basis_hash: externalPolicyHash(externalBasis),
            scope,
            graph_snapshot_id: current.graph.snapshot_id,
            verification_key: expectedKey,
            checker_contract: checkerContract(current.config),
            verification: {
                submission_id: activationId,
                decision_id: decisionId,
                backend: current.config.verification.backend,
                model: current.config.verification.model,
                report: record.report
            }
        };
        nextIndex[id] = {
            status: 'verified',
            submission_id: activationId,
            statement_hash: result.statement_hash,
            title_hash: result.title_hash,
            kind: result.kind,
            proof_hash: result.proof_hash,
            backend: current.config.verification.backend,
            formal_status: 'not-formal',
            human_review_status: 'not-reviewed',
            dependency_snapshot: snapshot,
            external_basis_hash: factCache.external_basis_hash,
            verification_key: expectedKey,
            checker_contract: factCache.checker_contract,
            record: activeRecordRelative,
            cache: cacheRelative
        };
        try {
            await atomicWrite(sourceFile, nextSource);
            await atomicJson(cacheFile, factCache);
            await atomicJson(activeRecordFile, activeRecord);
            await atomicJson(indexFile, nextIndex);
            const rebuilt = await compileProject(root, options);
            const rebuiltResult = rebuilt.manifest.results.find((item) => item.id === id);
            if (!rebuilt.complete || rebuiltResult?.status !== 'verified')
                throw new Error('Post-write inspection did not confirm a verified fact');
        }
        catch (error) {
            await atomicWrite(sourceFile, originalSource);
            if (previousCache == null)
                await rm(cacheFile, { force: true });
            else
                await atomicWrite(cacheFile, previousCache);
            await rm(activeRecordFile, { force: true });
            await atomicJson(indexFile, previousIndex);
            await compileProject(root, options);
            throw error;
        }
        await appendEvent(root, { type: 'inspection-verification-accepted', submission_id: activationId, decision_id: decisionId, target: id, verification_key: expectedKey });
        return { status: 'pass', source: record.source, cached: record.source === 'verification-cache', submission_id: activationId, decision_id: decisionId, report: record.report };
    });
}
export async function verifyCanonicalFact(root, requested, options = {}) {
    root = path.resolve(root);
    const compilation = await compileProject(root, { ...options, write: false });
    const id = String(requested).replace(/^@/, '');
    const result = compilation.manifest.results.find((item) => item.id === id);
    if (!result)
        return { status: 'error', code: 'INSPECTION_SOURCE_STALE', error: `Unknown fact: @${id}` };
    const existing = await storedAiCheck(root, result);
    if (existing)
        return existing;
    const eligibility = programmaticEligibility(compilation, result);
    if (!eligibility.ready)
        return { status: 'not-run', reason: eligibility.reason, programmatic: eligibility };
    let packet;
    try {
        packet = await packetForResult(root, compilation, result);
    }
    catch (error) {
        const failure = asErrorLike(error);
        return { status: 'error', code: String(failure.code ?? 'INSPECTION_SOURCE_STALE'), error: failure.message };
    }
    const key = verificationKey(packet);
    const cached = await readVerifierDecision(root, key, packet);
    let record;
    let location;
    if (cached.record) {
        location = cached.location;
        record = { ...cached.record, source: 'verification-cache' };
    }
    else {
        let report;
        try {
            report = await invokeVerifier(packet, compilation.config);
        }
        catch (error) {
            const failure = asErrorLike(error);
            const code = String(failure.code ?? 'VERIFIER_FAILED');
            const details = verifierErrorDetails(error);
            const failureRecord = {
                schema_version: 1,
                operation: 'inspection-verification-failed',
                target: id,
                verification_key: key,
                checker_contract: checkerContract(compilation.config),
                error: details,
                failed_at: new Date().toISOString()
            };
            await atomicJson(path.join(root, AUX, 'reports', `inspection-${key.replace(/^sha256:/, '').slice(0, 24)}-failed.json`), failureRecord);
            return {
                status: 'error', code, error: failure.message,
                details,
                attempted: code !== 'unconfigured',
                remediation: 'Repair verifier.command or QMD_PROVER_VERIFIER and rerun inspection. The fact remains unverified; do not add VERIFIED manually.',
                fatal: fatalVerifierCodes.has(code)
            };
        }
        location = verifierDecisionLocation(root, key);
        record = {
            schema_version: 2,
            submission_id: location.id,
            target: id,
            formal_status: 'not-formal',
            human_review_status: 'not-reviewed',
            verified_at: new Date().toISOString(),
            accepted: accepted(report),
            ...report,
            report,
            statement_hash: result.statement_hash,
            title_hash: result.title_hash,
            kind: result.kind,
            proof_hash: result.proof_hash,
            dependency_snapshot: dependencySnapshot(compilation, result),
            external_basis_hash: externalPolicyHash(await readExternalPolicy(root)),
            scope: packet.scope,
            source_file: result.file,
            verification_key: key,
            checker_contract: checkerContract(compilation.config),
            packet_hash: sha256(stableJson(packet, 0)),
            source: 'independent-verifier'
        };
        await atomicJson(location.file, record);
    }
    try {
        return await applyDecision(root, id, key, packet, location, record, options);
    }
    catch (error) {
        const failure = asErrorLike(error);
        return {
            status: 'error', code: String(failure.code ?? 'INSPECTION_WRITE_FAILED'), error: failure.message,
            remediation: 'The verification decision was not applied. Repair the reported state and rerun inspection; do not edit status markers manually.'
        };
    }
}
function skippedAiCheck(result, fatal = null) {
    if (fatal && retryableStatuses.has(result.status))
        return { ...fatal, status: 'error', inherited: true };
    if (result.status === 'open')
        return { status: 'not-run', reason: result.marker === 'OPEN' ? 'Fact is explicitly OPEN.' : 'No complete proof is present.' };
    if (result.status === 'revoked')
        return { status: 'not-run', reason: 'Verification was explicitly revoked.' };
    if (result.status === 'stale')
        return { status: 'not-run', reason: 'Stale verification could not yet be repeated.' };
    return { status: 'not-run', reason: 'Programmatic checks did not make this fact eligible for independent verification.' };
}
export async function inspectCanonicalScope(root, select, options = {}) {
    root = path.resolve(root);
    let staleness;
    let stalenessFailure = null;
    try {
        staleness = await checkStaleness(root, options);
    }
    catch (error) {
        stalenessFailure = { code: 'STALENESS_CHECK_FAILED', message: asErrorLike(error).message ?? String(error) };
        staleness = { schema_version: 2, operation: 'check-staleness', ok: false, changed: [], invalidated: [] };
    }
    let compilation = await compileProject(root, options);
    const aiChecks = new Map();
    let fatal = stalenessFailure ? {
        status: 'error', code: stalenessFailure.code, error: stalenessFailure.message,
        remediation: 'Repair parsing or protected state so stale markers can be removed safely, then rerun inspection.'
    } : null;
    let verifierCalls = 0;
    let cacheHits = 0;
    let recordHits = 0;
    if (!fatal && compilation.complete) {
        const maximumTransitions = Math.max(1, select(compilation).length * 2 + 1);
        for (let transition = 0; transition < maximumTransitions; transition += 1) {
            let progressed = false;
            for (const result of select(compilation).slice().sort((left, right) => left.id.localeCompare(right.id))) {
                if (!retryableStatuses.has(result.status))
                    continue;
                if (!programmaticEligibility(compilation, result).ready)
                    continue;
                const outcome = await verifyCanonicalFact(root, result.id, options);
                aiChecks.set(result.id, outcome);
                if (outcome.source === 'independent-verifier' || outcome.attempted)
                    verifierCalls += 1;
                if (outcome.cached)
                    cacheHits += 1;
                if (outcome.status === 'error' && outcome.fatal) {
                    fatal = outcome;
                    break;
                }
                if (outcome.status === 'pass' || outcome.status === 'fail') {
                    compilation = await compileProject(root, options);
                    progressed = true;
                    break;
                }
            }
            if (fatal || !progressed)
                break;
        }
    }
    compilation = await compileProject(root, options);
    const selected = select(compilation).slice().sort((left, right) => left.id.localeCompare(right.id));
    for (const result of selected) {
        const existing = aiChecks.get(result.id);
        if (existing && ['error', 'not-run'].includes(existing.status))
            continue;
        const stored = await storedAiCheck(root, result);
        if (!existing && stored?.cached)
            recordHits += 1;
        aiChecks.set(result.id, existing ?? stored ?? skippedAiCheck(result, fatal));
    }
    const diagnostics = [];
    if (stalenessFailure)
        diagnostics.push({ severity: 'error', code: stalenessFailure.code, message: stalenessFailure.message });
    for (const result of selected) {
        const check = aiChecks.get(result.id);
        if (check?.status === 'fail')
            diagnostics.push({
                severity: 'error', code: 'AI_CHECK_REJECTED', id: result.id, file: result.file, line: result.proof_line ?? result.line,
                message: `Independent verification rejected @${result.id}: ${check.report?.summary || 'critical errors or gaps remain'}`
            });
        if (check?.status === 'error')
            diagnostics.push({
                severity: 'error', code: check.code ?? 'AI_CHECK_FAILED', id: result.id, file: result.file, line: result.proof_line ?? result.line,
                message: `Independent verification could not check @${result.id}: ${check.error}`,
                remediation: check.remediation
            });
    }
    return {
        compilation,
        selected,
        aiChecks,
        staleness,
        diagnostics,
        verification: {
            eligible: selected.filter((result) => programmaticEligibility(compilation, result).ready).length,
            verifier_calls: verifierCalls,
            cache_hits: cacheHits + recordHits,
            passed: [...aiChecks.values()].filter((item) => item.status === 'pass').length,
            rejected: [...aiChecks.values()].filter((item) => item.status === 'fail').length,
            errors: [...aiChecks.values()].filter((item) => item.status === 'error').length,
            not_run: [...aiChecks.values()].filter((item) => item.status === 'not-run').length
        }
    };
}
