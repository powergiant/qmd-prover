import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { buildProjectInspectionIndex } from '../inspection/index.js';
import { resolveProjectSnapshot } from '../inspection/snapshot.js';
import { externalPolicyHash } from '../infrastructure/external.js';
import { AUX, readJson, stableJson } from '../infrastructure/files.js';
import { SCHEMA_VERSION, hasErrorCode, isRecord } from '../shared/core.js';
import { checkerContract, verificationOutcome } from './protocol.js';
async function jsonFiles(directory) {
    try {
        return (await readdir(directory, { withFileTypes: true }))
            .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
            .map((entry) => path.join(directory, entry.name))
            .sort();
    }
    catch (error) {
        if (hasErrorCode(error, 'ENOENT'))
            return [];
        throw error;
    }
}
export async function checkStaleness(root = process.cwd(), options = {}) {
    root = path.resolve(root);
    const index = await buildProjectInspectionIndex(root, { ...options, write: false });
    // Report the same graph snapshot identity the inspect/dependency commands use,
    // so a caller can correlate a staleness audit with the graph it audited.
    const snapshot = await resolveProjectSnapshot(index, { ...options, write: false });
    const externalHash = externalPolicyHash(index.externalBasis);
    const contract = checkerContract(index.compilation.config);
    const resultById = new Map(index.compilation.manifest.results.map((result) => [result.id, result]));
    const reasonsByTarget = new Map();
    const flag = (target, reason) => {
        const reasons = reasonsByTarget.get(target) ?? new Set();
        reasons.add(reason);
        reasonsByTarget.set(target, reasons);
    };
    for (const file of await jsonFiles(path.join(root, AUX, 'verification', 'checks'))) {
        let record;
        try {
            record = await readJson(file);
        }
        catch {
            flag(path.basename(file, '.json'), 'cache-invalid');
            continue;
        }
        const target = typeof record.target === 'string' ? record.target : path.basename(file, '.json');
        if (!isRecord(record.report) || !isRecord(record.packet) || !isRecord(record.packet.target)) {
            flag(target, 'cache-invalid');
        }
        else {
            const outcome = verificationOutcome(record.report, record.packet);
            if (record.outcome !== outcome || record.accepted !== (outcome !== 'rejected'))
                flag(target, 'cache-invalid');
        }
        if (record.external_basis_hash !== externalHash)
            flag(target, 'external-basis-changed');
        if (stableJson(record.checker_contract ?? {}, 0) !== stableJson(contract, 0))
            flag(target, 'checker-contract-changed');
        const current = resultById.get(target);
        if (!current || record.statement_hash !== current.statement_hash || record.proof_hash !== current.proof_hash)
            flag(target, 'source-changed');
        const dependencySnapshot = isRecord(record.dependency_snapshot) ? record.dependency_snapshot : {};
        for (const [dependencyId, saved] of Object.entries(dependencySnapshot)) {
            const dependency = resultById.get(dependencyId);
            const identity = isRecord(saved) && isRecord(saved.identity) ? saved.identity : {};
            if (!dependency || identity.statement_hash !== dependency.statement_hash)
                flag(target, 'dependency-context-changed');
        }
    }
    const changed = [...reasonsByTarget].map(([id, reasons]) => ({
        id,
        reasons: [...reasons].sort(),
        current: {
            status: resultById.get(id)?.status ?? 'missing',
            external_basis_hash: externalHash,
            checker_contract: contract
        }
    })).sort((left, right) => left.id.localeCompare(right.id));
    return {
        schema_version: SCHEMA_VERSION,
        operation: 'check-staleness',
        ok: index.compilation.complete && changed.every((item) => !item.reasons.includes('cache-invalid')),
        changed,
        invalidated: changed.map((item) => ({ id: item.id, path: [item.id], reasons: item.reasons })),
        snapshot_id: snapshot.snapshot_id
    };
}
