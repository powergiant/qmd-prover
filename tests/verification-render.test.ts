import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { renderProject } from '../skills/qmd-prover/src/lib/application/render.js';
import { readJson } from '../skills/qmd-prover/src/lib/infrastructure/files.js';
import { analyzeDependencies, inspectFact, inspectProject } from '../skills/qmd-prover/src/lib/inspection/operations.js';
import { compileProject } from '../skills/qmd-prover/src/lib/semantic/compiler.js';
import { checkStaleness } from '../skills/qmd-prover/src/lib/verification/staleness.js';
import { revokeVerification, submitProof } from '../skills/qmd-prover/src/lib/verification/submissions.js';
import { document, options, project, proposalPath, proof, result, staleVerifier, verifier, malformedVerifier } from './support.js';
import { must } from './support.js';
import { asRecord } from '../skills/qmd-prover/src/lib/shared/core.js';

test('inspection verifies ready facts in dependency order, caches exact checks, and marks definitions at block end', async () => {
  const root = await project();
  const countFile = path.join(root, 'verifier-calls.txt');
  process.env.QMD_PROVER_VERIFIER = verifier;
  process.env.QMD_PROVER_VERIFIER_COUNT = countFile;
  try {
    await writeFile(path.join(root, 'auto.qmd'), [
      result('def-auto-object', 'Define the auto object directly.'),
      result('lem-auto-result', 'The auto object exists.', { proofText: 'Apply @def-auto-object.' })
    ].join('\n'));
    const before = await compileProject(root, options);
    const constructionHash = must(before.manifest.results.find((item) => item.id === 'def-auto-object')).statement_hash;

    const first = await inspectProject(root, options);
    assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
    assert.equal(first.verification.verifier_calls, 2);
    assert.deepEqual(first.facts.map((fact) => [fact.id, fact.ai.status]), [
      ['def-auto-object', 'pass'],
      ['lem-auto-result', 'pass']
    ]);
    assert.deepEqual((await readFile(countFile, 'utf8')).trim().split('\n'), ['def-auto-object', 'lem-auto-result']);
    const source = await readFile(path.join(root, 'auto.qmd'), 'utf8');
    assert.match(source, /Define the auto object directly\.\n\nVERIFIED\n:::/);
    assert.match(source, /\.proof of="lem-auto-result"\}\nVERIFIED\n\nApply @def-auto-object\./);
    const after = await compileProject(root, options);
    assert.equal(must(after.manifest.results.find((item) => item.id === 'def-auto-object')).statement_hash, constructionHash);
    assert.equal(must(after.graph.edges[0]?.checks).ai_sufficiency, 'pass');

    const second = await inspectProject(root, options);
    assert.equal(second.ok, true);
    assert.equal(second.verification.verifier_calls, 0);
    assert.equal(second.verification.cache_hits, 2);
    assert.deepEqual((await readFile(countFile, 'utf8')).trim().split('\n'), ['def-auto-object', 'lem-auto-result']);
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
    delete process.env.QMD_PROVER_VERIFIER_COUNT;
  }
});

test('inspection removes stale VERIFIED before failing closed on an unavailable verifier', async () => {
  const root = await project();
  const sourceFile = path.join(root, 'stale-inspection.qmd');
  process.env.QMD_PROVER_VERIFIER = verifier;
  await writeFile(sourceFile, result('lem-inspection-stale', 'A stable statement.', { proofText: 'The original proof.' }));
  assert.equal((await inspectFact(root, '@lem-inspection-stale', options)).ok, true);
  const verifiedSource = await readFile(sourceFile, 'utf8');
  assert.match(verifiedSource, /VERIFIED/);
  await writeFile(sourceFile, verifiedSource.replace('The original proof.', 'A changed proof.'));
  delete process.env.QMD_PROVER_VERIFIER;

  const failed = await inspectFact(root, '@lem-inspection-stale', options);
  assert.equal(failed.ok, false);
  assert.equal(failed.check.ai.status, 'error');
  assert.equal(failed.check.ai.code, 'unconfigured');
  assert.match(must(failed.check.ai.remediation), /rerun inspection/);
  assert.deepEqual(failed.staleness.changed.map((item) => item.id), ['lem-inspection-stale']);
  assert.doesNotMatch(await readFile(sourceFile, 'utf8'), /VERIFIED/);
  assert.equal(must((await compileProject(root, options)).manifest.results[0]).status, 'stale');
  const staleIndex = await readJson<Record<string, { cache: string }>>(path.join(root, '.qmd-prover', 'verification', 'index.json'));
  assert.equal((await readJson<{ stale: boolean }>(path.join(root, must(staleIndex['lem-inspection-stale']).cache))).stale, true);

  await writeFile(sourceFile, (await readFile(sourceFile, 'utf8')).replace('A changed proof.', 'The original proof.'));
  const restored = await inspectFact(root, '@lem-inspection-stale', options);
  assert.equal(restored.ok, true);
  assert.equal(restored.verification.verifier_calls, 0);
  assert.equal(restored.verification.cache_hits, 1);
  assert.match(await readFile(sourceFile, 'utf8'), /VERIFIED/);
});

