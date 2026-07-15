import path from 'node:path';
import { compileProject } from '../semantic/compiler.js';
import { externalPolicyHash, readExternalPolicy } from '../infrastructure/external.js';
import { AUX, atomicJson, readJson, sha256, stableJson } from '../infrastructure/files.js';
import { checkerContract } from '../verification/protocol.js';
export async function buildProjectInspectionIndex(root = process.cwd(), options = {}) {
    root = path.resolve(root);
    const [compilation, externalBasis] = await Promise.all([
        compileProject(root, { ...options, write: false }),
        readExternalPolicy(root)
    ]);
    const goals = compilation.manifest.results.filter((result) => result.origin === 'user');
    const goalIds = new Set(goals.map((goal) => goal.id));
    const notes = compilation.manifest.files.map((file) => ({
        path: file.path,
        goals: file.results.filter((id) => goalIds.has(id)).sort()
    }));
    const contextHash = sha256(stableJson({
        external_basis_hash: externalPolicyHash(externalBasis),
        checker_contract: checkerContract(compilation.config)
    }, 0));
    if (options.write !== false && compilation.complete) {
        const locksFile = path.join(root, AUX, 'statement-locks.json');
        const locks = await readJson(locksFile, {});
        let changed = false;
        for (const goal of goals) {
            if (locks[goal.id])
                continue;
            // Lock a new goal statement as soon as its own declaration is clean;
            // unrelated errors elsewhere in the project must not delay protection.
            const goalErrors = compilation.diagnostics.some((item) => item.severity === 'error'
                && (item.id ? item.id === goal.id : item.file === goal.file));
            if (goalErrors)
                continue;
            locks[goal.id] = { statement_hash: goal.statement_hash, title_hash: goal.title_hash, file: goal.file };
            changed = true;
        }
        if (changed)
            await atomicJson(locksFile, locks);
    }
    return { root, compilation, goals, notes, externalBasis, contextHash, diagnostics: compilation.diagnostics };
}
