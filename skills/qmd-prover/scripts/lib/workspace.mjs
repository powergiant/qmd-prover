import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { compileProject, theoremBundle } from './compiler.mjs';
import { atomicJson, atomicWrite, AUX, cleanId, exists, readJson, relativePosix, sha256, stableJson } from './files.mjs';
import { readLocatedBlock } from './source.mjs';

async function discoverActive(directory, output = []) {
  const excluded = new Set(['attempts', 'dead-ends', 'proposals', 'verification', 'context']);
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    if (excluded.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await discoverActive(absolute, output);
    else if (entry.isFile() && entry.name.endsWith('.qmd') && !['target.qmd', 'progress.qmd'].includes(entry.name)) output.push(absolute);
  }
  return output;
}

function workspaceDirectory(root, requested) {
  const id = cleanId(requested);
  if (!/^thm-main-[A-Za-z0-9._:-]+$/.test(id)) throw new Error('A goal workspace requires a thm-main-* ID');
  return { id, directory: path.join(path.resolve(root), AUX, 'workspaces', id) };
}

export async function initializeWorkspace(root, requested, options = {}) {
  root = path.resolve(root);
  const { id, directory } = workspaceDirectory(root, requested);
  const compilation = await compileProject(root, options);
  if (!compilation.ok) throw new Error('Project has structural errors; repair them before creating a goal workspace');
  const target = compilation.manifest.results.find((result) => result.id === id);
  if (!target) throw new Error(`Unknown theorem: @${id}`);
  if (target.origin !== 'user') throw new Error(`@${id} is not a protected main goal`);
  const metadataFile = path.join(directory, 'workspace.json');
  if (await exists(metadataFile)) {
    return { schema_version: 1, status: 'resumed', workspace: relativePosix(root, directory), metadata: await readJson(metadataFile) };
  }
  const located = await readLocatedBlock(path.join(root, target.file), id);
  const targetFile = compilation.manifest.files.find((file) => file.path === target.file);
  const availableIds = new Set([
    ...theoremBundle(compilation, id).dependencies.map((result) => result.id),
    ...(targetFile?.imports ?? []).flatMap((declaration) => declaration.use)
  ]);
  const dependencySnapshot = Object.fromEntries(compilation.manifest.results.filter((result) => availableIds.has(result.id)).map((result) => [result.id, {
    statement_hash: result.statement_hash,
    proof_hash: result.proof_hash,
    status: result.status
  }]));
  await Promise.all(['context', 'attempts', 'dead-ends', 'proposals', 'verification'].map((name) => mkdir(path.join(directory, name), { recursive: true })));
  const metadata = {
    schema_version: 1,
    target: id,
    status: 'active',
    created_at: new Date().toISOString(),
    canonical: {
      file: target.file,
      statement_hash: target.statement_hash,
      title_hash: target.title_hash,
      proof_hash: target.proof_hash,
      status: target.status,
      dependencies: dependencySnapshot
    }
  };
  await Promise.all([
    atomicJson(metadataFile, metadata),
    atomicWrite(path.join(directory, 'target.qmd'), `${located.raw.trim()}\n`),
    atomicWrite(path.join(directory, 'progress.qmd'), `---\ntitle: "Workspace: ${target.title}"\n---\n\n## Current frontier\n\n- @${id}: ${target.status}\n\n## Active route\n\nRecord the current proof route here.\n\n## Abandoned routes\n\nKeep detailed dead ends under \`dead-ends/\`.\n`)
  ]);
  return { schema_version: 1, status: 'created', workspace: relativePosix(root, directory), metadata };
}