test('inspection caches rejected mathematical verdicts and malformed verifier output fails closed', async () => {
  const root = await project();
  const countFile = path.join(root, 'rejected-calls.txt');
  process.env.QMD_PROVER_VERIFIER = verifier;
  process.env.QMD_PROVER_VERIFIER_COUNT = countFile;
  await writeFile(path.join(root, 'rejected.qmd'), result('lem-auto-rejected', 'A rejected claim.', { proofText: 'GAP in the argument.' }));
  const rejected = await inspectFact(root, '@lem-auto-rejected', options);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.check.ai.status, 'fail');
  assert.deepEqual(must(rejected.check.ai.report).gaps, ['justify the missing step']);
  const repeated = await inspectFact(root, '@lem-auto-rejected', options);
  assert.equal(repeated.verification.verifier_calls, 0);
  assert.equal(repeated.verification.cache_hits, 1);
  assert.equal((await readFile(countFile, 'utf8')).trim().split('\n').length, 1);

  await writeFile(path.join(root, '.qmd-prover', '.external.qmd'), 'Only explicitly declared external facts may be used.\n');
  const changedBasis = await inspectFact(root, '@lem-auto-rejected', options);
  assert.equal(changedBasis.check.ai.status, 'fail');
  assert.equal(changedBasis.verification.verifier_calls, 1);
  assert.equal((await readFile(countFile, 'utf8')).trim().split('\n').length, 2);

  delete process.env.QMD_PROVER_VERIFIER_COUNT;
  process.env.QMD_PROVER_VERIFIER = malformedVerifier;
  await writeFile(path.join(root, 'malformed.qmd'), result('lem-malformed-check', 'A checkable claim.', { proofText: 'A candidate proof.' }));
  const malformed = await inspectFact(root, '@lem-malformed-check', options);
  assert.equal(malformed.ok, false);
  assert.equal(malformed.check.ai.status, 'error');
  assert.equal(malformed.check.ai.code, 'malformed');
  assert.equal(must(malformed.check.ai.details).stdout_excerpt, '{not-json');
  assert.doesNotMatch(await readFile(path.join(root, 'malformed.qmd'), 'utf8'), /VERIFIED/);
  delete process.env.QMD_PROVER_VERIFIER;
});

test('record-backed markers fail closed when their exact evidence is absent', async () => {
  const root = await project();
  await writeFile(path.join(root, 'unsupported.qmd'), result('lem-unsupported-marker', 'A claim.', { proofText: 'VERIFIED\n\nA purported proof.' }));
  const compilation = await compileProject(root, options);
  const fact = compilation.manifest.results.find((item) => item.id === 'lem-unsupported-marker');
  assert.equal(must(fact).status, 'candidate');
  assert.ok(compilation.diagnostics.some((item) => item.code === 'VERIFIED_RECORD_INVALID'));
  const stale = await checkStaleness(root, options);
  assert.deepEqual(must(stale.changed[0]).reasons, ['verified-marker-without-current-record']);
  assert.doesNotMatch(await readFile(path.join(root, 'unsupported.qmd'), 'utf8'), /VERIFIED/);
});

test('rejected linked-proof proposals preserve canonical QMD and accepted repair inserts only proof', async () => {
  const root = await project();
  process.env.QMD_PROVER_VERIFIER = verifier;
  await writeFile(path.join(root, '.qmd-prover', '.external.qmd'), 'Finite group theory may be used.\n');
  const canonicalFile = path.join(root, 'goal.qmd');
  const initial = result('thm-main-proof', 'One equals one.', { title: 'Reflexivity' });
  await writeFile(canonicalFile, initial);
  const badProposal = proposalPath(root, 'bad.qmd');
  await writeFile(badProposal, proof('thm-main-proof', 'INVALID reasoning.'));
  const rejected = await submitProof(root, badProposal, options);
  assert.equal(rejected.status, 'rejected');
  assert.equal(await readFile(canonicalFile, 'utf8'), initial);
  assert.equal(must((await compileProject(root, options)).manifest.results[0]).status, 'open');
  const goodProposal = proposalPath(root, 'good.qmd');
  await writeFile(goodProposal, proof('thm-main-proof', 'By reflexivity, one equals one.'));
  const accepted = await submitProof(root, goodProposal, options);
  assert.equal(accepted.status, 'verified');
  assert.match(must(accepted.report).summary, /external:declared:Finite group theory may be used/);
  const merged = await readFile(canonicalFile, 'utf8');
  assert.match(merged, /:::\n\n::: \{\.proof of="thm-main-proof"\}\nVERIFIED\n\nBy reflexivity/);
  assert.equal(must((await compileProject(root, options)).manifest.results[0]).status, 'verified');
  await assert.rejects(() => submitProof(root, goodProposal, options), /already verified/);
  assert.equal((await revokeVerification(root, '@thm-main-proof', 'New concern', options)).status, 'revoked');
  delete process.env.QMD_PROVER_VERIFIER;
});

