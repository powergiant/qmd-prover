import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileProject, theoremBundle } from '../src/compiler.mjs';
import { readJson } from '../src/files.mjs';
import { renderProject } from '../src/render.mjs';
import { submitProof, revokeVerification } from '../src/verification.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const fakePandoc = path.join(here, 'fixtures', 'fake-pandoc.mjs');
const verifier = path.join(here, 'fixtures', 'mock-verifier.mjs');
const staleVerifier = path.join(here, 'fixtures', 'stale-verifier.mjs');
const options = { pandoc: fakePandoc };
process.env.PATH = `${path.dirname(process.execPath)}:${process.env.PATH}`;

async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qmd-prover-'));
  await Promise.all([chmod(fakePandoc, 0o755), chmod(verifier, 0o755), chmod(staleVerifier, 0o755)]);
  return root;
}

function theorem(id, statement, proof = '', uses = [], extra = '') {
  const kind = id.startsWith('lem-') ? 'lemma' : id.startsWith('def-') ? 'definition' : id.startsWith('prp-') ? 'proposition' : id.startsWith('cor-') ? 'corollary' : 'theorem';
  return `::: {#${id} .${kind}${id.startsWith('thm-main-') ? ' .goal' : ''}${extra}}\n## ${id}\n\n### Statement\n\n${statement}\n\n${uses.length ? `### Uses\n\n${uses.map((item) => `- @${item}`).join('\n')}\n\n` : ''}### Proof\n\n${proof}\n:::\n`;
}

test('compiler discovers nested QMD and builds deterministic semantic indexes', async () => {
  const root = await project();
  await mkdir(path.join(root, 'foundations'));
  await writeFile(path.join(root, 'foundations', 'base.qmd'), theorem('lem-base', 'For every x, x equals x.', 'This follows by reflexivity.', [], ' export="base"'));
  await writeFile(path.join(root, 'goal.qmd'), `Unrestricted prose.\n\n::: {.theorem-imports}\nfrom: foundations/base.qmd\nuse:\n  - @lem-base\n:::\n\n${theorem('thm-main-goal', 'For every x, x equals x.', 'Apply @lem-base.', ['lem-base'])}`);
  const first = await compileProject(root, options);
  const firstManifest = await readFile(path.join(root, '.qmd-prover', 'manifest.json'), 'utf8');
  const second = await compileProject(root, options);
  const secondManifest = await readFile(path.join(root, '.qmd-prover', 'manifest.json'), 'utf8');
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  assert.equal(second.ok, true);
  assert.equal(firstManifest, secondManifest);
  assert.deepEqual(first.summary.goals.map((goal) => goal.id), ['thm-main-goal']);
  assert.deepEqual(first.graph.edges, [{ from: 'thm-main-goal', to: 'lem-base' }]);
  assert.equal(theoremBundle(first, '@thm-main-goal').dependencies[0].id, 'lem-base');
});

test('compiler diagnoses imports, dependency declarations, duplicates, and cycles', async () => {
  const root = await project();
  await writeFile(path.join(root, 'a.qmd'), `::: {.theorem-imports}\nfrom: b.qmd\nuse:\n  - @lem-b\n:::\n${theorem('lem-a', 'A.', 'Use @lem-b.', [])}`);
  await writeFile(path.join(root, 'b.qmd'), `::: {.theorem-imports}\nfrom: a.qmd\nuse:\n  - @lem-a\n:::\n${theorem('lem-b', 'B.', '', [], ' export="b"')}${theorem('lem-a', 'Duplicate.', '')}`);
  const result = await compileProject(root, options);
  const codes = new Set(result.diagnostics.map((item) => item.code));
  assert.equal(result.ok, false);
  assert.ok(codes.has('DUPLICATE_ID'));
  assert.ok(codes.has('IMPORT_CYCLE'));
  assert.ok(codes.has('UNDECLARED_PROOF_REFERENCE'));
  assert.ok(codes.has('IMPORT_NOT_EXPORTED'));
});

test('compiler rejects semantic dependency cycles', async () => {
  const root = await project();
  await writeFile(path.join(root, 'cycle.qmd'), `${theorem('lem-left', 'Left.', 'Apply @lem-right.', ['lem-right'])}\n${theorem('lem-right', 'Right.', 'Apply @lem-left.', ['lem-left'])}`);
  const result = await compileProject(root, options);
  assert.ok(result.diagnostics.some((item) => item.code === 'DEPENDENCY_CYCLE'));
});

