import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { analyzeDependencies, inspectFact, inspectPath, inspectProject } from '../skills/qmd-prover/src/lib/inspection/operations.js';
import { checkStaleness } from '../skills/qmd-prover/src/lib/verification/staleness.js';
import { revokeVerification, submitProof } from '../skills/qmd-prover/src/lib/verification/submissions.js';
import { initializeWorkspace } from '../skills/qmd-prover/src/lib/workspace/initialize.js';
import { inspectWorkspace } from '../skills/qmd-prover/src/lib/workspace/inspect.js';
import { must, options, project, proof, result, verifier } from './support.js';

async function createWorkspace(root: string, id: string, body: string): Promise<string> {
  await writeFile(path.join(root, `${id}.qmd`), result(id, `${id} statement.`));
  const created = await initializeWorkspace(root, `@${id}`, options);
  const workspace = path.join(root, created.workspace);
  await writeFile(path.join(workspace, 'work.qmd'), body);
  return workspace;
}

test('project-goals mode ignores theorem-like note content but protects main-goal shape and statements', async () => {
  const root = await project();
  const note = path.join(root, 'notes.qmd');
  await writeFile(note, `---\nqmd-prover:\n  imports: invalid\n---\n\n::: {#lem-note .wrong}\nArbitrary user notation.\n:::\n`);
  const noteInspection = await inspectPath(root, 'notes.qmd', options);
  assert.equal(noteInspection.ok, true, JSON.stringify(noteInspection.diagnostics));
  assert.deepEqual(noteInspection.facts, []);

  await writeFile(path.join(root, 'goal.qmd'), result('thm-main-shaped', 'Protected statement.').replace('.theorem .goal', '.theorem'));
  const projectInspection = await inspectProject(root, options);
  assert.ok(projectInspection.diagnostics.some((item) => item.code === 'MAIN_GOAL_SHAPE' && item.id === 'thm-main-shaped'));

  await writeFile(path.join(root, 'goal.qmd'), result('thm-main-shaped', 'Protected statement.'));
  await inspectProject(root, options);
  await writeFile(path.join(root, 'goal.qmd'), result('thm-main-shaped', 'Changed protected statement.'));
  assert.ok((await inspectProject(root, options)).diagnostics.some((item) => item.code === 'MAIN_STATEMENT_MUTATED'));
});

test('workspace and user paths are scoped, while missing and uninitialized workspaces are structured failures', async () => {
  const root = await project();
  const workspace = await createWorkspace(root, 'thm-main-path-scope', [
    result('def-path-scope', 'A local construction.'),
    result('lem-path-scope', 'A local consequence.', { proofText: 'Use @def-path-scope.' }),
    proof('thm-main-path-scope', 'Use @lem-path-scope.')
  ].join('\n'));
  await writeFile(path.join(root, 'ordinary.qmd'), '::: {#thm-note .theorem}\nNot a qmd-prover main goal.\n:::\n');
  const progress = path.join(workspace, 'progress.qmd');
  await writeFile(progress, '# User-maintained progress\n');
  process.env.QMD_PROVER_VERIFIER = verifier;
  try {
    const selected = await inspectPath(root, path.relative(root, path.join(workspace, 'work.qmd')), options);
    assert.equal(selected.ok, true, JSON.stringify(selected.diagnostics));
    assert.deepEqual(selected.facts.map((fact) => fact.id).sort(), ['def-path-scope', 'lem-path-scope', 'thm-main-path-scope']);
    assert.deepEqual((await inspectPath(root, 'ordinary.qmd', options)).facts, []);
    assert.equal(await readFile(progress, 'utf8'), '# User-maintained progress\n');
  } finally { delete process.env.QMD_PROVER_VERIFIER; }

  await writeFile(path.join(root, 'thm-main-no-workspace.qmd'), result('thm-main-no-workspace', 'No workspace yet.'));
  assert.equal((await inspectFact(root, '@thm-main-no-workspace', options)).diagnostics[0]?.code, 'WORKSPACE_MISSING');

  const uninitialized = path.join(root, '.qmd-prover', 'workspaces', 'thm-main-uninitialized');
  await mkdir(uninitialized, { recursive: true });
  await writeFile(path.join(uninitialized, 'candidate.qmd'), result('lem-uninitialized', 'Uninitialized candidate.', { proofText: 'Argument.' }));
  const uninitializedFact = await inspectFact(root, '@lem-uninitialized', options);
  assert.equal(uninitializedFact.ok, false);
  assert.ok(uninitializedFact.diagnostics.some((item) => item.code === 'WORKSPACE_UNINITIALIZED'));
  const projectInspection = await inspectProject(root, options);
  const entries = projectInspection.workspaces as Array<{ id: string; status: string }>;
  assert.ok(entries.some((entry) => entry.id === 'thm-main-uninitialized' && entry.status === 'uninitialized'), JSON.stringify(entries));
});

