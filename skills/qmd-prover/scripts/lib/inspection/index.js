import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { compileProject } from '../semantic/compiler.js';
import { externalPolicyHash, readExternalPolicy } from '../infrastructure/external.js';
import { AUX, atomicJson, cleanId, exists, readJson, relativePosix, sha256, stableJson } from '../infrastructure/files.js';
import { asErrorLike, hasErrorCode, isRecord } from '../shared/core.js';
import { checkerContract } from '../verification/protocol.js';
import { discoverActive, workspaceSnapshotSourceSignature, workspaceSourceFingerprint } from '../workspace/support.js';
function diagnostic(severity, code, message, file, id) {
    return { severity, code, message, ...(file ? { file } : {}), ...(id ? { id } : {}) };
}
function emptyCompilation(template) {
    return {
        root: template.root,
        config: template.config,
        manifest: { schema_version: 3, files: [], results: [], proofs: [] },
        graph: { schema_version: 3, nodes: [], edges: [], cycles: [] },
        diagnostics: [],
        summary: { files: 0, results: 0, errors: 0, warnings: 0 },
        ok: true,
        complete: true
    };
}
function workspaceStale(goal, metadata) {
    if (!goal || !metadata)
        return true;
    return goal.statement_hash !== metadata.canonical.statement_hash
        || goal.title_hash !== metadata.canonical.title_hash
        || goal.proof_hash !== metadata.canonical.proof_hash
        || goal.status !== metadata.canonical.status;
}
async function workspaceEntries(root) {
    try {
        return (await readdir(path.join(root, AUX, 'workspaces'), { withFileTypes: true }))
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();
    }
    catch (error) {
        if (hasErrorCode(error, 'ENOENT'))
            return [];
        throw error;
    }
}
async function currentWorkspaceSnapshot(directory, metadata, target, contextHash, stale) {
    if (stale)
        return null;
    try {
        const sourceSignature = workspaceSnapshotSourceSignature(await workspaceSourceFingerprint(directory), metadata, target, contextHash);
        const pointer = await readJson(path.join(directory, 'latest.json'));
        const snapshotsRoot = path.join(directory, 'snapshots');
        const snapshotFile = path.resolve(directory, pointer.file);
        if (!snapshotFile.startsWith(`${snapshotsRoot}${path.sep}`))
            return null;
        const snapshot = await readJson(snapshotFile);
        if (pointer.schema_version !== 3 || snapshot.schema_version !== 3
            || snapshot.snapshot_id !== pointer.snapshot_id
            || snapshot.source_signature !== sourceSignature
            || !Array.isArray(snapshot.manifest?.results)
            || !Array.isArray(snapshot.graph?.nodes)
            || !Array.isArray(snapshot.diagnostics))
            return null;
        return snapshot;
    }
    catch {
        return null;
    }
}
export async function buildProjectInspectionIndex(root = process.cwd(), options = {}) {
    root = path.resolve(root);
    const goalsCompilation = await compileProject(root, { ...options, semanticMode: 'project-goals', write: false });
    const goals = goalsCompilation.manifest.results;
    const goalById = new Map(goals.map((goal) => [goal.id, goal]));
    const goalIds = new Set(goals.map((goal) => goal.id));
    const notes = goalsCompilation.manifest.files.map((file) => ({
        path: file.path,
        goals: file.results.filter((id) => goalIds.has(id)).sort()
    }));
    const contextHash = sha256(stableJson({
        external_basis_hash: externalPolicyHash(await readExternalPolicy(root)),
        checker_contract: checkerContract(goalsCompilation.config)
    }, 0));
    const workspaces = [];
    for (const name of await workspaceEntries(root)) {
        const directory = path.join(root, AUX, 'workspaces', name);
        const metadataFile = path.join(directory, 'workspace.json');
        const hasMetadata = await exists(metadataFile);
        let files = [];
        try {
            files = await discoverActive(directory);
        }
        catch (error) {
            workspaces.push({
                id: cleanId(name), directory, path: relativePosix(root, directory), status: 'invalid', metadata: null,
                files: [], compilation: null, snapshot: null, stale: true,
                diagnostics: [diagnostic('error', 'WORKSPACE_DISCOVERY_FAILED', String(asErrorLike(error).message ?? error), relativePosix(root, directory), cleanId(name))]
            });
            continue;
        }
        if (!hasMetadata) {
            if (/^thm-main-[A-Za-z0-9._:-]+$/.test(name) && files.length) {
                const compilation = await compileProject(root, {
                    ...options,
                    semanticMode: 'workspace',
                    files,
                    externalTargets: goals.map((goal) => goal.id),
                    protectStatements: false,
                    write: false
                });
                const localIds = new Set(compilation.manifest.results.map((result) => result.id));
                const compilationDiagnostics = compilation.diagnostics.filter((item) => {
                    if (item.code !== 'DEPENDENCY_STATUS_INSUFFICIENT')
                        return true;
                    const dependency = item.message.match(/@((?:def|lem|thm|prp|cor)-[^\s,]+)/)?.[1];
                    return !dependency || !localIds.has(dependency);
                });
                workspaces.push({
                    id: name, directory, path: relativePosix(root, directory), status: 'uninitialized', metadata: null,
                    files, compilation, snapshot: null, stale: true,
                    diagnostics: [diagnostic('error', 'WORKSPACE_UNINITIALIZED', `Goal-like directory @${name} contains active QMD files but has no workspace.json; run workspace init explicitly or move the files into an initialized workspace`, relativePosix(root, directory), name), ...compilationDiagnostics]
                });
            }
            continue;
        }
        let metadata = null;
        const entryDiagnostics = [];
        try {
            const parsed = await readJson(metadataFile);
            if (!isRecord(parsed) || typeof parsed.target !== 'string' || !isRecord(parsed.canonical))
                throw new Error('workspace.json does not satisfy the workspace metadata contract');
            metadata = parsed;
        }
        catch (error) {
            entryDiagnostics.push(diagnostic('error', 'WORKSPACE_METADATA_INVALID', String(asErrorLike(error).message ?? error), relativePosix(root, metadataFile), cleanId(name)));
        }
        const id = cleanId(metadata?.target ?? name);
        let compilation = emptyCompilation(goalsCompilation);
        if (files.length)
            compilation = await compileProject(root, {
                ...options,
                semanticMode: 'workspace',
                files,
                externalTargets: goals.map((goal) => goal.id),
                protectStatements: false,
                write: false
            });
        const localIds = new Set(compilation.manifest.results.map((result) => result.id));
        entryDiagnostics.push(...compilation.diagnostics.filter((item) => {
            if (item.code !== 'DEPENDENCY_STATUS_INSUFFICIENT')
                return true;
            const dependency = item.message.match(/@((?:def|lem|thm|prp|cor)-[^\s,]+)/)?.[1];
            return !dependency || !localIds.has(dependency);
        }));
        let status = metadata ? 'initialized' : 'invalid';
        if (metadata && (id !== name || !goalById.has(id))) {
            status = 'orphan';
            entryDiagnostics.push(diagnostic('error', 'WORKSPACE_ORPHAN', id !== name
                ? `Workspace directory ${name} declares target @${id}; directory and target IDs must match`
                : `Workspace @${id} has no protected main goal in user notes`, relativePosix(root, metadataFile), id));
        }
        const stale = workspaceStale(goalById.get(id), metadata);
        if (metadata && status === 'initialized' && stale)
            entryDiagnostics.push(diagnostic('error', 'WORKSPACE_STALE', `The protected main-goal snapshot for @${id} is stale`, relativePosix(root, metadataFile), id));
        const snapshot = metadata && status === 'initialized'
            ? await currentWorkspaceSnapshot(directory, metadata, goalById.get(id), contextHash, stale)
            : null;
        workspaces.push({
            id, directory, path: relativePosix(root, directory), status, metadata, files,
            compilation, snapshot, stale, diagnostics: entryDiagnostics
        });
    }
    const declarations = new Map();
    const register = (id, domain, file) => {
        const locations = declarations.get(id) ?? [];
        locations.push({ domain, file });
        declarations.set(id, locations);
    };
    for (const goal of goals)
        register(goal.id, 'project-goals', goal.file);
    for (const workspace of workspaces) {
        for (const result of workspace.compilation?.manifest.results ?? [])
            register(result.id, workspace.id, relativePosix(root, path.resolve(root, result.file)));
    }
    const globalDiagnostics = [];
    for (const [id, locations] of declarations) {
        const domains = new Set(locations.map((location) => location.domain));
        if (domains.size <= 1 && !(domains.has('project-goals') && locations.length > 1))
            continue;
        const files = [...new Set(locations.map((location) => location.file))].sort();
        globalDiagnostics.push({
            severity: 'error', code: 'GLOBAL_DUPLICATE_ID', id,
            message: `@${id} is declared in multiple project scopes: ${files.join(', ')}`,
            locations: files,
            remediation: 'Rename declarations until every explicit project and workspace ID is globally unique. A linked proof of its own main goal is not a declaration.'
        });
    }
    const domainsById = new Map();
    for (const [id, locations] of declarations)
        domainsById.set(id, new Set(locations.map((location) => location.domain)));
    for (const workspace of workspaces) {
        if (!workspace.compilation)
            continue;
        const dependencySources = [
            ...workspace.compilation.manifest.results.map((result) => ({ id: result.id, file: result.file, line: result.proof_line ?? result.line, dependencies: result.dependencies })),
            ...workspace.compilation.manifest.proofs.filter((proof) => proof.target === workspace.id).map((proof) => ({ id: workspace.id, file: proof.file, line: proof.line, dependencies: proof.dependencies }))
        ];
        for (const result of dependencySources) {
            for (const dependency of result.dependencies) {
                const domains = domainsById.get(dependency);
                if (!domains || domains.has(workspace.id))
                    continue;
                const projectGoal = domains.has('project-goals');
                workspace.diagnostics.push({
                    severity: 'error', code: projectGoal ? 'WORKSPACE_EXTERNAL_FACT_DEPENDENCY' : 'CROSS_WORKSPACE_DEPENDENCY', id: result.id, dependency,
                    file: relativePosix(root, path.resolve(root, result.file)), line: result.line,
                    message: projectGoal
                        ? `Workspace @${workspace.id} may not cite protected main goal @${dependency} as a fact`
                        : `Workspace @${workspace.id} may not cite @${dependency} from another workspace`,
                    remediation: 'Keep workspace graphs isolated. Restate and prove the needed candidate locally, or place the permitted premise in the external basis.'
                });
            }
        }
    }
    const diagnostics = [
        ...goalsCompilation.diagnostics,
        ...workspaces.flatMap((workspace) => workspace.diagnostics),
        ...globalDiagnostics
    ];
    const legacyVerification = await readJson(path.join(root, AUX, 'verification', 'index.json'), {});
    if (Object.keys(legacyVerification).length)
        diagnostics.push(diagnostic('warning', 'LEGACY_CANONICAL_VERIFICATION', `Found ${Object.keys(legacyVerification).length} legacy canonical verification record(s); they remain read-only and do not establish workspace facts`, `${AUX}/verification/index.json`));
    if (options.write !== false && globalDiagnostics.length === 0 && goalsCompilation.ok && goalsCompilation.complete) {
        const locksFile = path.join(root, AUX, 'statement-locks.json');
        const locks = await readJson(locksFile, {});
        let changed = false;
        for (const goal of goals) {
            if (locks[goal.id])
                continue;
            locks[goal.id] = { statement_hash: goal.statement_hash, title_hash: goal.title_hash, file: goal.file };
            changed = true;
        }
        if (changed)
            await atomicJson(locksFile, locks);
    }
    return {
        root, goalsCompilation, goals, notes, workspaces, diagnostics, globalDiagnostics,
        fatal: globalDiagnostics.length > 0,
        contextHash
    };
}
