import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { compileProject } from '../skills/qmd-prover/scripts/lib/compiler.mjs';
import { readJson } from '../skills/qmd-prover/scripts/lib/files.mjs';
import { initializeWorkspace, inspectWorkspace } from '../skills/qmd-prover/scripts/lib/workspace.mjs';
import { submitProof } from '../skills/qmd-prover/scripts/lib/verification.mjs';
import { document, options, project, proposalPath, proof, result, staleVerifier, verifier } from './support.mjs';

test('goal workspaces preserve a protected target snapshot and report staleness', async () => {
  const root = await project();
  const canonical = path.join(root, 'goal.qmd');
  await writeFile(canonical, result('thm-main-work', 'Do the work.', { title: 'Workspace theorem' }));
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
  assert.equal(inspected.manifest.results.find((item) => item.id === 'lem-work').status, 'workspace-candidate');
  assert.equal(inspected.manifest.results.find((item) => item.id === 'thm-main-work').status, 'workspace-candidate');
  assert.ok(!inspected.manifest.results.some((item) => ['lem-hidden-work', 'lem-generated-work'].includes(item.id)));
  assert.ok(inspected.graph.edges.some((edge) => edge.from === 'thm-main-work' && edge.to === 'lem-work'));
  await writeFile(canonical, result('thm-main-work', 'Do the work.', { title: 'Workspace theorem', proofText: 'A concurrent proof.' }));
  assert.equal((await inspectWorkspace(root, '@thm-main-work', options)).stale, true);
});

test('workspace inspection verifies a provisional dependency chain and reuses exact caches', async () => {
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
    const firstPointer = await readJson(path.join(workspace, 'latest.json'));
    assert.equal(firstPointer.snapshot_id, firstSnapshot);
    assert.equal((await readJson(path.join(workspace, firstPointer.file))).snapshot_id, firstSnapshot);

    const second = await inspectWorkspace(root, '@thm-main-workspace-ai', options);
    assert.equal(second.ok, true);
    assert.equal(second.verification.verifier_calls, 0);
    assert.equal(second.verification.cache_hits, 3);
    assert.equal(second.snapshot_id, firstSnapshot);
    assert.equal((await readFile(countFile, 'utf8')).trim().split('\n').length, 3);

    await writeFile(route, `\n${await readFile(route, 'utf8')}`);
    const moved = await inspectWorkspace(root, '@thm-main-workspace-ai', options);
    assert.equal(moved.ok, true);
    assert.equal(moved.verification.verifier_calls, 0);
    assert.equal(moved.verification.cache_hits, 3);

    await writeFile(route, (await readFile(route, 'utf8')).replace('Apply @def-workspace-object.', 'Apply @def-workspace-object by the changed route.'));
    const changed = await inspectWorkspace(root, '@thm-main-workspace-ai', options);
    assert.equal(changed.ok, true);
    assert.equal(changed.verification.verifier_calls, 2);
    assert.equal(changed.verification.cache_hits, 1);
    assert.notEqual(changed.snapshot_id, firstSnapshot);
    assert.equal((await readFile(countFile, 'utf8')).trim().split('\n').length, 5);
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
    delete process.env.QMD_PROVER_VERIFIER_COUNT;
  }
});

test('workspace inspection admits only current verified canonical imports from the protected target', async () => {
  const root = await project();
  process.env.QMD_PROVER_VERIFIER = verifier;
  await writeFile(path.join(root, 'base.qmd'), `${result('lem-workspace-import', 'Imported premise.', { exported: true })}\n${result('lem-workspace-hidden', 'Unimported premise.', { exported: true })}`);
  await writeFile(path.join(root, 'goal.qmd'), document(
    [{ from: 'base.qmd', use: ['lem-workspace-import'] }],
    result('thm-main-workspace-scope', 'Workspace conclusion.')
  ));
  for (const id of ['lem-workspace-import', 'lem-workspace-hidden']) {
    const proposal = proposalPath(root, `${id}.qmd`);
    await writeFile(proposal, proof(id, 'A direct proof.'));
    assert.equal((await submitProof(root, proposal, options)).status, 'verified');
  }
  const created = await initializeWorkspace(root, '@thm-main-workspace-scope', options);
  const workspace = path.join(root, created.workspace);
  const attempt = path.join(workspace, 'main-attempt.qmd');
  await writeFile(attempt, proof('thm-main-workspace-scope', 'Apply @lem-workspace-import.'));
  const available = await inspectWorkspace(root, '@thm-main-workspace-scope', options);
  assert.equal(available.ok, true, JSON.stringify(available.diagnostics));
  assert.equal(available.graph.edges[0].checks.scope, 'pass');
  assert.equal(available.graph.edges[0].checks.status, 'pass');
  await writeFile(attempt, proof('thm-main-workspace-scope', 'Apply @lem-workspace-hidden.'));
  const unavailable = await inspectWorkspace(root, '@thm-main-workspace-scope', options);
  assert.equal(unavailable.ok, false);
  assert.ok(unavailable.diagnostics.some((item) => item.code === 'WORKSPACE_DEPENDENCY_UNAVAILABLE'));
  delete process.env.QMD_PROVER_VERIFIER;
});