test('project inspection returns healthy workspace results when another workspace is malformed', async () => {
  const root = await project();
  await createWorkspace(root, 'thm-main-healthy', `${result('lem-healthy', 'Healthy lemma.', { proofText: 'Argument.' })}\n${proof('thm-main-healthy', 'Use @lem-healthy.')}`);
  await createWorkspace(root, 'thm-main-malformed', `${result('lem-malformed', 'Missing proof.')}\n${proof('thm-main-malformed', 'Use @lem-malformed.')}`);
  process.env.QMD_PROVER_VERIFIER = verifier;
  try {
    const inspected = await inspectProject(root, options);
    assert.equal(inspected.ok, false);
    const workspaces = inspected.workspaces as Array<{ target: { id: string }; ok: boolean; facts?: Array<{ id: string; status: string }> }>;
    const healthy = must(workspaces.find((workspace) => workspace.target.id === 'thm-main-healthy'));
    const malformed = must(workspaces.find((workspace) => workspace.target.id === 'thm-main-malformed'));
    assert.equal(healthy.ok, true);
    assert.ok(healthy.facts?.every((fact) => fact.status === 'workspace-verified'));
    assert.equal(malformed.ok, false);
  } finally { delete process.env.QMD_PROVER_VERIFIER; }
});

test('global duplicate IDs stop all inspection and dependency verification without publishing a snapshot', async () => {
  const root = await project();
  const left = await createWorkspace(root, 'thm-main-left', `${result('lem-global-duplicate', 'Left declaration.', { proofText: 'Argument.' })}\n${proof('thm-main-left', 'Use @lem-global-duplicate.')}`);
  const right = await createWorkspace(root, 'thm-main-right', `${result('lem-right-local', 'Temporary declaration.', { proofText: 'Argument.' })}\n${proof('thm-main-right', 'Use @lem-right-local.')}`);
  const latest = path.join(root, '.qmd-prover', 'graphs', 'latest.json');
  const before = await readFile(latest);
  await writeFile(path.join(right, 'work.qmd'), `${result('lem-global-duplicate', 'Right declaration.', { proofText: 'Argument.' })}\n${proof('thm-main-right', 'Use @lem-global-duplicate.')}`);
  const countFile = path.join(root, 'duplicate-verifier-calls.txt');
  process.env.QMD_PROVER_VERIFIER = verifier;
  process.env.QMD_PROVER_VERIFIER_COUNT = countFile;
  try {
    const projectResult = await inspectProject(root, options);
    const factResult = await inspectFact(root, '@lem-global-duplicate', options);
    const pathResult = await inspectPath(root, path.relative(root, path.join(left, 'work.qmd')), options);
    const workspaceResult = await inspectWorkspace(root, '@thm-main-left', options);
    const dependencyResult = await analyzeDependencies(root, 'cycles', [], options);
    for (const resultValue of [projectResult, factResult, pathResult, workspaceResult, dependencyResult]) {
      assert.equal(resultValue.ok, false);
      assert.ok((resultValue.diagnostics as Array<{ code: string }>).some((item) => item.code === 'GLOBAL_DUPLICATE_ID'));
    }
    await assert.rejects(readFile(countFile), { code: 'ENOENT' });
    assert.deepEqual(await readFile(latest), before);
    assert.ok(projectResult.diagnostics.find((item) => item.code === 'GLOBAL_DUPLICATE_ID')?.locations?.every((location) => !path.isAbsolute(location)));
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
    delete process.env.QMD_PROVER_VERIFIER_COUNT;
  }
});