test('a correct verdict with a gap is rejected and proposals cannot redefine canonical results', async () => {
  const root = await project();
  const countFile = path.join(root, 'submission-verifier-calls.txt');
  process.env.QMD_PROVER_VERIFIER = verifier;
  process.env.QMD_PROVER_VERIFIER_COUNT = countFile;
  const target = path.join(root, 'goal.qmd');
  const original = result('thm-main-gap', 'A complete proof is required.');
  await writeFile(target, original);
  const gap = proposalPath(root, 'gap.qmd');
  await writeFile(gap, proof('thm-main-gap', 'GAP in justification.'));
  const rejected = await submitProof(root, gap, options);
  assert.equal(rejected.status, 'rejected');
  assert.deepEqual(must(rejected.report).gaps, ['justify the missing step']);
  assert.equal(await readFile(target, 'utf8'), original);
  assert.equal((await submitProof(root, gap, options)).status, 'rejected');
  assert.deepEqual((await readFile(countFile, 'utf8')).trim().split('\n'), ['thm-main-gap']);
  const redefinition = proposalPath(root, 'redefinition.qmd');
  await writeFile(redefinition, result('thm-main-gap', 'Changed statement.', { proofText: 'A proof.' }));
  await assert.rejects(() => submitProof(root, redefinition, options), /must not redefine existing canonical result/);
  delete process.env.QMD_PROVER_VERIFIER_COUNT;
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
  assert.equal(must((await compileProject(root, options)).manifest.results.find((item) => item.id === 'lem-new')).status, 'verified');
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
  assert.deepEqual(must((await analyzeDependencies(root, 'impact', ['@lem-stale-base'], options)).affected).map((item) => item.id), ['thm-main-stale-chain']);

  await writeFile(baseFile, result('lem-stale-base', 'The stable premise.', { proofText: 'A changed proof.', exported: true }));
  const stale = await checkStaleness(root, options);
  assert.deepEqual(stale.changed.map((item) => item.id), ['lem-stale-base']);
  assert.deepEqual(must(stale.invalidated.find((item) => item.id === 'thm-main-stale-chain')).path, ['lem-stale-base', 'thm-main-stale-chain']);
  const index = await readJson<Record<string, { status: string }>>(path.join(root, '.qmd-prover', 'verification', 'index.json'));
  assert.equal(must(index['lem-stale-base']).status, 'stale');
  assert.equal(must(index['thm-main-stale-chain']).status, 'stale');
  assert.doesNotMatch(await readFile(path.join(root, 'goal.qmd'), 'utf8'), /^VERIFIED$/m);
  assert.deepEqual((await compileProject(root, options)).manifest.results.map((item) => item.status), ['stale', 'stale']);
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
  assert.deepEqual(must(stale.changed[0]).reasons, ['checker-contract-changed']);
  assert.equal(must((await compileProject(root, options)).manifest.results[0]).status, 'stale');
  delete process.env.QMD_PROVER_VERIFIER;
});

test('staleness invalidates verified results when the external basis changes', async () => {
  const root = await project();
  process.env.QMD_PROVER_VERIFIER = verifier;
  const policyFile = path.join(root, '.qmd-prover', '.external.qmd');
  const targetFile = path.join(root, 'external-policy-goal.qmd');
  await writeFile(policyFile, 'Standard arithmetic may be used.\n');
  await writeFile(targetFile, result('thm-main-external-policy', 'A policy-sensitive claim.'));
  const proposal = proposalPath(root, 'external-policy.qmd');
  await writeFile(proposal, proof('thm-main-external-policy', 'Use the allowed external basis.'));
  assert.equal((await submitProof(root, proposal, options)).status, 'verified');
  await writeFile(policyFile, '  \n');
  const stale = await checkStaleness(root, options);
  const change = must(stale.changed[0]);
  assert.equal(change.id, 'thm-main-external-policy');
  assert.deepEqual(change.reasons, ['external-basis-changed']);
  assert.notEqual(asRecord(change.previous).external_basis_hash, asRecord(change.current).external_basis_hash);
  assert.doesNotMatch(await readFile(targetFile, 'utf8'), /VERIFIED/);
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
  assert.equal((await readJson<{ summary: { results: number } }>(path.join(root, '.qmd-prover', 'reports', 'status.json'))).summary.results, 1);
  await assert.rejects(() => stat(path.join(root, '.qmd-prover', 'site')), /ENOENT/);
});
