import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileProject, theoremBundle } from '../skills/qmd-prover/scripts/lib/compiler.mjs';
import { readJson } from '../skills/qmd-prover/scripts/lib/files.mjs';
import { renderProject } from '../skills/qmd-prover/scripts/lib/render.mjs';
import { submitProof, revokeVerification } from '../skills/qmd-prover/scripts/lib/verification.mjs';
import { initializeWorkspace, inspectWorkspace } from '../skills/qmd-prover/scripts/lib/workspace.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const fakePandoc = path.join(here, 'fixtures', 'fake-pandoc.mjs');
const verifier = path.join(here, 'fixtures', 'mock-verifier.mjs');
const staleVerifier = path.join(here, 'fixtures', 'stale-verifier.mjs');
const options = { pandoc: fakePandoc };
process.env.PATH = `${path.dirname(process.execPath)}:${process.env.PATH}`;

async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qmd-prover-'));
  await mkdir(path.join(root, '.qmd-prover', 'workspaces', 'test', 'proposals'), { recursive: true });
  await Promise.all([chmod(fakePandoc, 0o755), chmod(verifier, 0o755), chmod(staleVerifier, 0o755)]);
  return root;
}

function proposalPath(root, name) {
  return path.join(root, '.qmd-prover', 'workspaces', 'test', 'proposals', name);
}

function proof(id, text) {
  return `::: {.proof of="${id}"}\n${text}\n:::\n`;
}

function result(id, statement, { proofText, title = id, exported = false, extra = '' } = {}) {
  const kind = id.startsWith('lem-') ? 'lemma' : id.startsWith('def-') ? 'definition' : id.startsWith('prp-') ? 'proposition' : id.startsWith('cor-') ? 'corollary' : 'theorem';
  const block = `::: {#${id} .${kind}${id.startsWith('thm-main-') ? ' .goal' : ''} name="${title}"${exported ? ` export="${id}"` : ''}${extra}}\n${statement}\n:::\n`;
  return proofText == null ? block : `${block}\n${proof(id, proofText)}`;
}

function document(imports, body) {
  if (!imports.length) return body;
  return `---\nqmd-prover:\n  imports:\n${imports.map((entry) => `    - from: ${entry.from}\n      use:\n${entry.use.map((id) => `        - ${id}`).join('\n')}`).join('\n')}\n---\n\n${body}`;
}

test('compiler reads metadata imports, linked proofs, and deterministic semantic indexes', async () => {
  const root = await project();
  await mkdir(path.join(root, 'foundations'));
  await writeFile(path.join(root, 'foundations', 'base.qmd'), result('lem-base', 'For every x, x equals x.', { proofText: 'This follows by reflexivity.', exported: true }));
  await writeFile(path.join(root, 'goal.qmd'), document(
    [{ from: 'foundations/base.qmd', use: ['lem-base'] }],
    `Unrestricted prose.\n\n${result('thm-main-goal', 'For every x, x equals x.', { proofText: 'Apply @lem-base.' })}`
  ));
  const first = await compileProject(root, options);
  const firstManifest = await readFile(path.join(root, '.qmd-prover', 'manifest.json'), 'utf8');
  const second = await compileProject(root, options);
  const secondManifest = await readFile(path.join(root, '.qmd-prover', 'manifest.json'), 'utf8');
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  assert.equal(second.ok, true);
  assert.equal(firstManifest, secondManifest);
  assert.deepEqual(first.summary.goals.map((goal) => goal.id), ['thm-main-goal']);
  assert.deepEqual(first.graph.edges, [{ from: 'thm-main-goal', to: 'lem-base' }]);
  assert.deepEqual(first.manifest.results.find((item) => item.id === 'thm-main-goal').dependencies, ['lem-base']);
  assert.ok(first.diagnostics.some((item) => item.code === 'DEPENDENCY_STATUS_INSUFFICIENT' && item.severity === 'warning'));
  assert.equal(theoremBundle(first, '@thm-main-goal').dependencies[0].id, 'lem-base');
});

