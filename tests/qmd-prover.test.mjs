import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileProject, theoremBundle } from '../skills/qmd-prover/scripts/lib/compiler.mjs';
import { readJson } from '../skills/qmd-prover/scripts/lib/files.mjs';
import { analyzeDependencies, inspectFact, inspectPath, inspectProject } from '../skills/qmd-prover/scripts/lib/inspector.mjs';
import { renderProject } from '../skills/qmd-prover/scripts/lib/render.mjs';
import { checkStaleness } from '../skills/qmd-prover/scripts/lib/staleness.mjs';
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
  assert.equal(first.ok, false);
  assert.equal(first.complete, true);
  assert.equal(second.ok, false);
  assert.equal(firstManifest, secondManifest);
  assert.deepEqual(first.summary.goals.map((goal) => goal.id), ['thm-main-goal']);
  assert.deepEqual(first.graph.edges.map(({ from, to }) => ({ from, to })), [{ from: 'thm-main-goal', to: 'lem-base' }]);
  assert.deepEqual(first.manifest.results.find((item) => item.id === 'thm-main-goal').dependencies, ['lem-base']);
  assert.ok(first.diagnostics.some((item) => item.code === 'DEPENDENCY_STATUS_INSUFFICIENT' && item.severity === 'error'));
  assert.equal(first.graph.edges[0].checks.status, 'fail');
  assert.equal(theoremBundle(first, '@thm-main-goal').dependencies[0].id, 'lem-base');
});

test('source discovery honors configured exclusions and gitignore reinclusions deterministically', async () => {
  const root = await project();
  await Promise.all([mkdir(path.join(root, 'generated')), mkdir(path.join(root, 'ignored'))]);
  await writeFile(path.join(root, '.qmd-prover', 'config.yml'), 'project:\n  exclude: [generated]\nrender:\n  output-dir: rendered\n');
  await writeFile(path.join(root, '.gitignore'), 'ignored/\n!ignored/keep.qmd\n');
  await writeFile(path.join(root, 'visible.qmd'), result('lem-visible', 'Visible.'));
  await writeFile(path.join(root, 'generated', 'excluded.qmd'), result('lem-config-excluded', 'Excluded.'));
  await writeFile(path.join(root, 'ignored', 'excluded.qmd'), result('lem-git-excluded', 'Excluded.'));
  await writeFile(path.join(root, 'ignored', 'keep.qmd'), result('lem-git-reincluded', 'Reincluded.'));
  const compilation = await compileProject(root, options);
  assert.deepEqual(compilation.manifest.files.map((file) => file.path), ['ignored/keep.qmd', 'visible.qmd']);
  assert.deepEqual(compilation.manifest.results.map((item) => item.id), ['lem-git-reincluded', 'lem-visible']);
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
  assert.deepEqual((await analyzeDependencies(root, 'cycles', [], options)).cycles, [['lem-left', 'lem-right', 'lem-left']]);
  assert.deepEqual((await analyzeDependencies(root, 'frontier', ['@lem-left'], options)).frontier.map((item) => item.fact.id), ['lem-left', 'lem-right']);
});

