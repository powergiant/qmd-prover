import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { readJson } from '../skills/qmd-prover/src/lib/infrastructure/files.js';
import { initializeWorkspace } from '../skills/qmd-prover/src/lib/workspace/initialize.js';
import { inspectWorkspace } from '../skills/qmd-prover/src/lib/workspace/inspect.js';
import { must, options, project, proof, result, verifier } from './support.js';

test('goal workspaces preserve a protected target snapshot and report statement staleness', async () => {
  const root = await project();
  const userGoal = path.join(root, 'goal.qmd');
  await writeFile(userGoal, result('thm-main-work', 'Do the work.', { title: 'Workspace theorem' }));
  const created = await initializeWorkspace(root, '@thm-main-work', options);
  assert.equal(created.status, 'created');
  const workspace = path.join(root, created.workspace);
  assert.match(await readFile(path.join(workspace, 'target.qmd'), 'utf8'), /#thm-main-work/);
  await mkdir(path.join(workspace, 'local-theory'));
  await mkdir(path.join(workspace, '.machine'));
  await mkdir(path.join(workspace, 'generated'));
  await writeFile(path.join(workspace, 'local-theory', 'lemma.qmd'), result('lem-work', 'A working lemma.', { proofText: 'A workspace argument.' }));
  await writeFile(path.join(workspace, '.machine', 'ignored.qmd'), result('lem-hidden-work', 'Hidden machine state.'));
  await writeFile(path.join(workspace, 'generated', 'ignored.qmd'), result('lem-generated-work', 'Generated output.'));
  await writeFile(path.join(workspace, 'main-attempt.qmd'), proof('thm-main-work', 'Use @lem-work.'));
  const inspected = await inspectWorkspace(root, '@thm-main-work', options);
  assert.equal(inspected.stale, false);
  assert.ok(inspected.manifest.results.every((item) => item.origin === 'workspace'));
  assert.equal(must(inspected.manifest.results.find((item) => item.id === 'lem-work')).status, 'workspace-candidate');
  assert.equal(must(inspected.manifest.results.find((item) => item.id === 'thm-main-work')).status, 'workspace-candidate');
  assert.ok(!inspected.manifest.results.some((item) => ['lem-hidden-work', 'lem-generated-work'].includes(item.id)));
  assert.ok(inspected.graph.edges.some((edge) => edge.from === 'thm-main-work' && edge.to === 'lem-work'));
  await writeFile(userGoal, result('thm-main-work', 'Changed protected statement.', { title: 'Workspace theorem' }));
  assert.equal((await inspectWorkspace(root, '@thm-main-work', options)).stale, true);
});

test('workspace inspection verifies a dependency chain and reuses exact caches', async () => {
  const root = await project();
  const countFile = path.join(root, 'workspace-verifier-calls.txt');
  process.env.QMD_PROVER_VERIFIER = verifier;
  process.env.QMD_PROVER_VERIFIER_COUNT = countFile;
  try {
    await writeFile(path.join(root, 'goal.qmd'), result('thm-main-workspace-ai', 'The workspace route succeeds.'));
    const created = await initializeWorkspace(root, '@thm-main-workspace-ai', options);
    const workspace = path.join(root, created.workspace);
    const route = path.join(workspace, 'route.qmd');
    await writeFile(route, [
      result('def-workspace-object', 'Construct the workspace object.'),
      result('lem-workspace-route', 'The workspace object has the needed property.', { proofText: 'Apply @def-workspace-object.' }),
      proof('thm-main-workspace-ai', 'Apply @lem-workspace-route.')
    ].join('\n'));

    const first = await inspectWorkspace(root, '@thm-main-workspace-ai', options);
    assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
    assert.equal(first.verification.verifier_calls, 3);
    assert.deepEqual(first.facts.map((fact) => fact.status), ['workspace-verified', 'workspace-verified', 'workspace-verified']);
    assert.doesNotMatch(await readFile(route, 'utf8'), /VERIFIED/);
    const firstSnapshot = first.snapshot_id;
    const firstPointer = await readJson<{ snapshot_id: string; file: string }>(path.join(workspace, 'latest.json'));
    assert.equal(firstPointer.snapshot_id, firstSnapshot);
    assert.equal((await readJson<{ snapshot_id: string }>(path.join(workspace, firstPointer.file))).snapshot_id, firstSnapshot);

    const second = await inspectWorkspace(root, '@thm-main-workspace-ai', options);
    assert.equal(second.ok, true);
    assert.equal(second.verification.verifier_calls, 0);
    assert.equal(second.verification.cache_hits, 3);
    assert.equal(second.snapshot_id, firstSnapshot);

    await writeFile(route, (await readFile(route, 'utf8')).replace('Apply @def-workspace-object.', 'Apply @def-workspace-object by the changed route.'));
    const changed = await inspectWorkspace(root, '@thm-main-workspace-ai', options);
    assert.equal(changed.ok, true);
    assert.equal(changed.verification.verifier_calls, 2);
    assert.equal(changed.verification.cache_hits, 1);
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
    delete process.env.QMD_PROVER_VERIFIER_COUNT;
  }
});