test('aggregate graph covers all workspaces and excludes cross-workspace edges', async () => {
  const root = await project();
  await createWorkspace(root, 'thm-main-aggregate-a', `${result('lem-aggregate-a', 'A.', { proofText: 'Argument.' })}\n${proof('thm-main-aggregate-a', 'Use @lem-aggregate-a.')}`);
  await createWorkspace(root, 'thm-main-aggregate-b', `${result('lem-aggregate-b', 'B.', { proofText: 'Improperly use @lem-aggregate-a.' })}\n${proof('thm-main-aggregate-b', 'Use @lem-aggregate-b.')}`);
  const dependency = await analyzeDependencies(root, 'findings', [], options);
  assert.ok(dependency.graph?.nodes.some((node) => node.id === 'lem-aggregate-a'));
  assert.ok(dependency.graph?.nodes.some((node) => node.id === 'lem-aggregate-b'));
  assert.ok(!dependency.graph?.edges.some((edge) => edge.from === 'lem-aggregate-b' && edge.to === 'lem-aggregate-a'));
  assert.ok((dependency.diagnostics as Array<{ code: string }>).some((item) => item.code === 'CROSS_WORKSPACE_DEPENDENCY'));
  const search = await analyzeDependencies(root, 'search', ['aggregate'], options);
  assert.ok(search.matches?.some((node) => node.id === 'lem-aggregate-a'));
});

test('narrow inspection preserves current verification state from unrelated workspace snapshots', async () => {
  const root = await project();
  await createWorkspace(root, 'thm-main-preserve-a', `${result('lem-preserve-a', 'A.', { proofText: 'Argument.' })}\n${proof('thm-main-preserve-a', 'Use @lem-preserve-a.')}`);
  await createWorkspace(root, 'thm-main-preserve-b', `${result('lem-preserve-b', 'B.', { proofText: 'Argument.' })}\n${proof('thm-main-preserve-b', 'Use @lem-preserve-b.')}`);
  process.env.QMD_PROVER_VERIFIER = verifier;
  try {
    const complete = await inspectProject(root, options);
    assert.equal(complete.ok, true, JSON.stringify(complete.diagnostics));
    const narrow = await inspectFact(root, '@lem-preserve-a', options);
    assert.equal(narrow.ok, true, JSON.stringify(narrow.diagnostics));
    assert.ok(!narrow.graph.nodes.some((node) => node.id === 'lem-preserve-b'));
    const published = JSON.parse(await readFile(path.join(root, '.qmd-prover', 'graph.json'), 'utf8')) as {
      nodes: Array<{ id: string; status: string }>;
    };
    assert.equal(published.nodes.find((node) => node.id === 'lem-preserve-b')?.status, 'workspace-verified');
    const dependency = await analyzeDependencies(root, 'dependencies', ['@lem-preserve-b'], options);
    assert.equal((dependency.target as { status?: string } | undefined)?.status, 'workspace-verified');
  } finally { delete process.env.QMD_PROVER_VERIFIER; }
});

test('workspace facts cannot use another protected main goal as an implicit fact', async () => {
  const root = await project();
  await writeFile(path.join(root, 'other.qmd'), result('thm-main-other-basis', 'Another protected goal.'));
  await createWorkspace(root, 'thm-main-no-main-goal-basis', [
    result('lem-no-main-goal-basis', 'Invalid consequence.', { proofText: 'Use @thm-main-other-basis.' }),
    proof('thm-main-no-main-goal-basis', 'Use @lem-no-main-goal-basis.')
  ].join('\n'));
  const countFile = path.join(root, 'main-goal-basis-verifier-calls.txt');
  process.env.QMD_PROVER_VERIFIER = verifier;
  process.env.QMD_PROVER_VERIFIER_COUNT = countFile;
  try {
    const inspected = await inspectWorkspace(root, '@thm-main-no-main-goal-basis', options);
    assert.equal(inspected.ok, false);
    assert.ok(inspected.diagnostics.some((item) => item.code === 'WORKSPACE_EXTERNAL_FACT_DEPENDENCY'));
    await assert.rejects(readFile(countFile), { code: 'ENOENT' });
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
    delete process.env.QMD_PROVER_VERIFIER_COUNT;
  }
});