test('concurrent independent submissions serialize canonical state writes', async () => {
  const root = await project();
  process.env.QMD_PROVER_VERIFIER = verifier;
  await writeFile(path.join(root, 'goals.qmd'), `${result('thm-main-left', 'Left is left.')}\n${result('thm-main-right', 'Right is right.')}`);
  const left = proposalPath(root, 'left.qmd');
  const right = proposalPath(root, 'right.qmd');
  await Promise.all([writeFile(left, proof('thm-main-left', 'By reflexivity.')), writeFile(right, proof('thm-main-right', 'By reflexivity.'))]);
  const results = await Promise.all([submitProof(root, left, options), submitProof(root, right, options)]);
  assert.deepEqual(results.map((item) => item.status), ['verified', 'verified']);
  assert.deepEqual((await compileProject(root, options)).manifest.results.map((item) => item.status), ['verified', 'verified']);
  const events = (await readFile(path.join(root, '.qmd-prover', 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(events.filter((event) => event.type === 'verification-accepted').length, 2);
  delete process.env.QMD_PROVER_VERIFIER;
});

test('accepted verifier output is rejected as stale after a concurrent target edit', async () => {
  const root = await project();
  const targetFile = path.join(root, 'goal.qmd');
  const marker = path.join(root, 'verifier-ready');
  await writeFile(targetFile, result('thm-main-stale', 'Keep current state.'));
  const proposal = proposalPath(root, 'stale.qmd');
  await writeFile(proposal, proof('thm-main-stale', 'Candidate proof.'));
  process.env.QMD_PROVER_VERIFIER = staleVerifier;
  process.env.QMD_PROVER_VERIFIER_READY = marker;
  const submission = submitProof(root, proposal, options);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { await readFile(marker); break; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
  }
  await writeFile(targetFile, result('thm-main-stale', 'Keep current state.', { proofText: 'Concurrent canonical proof.' }));
  await assert.rejects(submission, /Stale submission/);
  assert.match(await readFile(targetFile, 'utf8'), /Concurrent canonical proof/);
  delete process.env.QMD_PROVER_VERIFIER;
  delete process.env.QMD_PROVER_VERIFIER_READY;
});

test('accepted verifier output is rejected as stale after the external basis changes', async () => {
  const root = await project();
  const policyFile = path.join(root, '.qmd-prover', '.external.qmd');
  const marker = path.join(root, 'external-verifier-ready');
  await writeFile(policyFile, 'Only elementary arithmetic may be used.\n');
  await writeFile(path.join(root, 'goal.qmd'), result('thm-main-external-stale', 'Keep the same external basis.'));
  const proposal = proposalPath(root, 'external-stale.qmd');
  await writeFile(proposal, proof('thm-main-external-stale', 'Candidate proof.'));
  process.env.QMD_PROVER_VERIFIER = staleVerifier;
  process.env.QMD_PROVER_VERIFIER_READY = marker;
  const submission = submitProof(root, proposal, options);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { await readFile(marker); break; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
  }
  await writeFile(policyFile, 'Standard algebra may be used.\n');
  await assert.rejects(submission, /external basis changed/);
  delete process.env.QMD_PROVER_VERIFIER;
  delete process.env.QMD_PROVER_VERIFIER_READY;
});