test('compiler validates semantic kind and main-goal classes', async () => {
  const root = await project();
  await writeFile(path.join(root, 'shape.qmd'), theorem('lem-wrong', 'Shape.', '', [], '').replace('.lemma', '.proposition'));
  const result = await compileProject(root, options);
  assert.ok(result.diagnostics.some((item) => item.code === 'ID_KIND_MISMATCH'));
});

test('main statement and title baselines are immutable', async () => {
  const root = await project();
  const file = path.join(root, 'goal.qmd');
  await writeFile(file, theorem('thm-main-fixed', 'Original statement.'));
  const baseline = await compileProject(root, options);
  assert.equal(baseline.ok, true, JSON.stringify(baseline.diagnostics));
  await writeFile(file, theorem('thm-main-fixed', 'Changed statement.'));
  const changed = await compileProject(root, options);
  assert.ok(changed.diagnostics.some((item) => item.code === 'MAIN_STATEMENT_MUTATED'));
});

test('rejected proposals leave canonical QMD unchanged and accepted repair merges only proof', async () => {
  const root = await project();
  process.env.QMD_PROVER_VERIFIER = verifier;
  const canonicalFile = path.join(root, 'goal.qmd');
  const initial = theorem('thm-main-proof', 'One equals one.');
  await writeFile(canonicalFile, initial);
  await writeFile(path.join(root, 'bad.qmd.proposal'), theorem('thm-main-proof', 'One equals one.', 'INVALID reasoning.'));
  const rejected = await submitProof(root, path.join(root, 'bad.qmd.proposal'), options);
  assert.equal(rejected.status, 'rejected');
  assert.equal(await readFile(canonicalFile, 'utf8'), initial);
  assert.equal((await compileProject(root, options)).manifest.results[0].status, 'rejected');
  await writeFile(path.join(root, 'good.qmd.proposal'), theorem('thm-main-proof', 'One equals one.', 'By reflexivity, one equals one.'));
  const accepted = await submitProof(root, path.join(root, 'good.qmd.proposal'), options);
  assert.equal(accepted.status, 'verified');
  const merged = await readFile(canonicalFile, 'utf8');
  assert.match(merged, /One equals one\.\n\n### Proof\n\nBy reflexivity/);
  const inspection = await compileProject(root, options);
  assert.equal(inspection.manifest.results[0].status, 'verified');
  await assert.rejects(() => submitProof(root, path.join(root, 'good.qmd.proposal'), options), /already verified/);
  const revoked = await revokeVerification(root, '@thm-main-proof', 'New concern', options);
  assert.equal(revoked.status, 'revoked');
  delete process.env.QMD_PROVER_VERIFIER;
});

test('a correct verdict with a gap is still rejected', async () => {
  const root = await project();
  process.env.QMD_PROVER_VERIFIER = verifier;
  const target = path.join(root, 'goal.qmd');
  const original = theorem('thm-main-gap', 'A complete proof is required.');
  await writeFile(target, original);
  const proposal = path.join(root, 'gap.proposal');
  await writeFile(proposal, theorem('thm-main-gap', 'A complete proof is required.', 'GAP in justification.'));
  const result = await submitProof(root, proposal, options);
  assert.equal(result.status, 'rejected');
  assert.deepEqual(result.report.gaps, ['justify the missing step']);
  assert.equal(await readFile(target, 'utf8'), original);
  delete process.env.QMD_PROVER_VERIFIER;
});

test('proposal cannot alter a protected statement', async () => {
  const root = await project();
  process.env.QMD_PROVER_VERIFIER = verifier;
  await writeFile(path.join(root, 'goal.qmd'), theorem('thm-main-safe', 'Keep this.'));
  await writeFile(path.join(root, 'changed.proposal'), theorem('thm-main-safe', 'Replace this.', 'A proof.'));
  await assert.rejects(() => submitProof(root, path.join(root, 'changed.proposal'), options), /changes the protected|structurally invalid/);
  delete process.env.QMD_PROVER_VERIFIER;
});

test('renderer creates escaped theorem pages, reports, and explicit graph links', async () => {
  const root = await project();
  await writeFile(path.join(root, 'goal.qmd'), theorem('thm-main-html', 'If x < y & y > 0, then x < y.'));
  const rendered = await renderProject(root, options);
  assert.equal(rendered.status, 'rendered');
  const theoremPage = await readFile(path.join(root, '.qmd-prover', 'site', 'theorems', 'thm-main-html.html'), 'utf8');
  const graph = await readFile(path.join(root, '.qmd-prover', 'site', 'graph.svg'), 'utf8');
  assert.match(theoremPage, /&lt; y &amp; y &gt; 0/);
  assert.match(graph, /href="theorems\/thm-main-html\.html"/);
  assert.equal((await readJson(path.join(root, '.qmd-prover', 'reports', 'status.json'))).summary.results, 1);
});

test('concurrent independent submissions serialize canonical state writes', async () => {
  const root = await project();
  process.env.QMD_PROVER_VERIFIER = verifier;
  await writeFile(path.join(root, 'goals.qmd'), `${theorem('thm-main-left', 'Left is left.')}\n${theorem('thm-main-right', 'Right is right.')}`);
  const left = path.join(root, 'left.proposal');
  const right = path.join(root, 'right.proposal');
  await Promise.all([
    writeFile(left, theorem('thm-main-left', 'Left is left.', 'By reflexivity.')),
    writeFile(right, theorem('thm-main-right', 'Right is right.', 'By reflexivity.'))
  ]);
  const results = await Promise.all([submitProof(root, left, options), submitProof(root, right, options)]);
  assert.deepEqual(results.map((result) => result.status), ['verified', 'verified']);
  const inspection = await compileProject(root, options);
  assert.deepEqual(inspection.manifest.results.map((result) => result.status), ['verified', 'verified']);
  const events = (await readFile(path.join(root, '.qmd-prover', 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(events.filter((event) => event.type === 'verification-accepted').length, 2);
  delete process.env.QMD_PROVER_VERIFIER;
});

test('accepted verifier output is rejected as stale after a concurrent target edit', async () => {
  const root = await project();
  const targetFile = path.join(root, 'goal.qmd');
  const marker = path.join(root, 'verifier-ready');
  await writeFile(targetFile, theorem('thm-main-stale', 'Keep current state.'));
  const proposal = path.join(root, 'stale.proposal');
  await writeFile(proposal, theorem('thm-main-stale', 'Keep current state.', 'Candidate proof.'));
  process.env.QMD_PROVER_VERIFIER = staleVerifier;
  process.env.QMD_PROVER_VERIFIER_READY = marker;
  const submission = submitProof(root, proposal, options);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { await readFile(marker); break; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
  }
  await writeFile(targetFile, theorem('thm-main-stale', 'Keep current state.', 'Concurrent canonical proof.'));
  await assert.rejects(submission, /Stale submission/);
  assert.match(await readFile(targetFile, 'utf8'), /Concurrent canonical proof/);
  delete process.env.QMD_PROVER_VERIFIER;
  delete process.env.QMD_PROVER_VERIFIER_READY;
});

test('dispatcher emits stable JSON and a structural-error exit code', async () => {
  const root = await project();
  await writeFile(path.join(root, 'goal.qmd'), theorem('thm-main-cli', 'CLI statement.'));
  const cli = path.join(here, '..', 'scripts', 'qmd-prover.mjs');
  const run = await new Promise((resolve, reject) => execFile(process.execPath, [cli, 'inspect-project'], {
    cwd: root, env: { ...process.env, QMD_PROVER_PANDOC: fakePandoc }
  }, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr })));
  assert.equal(JSON.parse(run.stdout).summary.goals[0].id, 'thm-main-cli');
  await writeFile(path.join(root, 'duplicate.qmd'), theorem('thm-main-cli', 'Duplicate.'));
  const failed = await new Promise((resolve) => execFile(process.execPath, [cli, 'inspect-project'], {
    cwd: root, env: { ...process.env, QMD_PROVER_PANDOC: fakePandoc }
  }, (error, stdout) => resolve({ error, stdout })));
  assert.equal(failed.error.code, 2);
  assert.equal(JSON.parse(failed.stdout).ok, false);
});
