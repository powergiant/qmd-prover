import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { AUX, cleanId, readJson } from '../infrastructure/files.js';
import { hasErrorCode } from '../shared/core.js';
export async function submitProof(root, proposalFile, options = {}) {
    void root;
    void proposalFile;
    void options;
    return {
        schema_version: 3,
        operation: 'submit-proof',
        ok: false,
        status: 'retired',
        target: 'workspace',
        remediation: 'Keep definitions, results, and linked proofs in the protected goal workspace, then run inspect fact, inspect path, or inspect workspace. User QMD is never a promotion destination.'
    };
}
export async function showVerification(root, submissionId) {
    const directory = path.join(path.resolve(root), AUX, 'verification');
    try {
        return await readJson(path.join(directory, `${submissionId}.json`));
    }
    catch (error) {
        if (!hasErrorCode(error, 'ENOENT'))
            throw error;
        const checks = path.join(directory, 'checks');
        let entries = [];
        try {
            entries = await readdir(checks);
        }
        catch (checksError) {
            if (!hasErrorCode(checksError, 'ENOENT'))
                throw checksError;
        }
        for (const name of entries.filter((entry) => entry.endsWith('.json')).sort()) {
            const record = await readJson(path.join(checks, name));
            if (record.submission_id === submissionId)
                return record;
        }
        throw error;
    }
}
export async function revokeVerification(root, requested, reason, options = {}) {
    void root;
    void reason;
    void options;
    return {
        schema_version: 3,
        operation: 'verification-revoke',
        ok: false,
        status: 'retired',
        target: cleanId(requested),
        remediation: 'Canonical marker mutation is retired. Change the workspace source or external basis and rerun inspection; legacy user-QMD markers remain untouched.'
    };
}