test('compiler validates result names, semantic kinds, and main-goal classes', async () => {
  const root = await project();
  const wrongKind = result('lem-wrong', 'Shape.').replace('.lemma', '.proposition');
  const noName = result('thm-main-no-name', 'Missing caption.').replace(' name="thm-main-no-name"', '');
  const unsafeId = result('lem-unsafe/path', 'Unsafe identifier.');
  await writeFile(path.join(root, 'shape.qmd'), `${wrongKind}\n${noName}\n${unsafeId}`);
  const compilation = await compileProject(root, options);
  const codes = new Set(compilation.diagnostics.map((item) => item.code));
  assert.ok(codes.has('ID_KIND_MISMATCH'));
  assert.ok(codes.has('RESULT_NAME_MISSING'));
  assert.ok(codes.has('INVALID_SEMANTIC_ID'));
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

test('complete snapshot identities change with exact mathematical content', async () => {
  const root = await project();
  const file = path.join(root, 'fact.qmd');
  await writeFile(file, result('lem-snapshot-identity', 'First statement.'));
  const first = await compileProject(root, options);
  await writeFile(file, result('lem-snapshot-identity', 'Second statement.'));
  const second = await compileProject(root, options);
  assert.notEqual(first.graph.snapshot_id, second.graph.snapshot_id);
  assert.equal((await readJson(path.join(root, '.qmd-prover', 'graphs', 'latest.json'))).snapshot_id, second.graph.snapshot_id);
});

test('definitions declare construction dependencies and unresolved graph edges retain failed checks', async () => {
  const root = await project();
  await writeFile(path.join(root, 'definitions.qmd'), [
    result('def-base', 'A base object.'),
    result('def-derived', 'Construct the derived object from @def-base.'),
    result('lem-broken', 'A broken claim.', { proofText: 'Apply @lem-absent.' })
  ].join('\n'));
  const compilation = await compileProject(root, options);
  const derived = compilation.manifest.results.find((item) => item.id === 'def-derived');
  const brokenEdge = compilation.graph.edges.find((edge) => edge.from === 'lem-broken');
  assert.deepEqual(derived.dependencies, ['def-base']);
  assert.equal(brokenEdge.to, 'lem-absent');
  assert.equal(brokenEdge.checks.existence, 'fail');
  assert.equal(compilation.graph.nodes.find((node) => node.id === 'lem-absent').status, 'missing');
  assert.ok(compilation.diagnostics.some((item) => item.code === 'DEPENDENCY_UNKNOWN' && item.id === 'lem-broken'));
});

test('inspector supports fact, path, search, and lowest-frontier queries on a named snapshot', async () => {
  const root = await project();
  await mkdir(path.join(root, 'foundations'));
  await writeFile(path.join(root, 'foundations', 'base.qmd'), result('lem-frontier-base', 'The base obligation.', { title: 'Base frontier fact', exported: true }));
  await writeFile(path.join(root, 'goal.qmd'), document(
    [{ from: 'foundations/base.qmd', use: ['lem-frontier-base'] }],
    `${result('lem-frontier-middle', 'The middle claim.', { proofText: 'Use @lem-frontier-base.' })}\n${result('thm-main-frontier', 'The final claim.', { proofText: 'Use @lem-frontier-middle.' })}`
  ));
  const projectInspection = await inspectProject(root, options);
  assert.equal(projectInspection.ok, false);
  assert.equal(projectInspection.snapshot_published, true);
  const factInspection = await inspectFact(root, '@thm-main-frontier', options);
  assert.deepEqual(factInspection.graph.nodes.map((node) => node.id).sort(), ['lem-frontier-base', 'lem-frontier-middle', 'thm-main-frontier']);
  const pathInspection = await inspectPath(root, 'goal.qmd', options);
  assert.equal(pathInspection.graph.nodes.find((node) => node.id === 'lem-frontier-base').scope, 'external');
  const frontier = await analyzeDependencies(root, 'frontier', ['@thm-main-frontier'], options);
  assert.deepEqual(frontier.frontier.map((item) => item.fact.id), ['lem-frontier-base']);
  assert.deepEqual(frontier.frontier[0].path, ['thm-main-frontier', 'lem-frontier-middle', 'lem-frontier-base']);
  const dependencies = await analyzeDependencies(root, 'dependencies', ['@thm-main-frontier'], options);
  assert.deepEqual(dependencies.direct.map((item) => item.id), ['lem-frontier-middle']);
  assert.deepEqual(dependencies.transitive.map((item) => item.id).sort(), ['lem-frontier-base', 'lem-frontier-middle']);
  const reverse = await analyzeDependencies(root, 'reverse-dependencies', ['@lem-frontier-base'], options);
  assert.deepEqual(reverse.transitive.map((item) => item.id).sort(), ['lem-frontier-middle', 'thm-main-frontier']);
  assert.deepEqual((await analyzeDependencies(root, 'path', ['@thm-main-frontier', '@lem-frontier-base'], options)).path, ['thm-main-frontier', 'lem-frontier-middle', 'lem-frontier-base']);
  assert.deepEqual((await analyzeDependencies(root, 'cycles', [], options)).cycles, []);
  const search = await analyzeDependencies(root, 'search', ['base frontier'], { ...options, kind: 'lemma' });
  assert.deepEqual(search.matches.map((item) => item.id), ['lem-frontier-base']);
  assert.equal(search.snapshot_id, projectInspection.snapshot_id);
});

test('record-backed markers fail closed when their exact evidence is absent', async () => {
  const root = await project();
  await writeFile(path.join(root, 'unsupported.qmd'), result('lem-unsupported-marker', 'A claim.', { proofText: 'VERIFIED\n\nA purported proof.' }));
  const compilation = await compileProject(root, options);
  const fact = compilation.manifest.results.find((item) => item.id === 'lem-unsupported-marker');
  assert.equal(fact.status, 'candidate');
  assert.ok(compilation.diagnostics.some((item) => item.code === 'VERIFIED_RECORD_INVALID'));
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
  assert.match(merged, /:::\n\n::: \{\.proof of="thm-main-proof"\}\nVERIFIED\n\nBy reflexivity/);
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
  await writeFile(path.join(root, 'goal.qmd'), `${result('thm-main-existing', 'Existing goal.')}\n${result('lem-new-base', 'A reusable premise.', { exported: true })}`);
  const baseProposal = proposalPath(root, 'new-result-base.qmd');
  await writeFile(baseProposal, proof('lem-new-base', 'By direct calculation.'));
  assert.equal((await submitProof(root, baseProposal, options)).status, 'verified');
  const proposal = proposalPath(root, 'new-result.qmd');
  await writeFile(proposal, document(
    [{ from: 'goal.qmd', use: ['lem-new-base'] }],
    result('lem-new', 'A newly verified lemma.', { proofText: 'Apply @lem-new-base.', title: 'New lemma', exported: true })
  ));
  const accepted = await submitProof(root, proposal, { ...options, destination: 'lemmas.qmd' });
  assert.equal(accepted.status, 'verified');
  const promoted = await readFile(path.join(root, 'lemmas.qmd'), 'utf8');
  assert.match(promoted, /#lem-new/);
  assert.match(promoted, /\.proof of="lem-new"/);
  assert.equal((await compileProject(root, options)).manifest.results.find((item) => item.id === 'lem-new').status, 'verified');
  delete process.env.QMD_PROVER_VERIFIER;
});

test('staleness invalidates verified reverse dependencies and retains exact paths', async () => {
  const root = await project();
  process.env.QMD_PROVER_VERIFIER = verifier;
  const baseFile = path.join(root, 'base.qmd');
  await writeFile(baseFile, result('lem-stale-base', 'The stable premise.', { exported: true }));
  await writeFile(path.join(root, 'goal.qmd'), document(
    [{ from: 'base.qmd', use: ['lem-stale-base'] }],
    result('thm-main-stale-chain', 'The dependent conclusion.')
  ));
  const baseProposal = proposalPath(root, 'base-proof.qmd');
  await writeFile(baseProposal, proof('lem-stale-base', 'A proof of the premise.'));
  assert.equal((await submitProof(root, baseProposal, options)).status, 'verified');
  const targetProposal = proposalPath(root, 'target-proof.qmd');
  await writeFile(targetProposal, proof('thm-main-stale-chain', 'Apply @lem-stale-base.'));
  assert.equal((await submitProof(root, targetProposal, options)).status, 'verified');
  assert.deepEqual((await compileProject(root, options)).manifest.results.map((item) => item.status), ['verified', 'verified']);
  assert.deepEqual((await analyzeDependencies(root, 'impact', ['@lem-stale-base'], options)).affected.map((item) => item.id), ['thm-main-stale-chain']);

  await writeFile(baseFile, result('lem-stale-base', 'The stable premise.', { proofText: 'A changed proof.', exported: true }));
  const stale = await checkStaleness(root, options);
  assert.deepEqual(stale.changed.map((item) => item.id), ['lem-stale-base']);
  assert.deepEqual(stale.invalidated.find((item) => item.id === 'thm-main-stale-chain').path, ['lem-stale-base', 'thm-main-stale-chain']);
  const index = await readJson(path.join(root, '.qmd-prover', 'verification', 'index.json'));
  assert.equal(index['lem-stale-base'].status, 'stale');
  assert.equal(index['thm-main-stale-chain'].status, 'stale');
  assert.doesNotMatch(await readFile(path.join(root, 'goal.qmd'), 'utf8'), /^VERIFIED$/m);
  assert.deepEqual((await compileProject(root, options)).manifest.results.map((item) => item.status), ['candidate', 'candidate']);
  delete process.env.QMD_PROVER_VERIFIER;
});

test('staleness fails closed when the configured checker contract changes', async () => {
  const root = await project();
  process.env.QMD_PROVER_VERIFIER = verifier;
  await writeFile(path.join(root, 'fact.qmd'), result('lem-checker-contract', 'A checked fact.'));
  const proposal = proposalPath(root, 'checker-contract.qmd');
  await writeFile(proposal, proof('lem-checker-contract', 'A direct proof.'));
  assert.equal((await submitProof(root, proposal, options)).status, 'verified');
  await writeFile(path.join(root, '.qmd-prover', 'config.yml'), 'verification:\n  backend: none\n  model: changed-model\n');
  const stale = await checkStaleness(root, options);
  assert.deepEqual(stale.changed[0].reasons, ['checker-contract-changed']);
  assert.equal((await compileProject(root, options)).manifest.results[0].status, 'candidate');
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

test('dispatcher preserves JSON commands and adds workspace operations', async () => {
  const root = await project();
  await writeFile(path.join(root, 'goal.qmd'), result('thm-main-cli', 'CLI statement.'));
  const cli = path.join(here, '..', 'skills', 'qmd-prover', 'scripts', 'qmd-prover.mjs');
  const run = await new Promise((resolve, reject) => execFile(process.execPath, [cli, 'inspect-project'], {
    cwd: root, env: { ...process.env, QMD_PROVER_PANDOC: fakePandoc }
  }, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr })));
  const jsonInspection = JSON.parse(run.stdout);
  assert.equal(jsonInspection.summary.goals[0].id, 'thm-main-cli');
  const printed = await new Promise((resolve, reject) => execFile(process.execPath, [cli, 'inspect-project', '--print'], {
    cwd: root, env: { ...process.env, QMD_PROVER_PANDOC: fakePandoc }
  }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  assert.match(printed, new RegExp(`snapshot: ${jsonInspection.snapshot_id}`));
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
  assert.match(contract, /<!-- qmd-prover-contract:start version=3 -->/);
  assert.match(contract, /<!-- qmd-prover-contract:end -->/);
  assert.match(contract, /name="Uniform index theorem"/);
  assert.match(contract, /\.proof of="thm-main-uniform-index"/);
  assert.match(contract, /qmd-prover:\n  imports:/);
  assert.doesNotMatch(contract, /### Uses/);
  assert.match(contract, /Project-specific additions/);
});