export async function inspectWorkspace(root, requested, options = {}) {
  root = path.resolve(root);
  const { id, directory } = workspaceDirectory(root, requested);
  if (!await exists(path.join(directory, 'workspace.json'))) await initializeWorkspace(root, id, options);
  const [metadata, canonical, files] = await Promise.all([
    readJson(path.join(directory, 'workspace.json')),
    compileProject(root, options),
    discoverActive(directory)
  ]);
  const canonicalById = new Map(canonical.manifest.results.map((result) => [result.id, result]));
  const currentTarget = canonicalById.get(id);
  const targetStale = !currentTarget
    || currentTarget.statement_hash !== metadata.canonical.statement_hash
    || currentTarget.title_hash !== metadata.canonical.title_hash
    || currentTarget.proof_hash !== metadata.canonical.proof_hash
    || currentTarget.status !== metadata.canonical.status;
  const dependencyStale = Object.entries(metadata.canonical.dependencies ?? {}).some(([dependency, snapshot]) => {
    const result = canonicalById.get(dependency);
    return !result || result.statement_hash !== snapshot.statement_hash || result.proof_hash !== snapshot.proof_hash || result.status !== snapshot.status;
  });
  const stale = targetStale || dependencyStale;
  const provisional = files.length
    ? await compileProject(root, { ...options, files, externalTargets: canonical.manifest.results.map((result) => result.id), write: false })
    : { manifest: { results: [], proofs: [] }, graph: { nodes: [], edges: [] }, diagnostics: [], summary: { files: 0, results: 0, errors: 0, warnings: 0 } };
  const diagnostics = provisional.diagnostics.filter((item) => {
    if (!['DEPENDENCY_UNKNOWN', 'IMPORT_FILE_MISSING', 'IMPORT_ID_MISSING'].includes(item.code)) return true;
    const referenced = item.message.match(/@((?:def|lem|thm|prp|cor)-[^\s,]+)/)?.[1];
    return !referenced || !canonicalById.has(referenced);
  });
  if (stale) diagnostics.push({
    severity: 'error', code: 'WORKSPACE_STALE',
    message: `The protected canonical snapshot for @${id} is stale`,
    file: relativePosix(root, path.join(directory, 'workspace.json')), id
  });
  const workspaceResults = provisional.manifest.results.map((result) => ({
    ...result,
    origin: 'workspace',
    workspace: id,
    file: relativePosix(directory, path.resolve(root, result.file)),
    status: result.proof_present ? 'workspace-candidate' : 'workspace-open'
  }));
  const workspaceIds = new Set(workspaceResults.map((result) => result.id));
  const availableCanonical = new Set(Object.keys(metadata.canonical.dependencies ?? {}));
  const externalProofs = new Map();
  for (const proof of provisional.manifest.proofs) {
    if (workspaceIds.has(proof.target) || !canonicalById.has(proof.target) || externalProofs.has(proof.target)) continue;
    const canonicalResult = canonicalById.get(proof.target);
    externalProofs.set(proof.target, {
      ...canonicalResult,
      origin: 'workspace',
      workspace: id,
      file: relativePosix(directory, path.resolve(root, proof.file)),
      proof_hash: proof.proof_hash,
      proof_present: proof.proof_present,
      dependencies: proof.dependencies,
      uses: proof.dependencies,
      status: 'workspace-candidate'
    });
  }
  workspaceResults.push(...externalProofs.values());
  for (const result of workspaceResults) {
    if (canonicalById.has(result.id) && result.id !== id) diagnostics.push({
      severity: 'error', code: 'WORKSPACE_CANONICAL_COLLISION',
      message: `Workspace result @${result.id} collides with canonical mathematics`,
      file: result.file, line: result.line, id: result.id
    });
    for (const dependency of result.dependencies) {
      const canonicalDependency = canonicalById.get(dependency);
      if (!canonicalDependency) continue;
      if (!availableCanonical.has(dependency)) diagnostics.push({
        severity: 'error', code: 'WORKSPACE_DEPENDENCY_UNAVAILABLE',
        message: `Workspace fact @${result.id} cites canonical @${dependency}, which was not imported by the protected target`,
        file: result.file, line: result.proof_line ?? result.line, id: result.id
      });
      else if (canonicalDependency.status !== 'verified') diagnostics.push({
        severity: 'error', code: 'WORKSPACE_DEPENDENCY_STATUS_INSUFFICIENT',
        message: `Workspace fact @${result.id} cites canonical @${dependency}, whose current status is ${canonicalDependency.status}`,
        file: result.file, line: result.proof_line ?? result.line, id: result.id
      });
    }
  }
  const citedCanonicalIds = new Set(workspaceResults.flatMap((result) => result.dependencies).filter((dependency) => canonicalById.has(dependency)));
  const canonicalNodes = [...citedCanonicalIds].sort().map((dependency) => {
    const result = canonicalById.get(dependency);
    return {
      id: result.id, title: result.title, kind: result.kind, status: result.status,
      file: result.file, line: result.line, origin: 'canonical',
      identity: { statement_hash: result.statement_hash, proof_hash: result.proof_hash }
    };
  });
  const knownIds = new Set([...workspaceResults.map((result) => result.id), ...canonicalNodes.map((result) => result.id)]);
  const unresolvedNodes = [...new Set(workspaceResults.flatMap((result) => result.dependencies).filter((dependency) => !knownIds.has(dependency)))].sort()
    .map((dependency) => ({ id: dependency, title: '', kind: 'unknown', status: 'missing', origin: 'unresolved' }));
  const provisionalEdges = new Map(provisional.graph.edges.map((edge) => [`${edge.from}\0${edge.to}`, edge]));
  const graph = {
    schema_version: 2,
    nodes: [
      ...workspaceResults.map(({ id: resultId, title, kind, status, file, line, statement_hash, proof_hash }) => ({
        id: resultId, title, kind, status, file, line, origin: 'workspace',
        identity: { statement_hash, proof_hash }
      })),
      ...canonicalNodes,
      ...unresolvedNodes
    ],
    edges: workspaceResults.flatMap((result) => result.dependencies.map((dependency) => {
      const edge = provisionalEdges.get(`${result.id}\0${dependency}`);
      const canonicalDependency = canonicalById.get(dependency);
      return {
        from: result.id,
        to: dependency,
        checks: canonicalDependency ? {
          existence: 'pass',
          scope: availableCanonical.has(dependency) ? 'pass' : 'fail',
          status: canonicalDependency.status === 'verified' ? 'pass' : 'fail',
          cycle: 'pass',
          ai_sufficiency: 'not-run'
        } : edge?.checks ?? { existence: 'fail', scope: 'fail', status: 'fail', cycle: 'pass', ai_sufficiency: 'not-run' }
      };
    })).sort((left, right) => `${left.from}:${left.to}`.localeCompare(`${right.from}:${right.to}`)),
    cycles: provisional.graph.cycles ?? []
  };
  graph.snapshot_id = sha256(stableJson(graph, 0));
  const manifest = { schema_version: 2, snapshot_id: graph.snapshot_id, target: id, stale, results: workspaceResults, canonical_results: canonicalNodes };
  const complete = canonical.complete && provisional.complete !== false;
  if (complete) await Promise.all([atomicJson(path.join(directory, 'manifest.json'), manifest), atomicJson(path.join(directory, 'graph.json'), graph)]);
  return {
    schema_version: 2,
    ok: diagnostics.every((item) => item.severity !== 'error'),
    complete,
    snapshot_id: graph.snapshot_id,
    snapshot_published: complete,
    workspace: relativePosix(root, directory),
    target: currentTarget ?? { id, status: 'missing' },
    stale,
    manifest,
    graph,
    diagnostics
  };
}