test('aggregate dependency cycles cover workspace mathematics without a target argument', async () => {
  const root = await project();
  await createWorkspace(root, 'thm-main-cycle-aggregate', [
    result('lem-cycle-aggregate-a', 'A.', { proofText: 'Use @lem-cycle-aggregate-b.' }),
    result('lem-cycle-aggregate-b', 'B.', { proofText: 'Use @lem-cycle-aggregate-a.' }),
    proof('thm-main-cycle-aggregate', 'Use @lem-cycle-aggregate-a.')
  ].join('\n'));
  const cycles = await analyzeDependencies(root, 'cycles', [], options);
  assert.equal(cycles.ok, false);
  assert.deepEqual(cycles.cycles, [['lem-cycle-aggregate-a', 'lem-cycle-aggregate-b', 'lem-cycle-aggregate-a']]);
});

test('parse failures remain PARSE_ERROR instead of becoming unknown facts', async () => {
  const root = await project();
  await writeFile(path.join(root, 'goal.qmd'), result('thm-main-parse', 'Parse target.'));
  const inspected = await inspectFact(root, '@def-not-found', { pandoc: path.join(root, 'missing-pandoc') });
  assert.equal(inspected.ok, false);
  assert.ok(inspected.diagnostics.length > 0);
  assert.ok(inspected.diagnostics.every((item) => item.code === 'PARSE_ERROR'));
});

test('retired verification commands and staleness audit never change user QMD', async () => {
  const root = await project();
  const userFile = path.join(root, 'goal.qmd');
  await writeFile(userFile, result('thm-main-retired', 'User-owned statement.'));
  const before = await readFile(userFile);
  assert.equal((await submitProof(root, path.join(root, 'missing.qmd'), options)).status, 'retired');
  assert.equal((await revokeVerification(root, '@thm-main-retired', 'reason', options)).status, 'retired');
  const audit = await checkStaleness(root, options);
  assert.equal(audit.operation, 'check-staleness');
  assert.deepEqual(await readFile(userFile), before);
});

test('legacy canonical markers and records are warned about but left untouched', async () => {
  const root = await project();
  const userFile = path.join(root, 'legacy.qmd');
  await writeFile(userFile, result('thm-main-legacy', 'Legacy statement.', { proofText: 'VERIFIED\n\nLegacy proof.' }));
  await mkdir(path.join(root, '.qmd-prover', 'verification'), { recursive: true });
  await writeFile(path.join(root, '.qmd-prover', 'verification', 'index.json'), JSON.stringify({
    'thm-main-legacy': { status: 'verified', proof_hash: 'legacy' }
  }));
  const before = await readFile(userFile);
  const inspected = await inspectProject(root, options);
  assert.ok(inspected.diagnostics.some((item) => item.code === 'LEGACY_CANONICAL_VERIFICATION'));
  const audit = await checkStaleness(root, options);
  assert.ok(audit.changed.some((item) => item.id === 'thm-main-legacy' && item.reasons.includes('legacy-canonical-verification-record')));
  assert.deepEqual(await readFile(userFile), before);
});

test('stale workspace inspection is structured and invokes no verifier', async () => {
  const root = await project();
  await createWorkspace(root, 'thm-main-stale-structured', `${result('lem-stale-structured', 'Lemma.', { proofText: 'Argument.' })}\n${proof('thm-main-stale-structured', 'Use @lem-stale-structured.')}`);
  await writeFile(path.join(root, 'thm-main-stale-structured.qmd'), result('thm-main-stale-structured', 'Changed statement.'));
  const countFile = path.join(root, 'stale-verifier-calls.txt');
  process.env.QMD_PROVER_VERIFIER = verifier;
  process.env.QMD_PROVER_VERIFIER_COUNT = countFile;
  try {
    const inspected = await inspectWorkspace(root, '@thm-main-stale-structured', options);
    assert.equal(inspected.ok, false);
    assert.equal(inspected.stale, true);
    assert.equal(inspected.verification.verifier_calls, 0);
    assert.ok(inspected.diagnostics.some((item) => item.code === 'WORKSPACE_STALE'));
    await assert.rejects(readFile(countFile), { code: 'ENOENT' });
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
    delete process.env.QMD_PROVER_VERIFIER_COUNT;
  }
});