test('compiler diagnoses metadata imports, duplicates, proof shape, and cycles', async () => {
  const root = await project();
  await writeFile(path.join(root, 'a.qmd'), document(
    [{ from: 'b.qmd', use: ['lem-b'] }],
    result('lem-a', 'A.', { proofText: 'Use @lem-b.' })
  ));
  await writeFile(path.join(root, 'b.qmd'), document(
    [{ from: 'a.qmd', use: ['lem-a'] }],
    `${result('lem-b', 'B.', { exported: true })}${result('lem-a', 'Duplicate.')}`
  ));
  await writeFile(path.join(root, 'orphan.qmd'), proof('lem-missing', 'No target exists.'));
  const compilation = await compileProject(root, options);
  const codes = new Set(compilation.diagnostics.map((item) => item.code));
  assert.equal(compilation.ok, false);
  for (const code of ['DUPLICATE_ID', 'IMPORT_CYCLE', 'IMPORT_NOT_EXPORTED', 'PROOF_TARGET_UNKNOWN']) assert.ok(codes.has(code), code);
});

test('compiler rejects semantic dependency cycles and legacy section layout', async () => {
  const root = await project();
  await writeFile(path.join(root, 'cycle.qmd'), `${result('lem-left', 'Left.', { proofText: 'Apply @lem-right.' })}\n${result('lem-right', 'Right.', { proofText: 'Apply @lem-left.' })}`);
  await writeFile(path.join(root, 'legacy.qmd'), `::: {#lem-legacy .lemma name="Legacy"}\n### Statement\nLegacy.\n### Proof\nOld.\n:::\n`);
  const compilation = await compileProject(root, options);
  const codes = new Set(compilation.diagnostics.map((item) => item.code));
  assert.ok(codes.has('DEPENDENCY_CYCLE'));
  assert.ok(codes.has('LEGACY_RESULT_SECTIONS'));
});

test('compiler validates result names, semantic kinds, and main-goal classes', async () => {
  const root = await project();
  const wrongKind = result('lem-wrong', 'Shape.').replace('.lemma', '.proposition');
  const noName = result('thm-main-no-name', 'Missing caption.').replace(' name="thm-main-no-name"', '');
  await writeFile(path.join(root, 'shape.qmd'), `${wrongKind}\n${noName}`);
  const compilation = await compileProject(root, options);
  const codes = new Set(compilation.diagnostics.map((item) => item.code));
  assert.ok(codes.has('ID_KIND_MISMATCH'));
  assert.ok(codes.has('RESULT_NAME_MISSING'));
});

test('main statement and name baselines are immutable', async () => {
  const root = await project();
  const file = path.join(root, 'goal.qmd');
  await writeFile(file, result('thm-main-fixed', 'Original statement.', { title: 'Fixed theorem' }));
  assert.equal((await compileProject(root, options)).ok, true);
  await writeFile(file, result('thm-main-fixed', 'Changed statement.', { title: 'Changed theorem' }));
  const changed = await compileProject(root, options);
  const codes = new Set(changed.diagnostics.map((item) => item.code));
  assert.ok(codes.has('MAIN_STATEMENT_MUTATED'));
  assert.ok(codes.has('MAIN_TITLE_MUTATED'));
});

test('rejected linked-proof proposals preserve canonical QMD and accepted repair inserts only proof', async () => {
  const root = await project();
  process.env.QMD_PROVER_VERIFIER = verifier;
  const canonicalFile = path.join(root, 'goal.qmd');
  const initial = result('thm-main-proof', 'One equals one.', { title: 'Reflexivity' });
  await writeFile(canonicalFile, initial);
  const badProposal = proposalPath(root, 'bad.qmd');
  await writeFile(badProposal, proof('thm-main-proof', 'INVALID reasoning.'));
  const rejected = await submitProof(root, badProposal, options);
  assert.equal(rejected.status, 'rejected');
  assert.equal(await readFile(canonicalFile, 'utf8'), initial);
  assert.equal((await compileProject(root, options)).manifest.results[0].status, 'rejected');
  const goodProposal = proposalPath(root, 'good.qmd');
  await writeFile(goodProposal, proof('thm-main-proof', 'By reflexivity, one equals one.'));
  const accepted = await submitProof(root, goodProposal, options);
  assert.equal(accepted.status, 'verified');
  const merged = await readFile(canonicalFile, 'utf8');
  assert.match(merged, /:::\n\n::: \{\.proof of="thm-main-proof"\}\nBy reflexivity/);
  assert.equal((await compileProject(root, options)).manifest.results[0].status, 'verified');
  await assert.rejects(() => submitProof(root, goodProposal, options), /already verified/);
  assert.equal((await revokeVerification(root, '@thm-main-proof', 'New concern', options)).status, 'revoked');
  delete process.env.QMD_PROVER_VERIFIER;
});

test('a correct verdict with a gap is rejected and proposals cannot redefine canonical results', async () => {
  const root = await project();
  process.env.QMD_PROVER_VERIFIER = verifier;
  const target = path.join(root, 'goal.qmd');
  const original = result('thm-main-gap', 'A complete proof is required.');
  await writeFile(target, original);
  const gap = proposalPath(root, 'gap.qmd');
  await writeFile(gap, proof('thm-main-gap', 'GAP in justification.'));
  const rejected = await submitProof(root, gap, options);
  assert.equal(rejected.status, 'rejected');
  assert.deepEqual(rejected.report.gaps, ['justify the missing step']);
  assert.equal(await readFile(target, 'utf8'), original);
  const redefinition = proposalPath(root, 'redefinition.qmd');
  await writeFile(redefinition, result('thm-main-gap', 'Changed statement.', { proofText: 'A proof.' }));
  await assert.rejects(() => submitProof(root, redefinition, options), /must not redefine existing canonical result/);
  delete process.env.QMD_PROVER_VERIFIER;
});

test('accepted new-result proposals are promoted atomically to an explicit canonical destination', async () => {
  const root = await project();
  process.env.QMD_PROVER_VERIFIER = verifier;
  await writeFile(path.join(root, 'goal.qmd'), result('thm-main-existing', 'Existing goal.'));
  const proposal = proposalPath(root, 'new-result.qmd');
  await writeFile(proposal, result('lem-new', 'A newly verified lemma.', { proofText: 'By direct calculation.', title: 'New lemma', exported: true }));
  const accepted = await submitProof(root, proposal, { ...options, destination: 'lemmas.qmd' });
  assert.equal(accepted.status, 'verified');
  const promoted = await readFile(path.join(root, 'lemmas.qmd'), 'utf8');
  assert.match(promoted, /#lem-new/);
  assert.match(promoted, /\.proof of="lem-new"/);
  assert.equal((await compileProject(root, options)).manifest.results.find((item) => item.id === 'lem-new').status, 'verified');
  delete process.env.QMD_PROVER_VERIFIER;
});

test('render prepares Quarto-compatible status QMD and an SVG linked to canonical sources', async () => {
  const root = await project();
  await writeFile(path.join(root, 'goal.qmd'), result('thm-main-render', 'If x < y, then x < y.', { title: 'Render < safely' }));
  const rendered = await renderProject(root, options);
  assert.equal(rendered.status, 'prepared');
  assert.equal(rendered.render_command, 'quarto render');
  const statusQmd = await readFile(path.join(root, '.qmd-prover', 'generated', 'proof-status.qmd'), 'utf8');
  const graph = await readFile(path.join(root, '.qmd-prover', 'generated', 'dependencies.svg'), 'utf8');
  assert.match(statusQmd, /\| @thm-main-render \| open \|/);
  assert.match(graph, /goal\.qmd#thm-main-render/);
  assert.match(graph, /Render &lt; safely/);
  assert.equal((await readJson(path.join(root, '.qmd-prover', 'reports', 'status.json'))).summary.results, 1);
  await assert.rejects(() => stat(path.join(root, '.qmd-prover', 'site')), /ENOENT/);
});

test('goal workspaces preserve a protected target snapshot and report staleness', async () => {
  const root = await project();
  const canonical = path.join(root, 'goal.qmd');
  await writeFile(canonical, result('thm-main-work', 'Do the work.', { title: 'Workspace theorem' }));
  const created = await initializeWorkspace(root, '@thm-main-work', options);
  assert.equal(created.status, 'created');
  const workspace = path.join(root, created.workspace);
  assert.match(await readFile(path.join(workspace, 'target.qmd'), 'utf8'), /#thm-main-work/);
  await mkdir(path.join(workspace, 'local-theory'));
  await writeFile(path.join(workspace, 'local-theory', 'lemma.qmd'), result('lem-work', 'A working lemma.', { proofText: 'A workspace argument.' }));
  await writeFile(path.join(workspace, 'main-attempt.qmd'), proof('thm-main-work', 'Use @lem-work.'));
  const inspected = await inspectWorkspace(root, '@thm-main-work', options);
  assert.equal(inspected.stale, false);
  assert.ok(inspected.manifest.results.every((item) => item.origin === 'workspace'));
  assert.equal(inspected.manifest.results.find((item) => item.id === 'lem-work').status, 'workspace-candidate');
  assert.equal(inspected.manifest.results.find((item) => item.id === 'thm-main-work').status, 'workspace-candidate');
  assert.ok(inspected.graph.edges.some((edge) => edge.from === 'thm-main-work' && edge.to === 'lem-work'));
  await writeFile(canonical, result('thm-main-work', 'Do the work.', { title: 'Workspace theorem', proofText: 'A concurrent proof.' }));
  assert.equal((await inspectWorkspace(root, '@thm-main-work', options)).stale, true);
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

test('dispatcher preserves JSON commands and adds workspace operations', async () => {
  const root = await project();
  await writeFile(path.join(root, 'goal.qmd'), result('thm-main-cli', 'CLI statement.'));
  const cli = path.join(here, '..', 'skills', 'qmd-prover', 'scripts', 'qmd-prover.mjs');
  const run = await new Promise((resolve, reject) => execFile(process.execPath, [cli, 'inspect-project'], {
    cwd: root, env: { ...process.env, QMD_PROVER_PANDOC: fakePandoc }
  }, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr })));
  assert.equal(JSON.parse(run.stdout).summary.goals[0].id, 'thm-main-cli');
  const workspace = await new Promise((resolve, reject) => execFile(process.execPath, [cli, 'workspace', 'init', '@thm-main-cli'], {
    cwd: root, env: { ...process.env, QMD_PROVER_PANDOC: fakePandoc }
  }, (error, stdout) => error ? reject(error) : resolve(JSON.parse(stdout))));
  assert.equal(workspace.status, 'created');
  await writeFile(path.join(root, 'duplicate.qmd'), result('thm-main-cli', 'Duplicate.'));
  const failed = await new Promise((resolve) => execFile(process.execPath, [cli, 'inspect-project'], {
    cwd: root, env: { ...process.env, QMD_PROVER_PANDOC: fakePandoc }
  }, (error, stdout) => resolve({ error, stdout })));
  assert.equal(failed.error.code, 2);
  assert.equal(JSON.parse(failed.stdout).ok, false);
});

test('skill requires a once-per-context versioned project contract preflight', async () => {
  const skillRoot = path.join(here, '..', 'skills', 'qmd-prover');
  const [skill, contract] = await Promise.all([
    readFile(path.join(skillRoot, 'SKILL.md'), 'utf8'),
    readFile(path.join(skillRoot, 'references', 'AGENTS.md'), 'utf8')
  ]);
  assert.match(skill, /current agent in the same project context/);
  assert.match(skill, /Do not reread the files before every QMD read/);
  assert.match(skill, /Every independent worker must perform this preflight/);
  assert.match(skill, /Never create, replace, or synchronize `AGENTS\.md` without user approval/);
  assert.match(contract, /<!-- qmd-prover-contract:start version=2 -->/);
  assert.match(contract, /<!-- qmd-prover-contract:end -->/);
  assert.match(contract, /name="Uniform index theorem"/);
  assert.match(contract, /\.proof of="thm-main-uniform-index"/);
  assert.match(contract, /qmd-prover:\n  imports:/);
  assert.doesNotMatch(contract, /### Uses/);
  assert.match(contract, /Project-specific additions/);
});
