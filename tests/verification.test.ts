import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { readJson } from '../skills/qmd-prover/src/lib/infrastructure/files.js';
import { analyzeDependencies, inspectFact, inspectProject } from '../skills/qmd-prover/src/lib/inspection/operations.js';
import { printReport } from '../skills/qmd-prover/src/lib/inspection/report.js';
import { checkStaleness } from '../skills/qmd-prover/src/lib/verification/staleness.js';
import { buildVerifierPacket, checkerContract, verifierCommand } from '../skills/qmd-prover/src/lib/verification/protocol.js';
import { document, must, options, project, proof, result, verifier } from './support.js';

test('facts in any project folder join one unified graph and protected statements stay locked', async () => {
  const root = await project();
  const userGoal = path.join(root, 'goal.qmd');
  await writeFile(userGoal, result('thm-main-work', 'Do the work.', { title: 'Unified theorem' }));
  await mkdir(path.join(root, 'workspace', 'local-theory'), { recursive: true });
  await writeFile(path.join(root, 'workspace', 'local-theory', 'lemma.qmd'), result('lem-work', 'A working lemma.', { proofText: 'An ordinary argument.', exported: true }));
  await writeFile(path.join(root, 'workspace', 'main-attempt.qmd'), document(
    [{ from: 'local-theory/lemma.qmd', use: ['lem-work'] }],
    proof('thm-main-work', 'Use @lem-work.')
  ));
  const inspected = await inspectProject(root, options);
  assert.equal(inspected.ok, true, JSON.stringify(inspected.diagnostics));
  assert.deepEqual(inspected.graph.nodes.map((node) => ({ id: node.id, origin: node.origin })).sort((a, b) => a.id.localeCompare(b.id)), [
    { id: 'lem-work', origin: 'fact' },
    { id: 'thm-main-work', origin: 'main-goal' }
  ]);
  assert.equal(inspected.verification.available, false);
  assert.ok(inspected.facts.every((fact) => fact.mechanical.status === 'pass'));
  assert.ok(inspected.facts.every((fact) => fact.local_verification.status === 'not-run'));
  assert.ok(inspected.facts.every((fact) => fact.global_verification.status === 'unverified'));
  assert.ok(inspected.graph.edges.some((edge) => edge.from === 'thm-main-work' && edge.to === 'lem-work'));
  await writeFile(userGoal, result('thm-main-work', 'Changed protected statement.', { title: 'Unified theorem' }));
  const mutated = await inspectProject(root, options);
  assert.equal(mutated.ok, false);
  assert.ok(mutated.diagnostics.some((item) => item.code === 'MAIN_STATEMENT_MUTATED' && item.id === 'thm-main-work'));
});

test('project inspection verifies a dependency chain and reuses exact caches', async () => {
  const root = await project();
  const countFile = path.join(root, 'project-verifier-calls.txt');
  process.env.QMD_PROVER_VERIFIER = verifier;
  process.env.QMD_PROVER_VERIFIER_COUNT = countFile;
  try {
    await writeFile(path.join(root, 'goal.qmd'), result('thm-main-project-ai', 'The project route succeeds.'));
    await mkdir(path.join(root, 'workspace'), { recursive: true });
    const route = path.join(root, 'workspace', 'route.qmd');
    await writeFile(route, [
      result('def-project-object', 'Construct the project object.'),
      result('lem-project-route', 'The project object has the needed property.', { proofText: 'Apply @def-project-object.' }),
      proof('thm-main-project-ai', 'Apply @lem-project-route.')
    ].join('\n'));

    const first = await inspectProject(root, options);
    assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
    assert.equal(first.verification.verifier_calls, 3);
    assert.deepEqual(first.facts.map((fact) => fact.status), ['verified', 'verified', 'verified']);
    assert.doesNotMatch(await readFile(route, 'utf8'), /VERIFIED/);
    const firstSnapshot = first.snapshot_id;
    const firstPointer = await readJson<{ snapshot_id: string; file: string }>(path.join(root, '.qmd-prover', 'graphs', 'latest.json'));
    assert.equal(firstPointer.snapshot_id, firstSnapshot);
    assert.equal((await readJson<{ snapshot_id: string }>(path.join(root, firstPointer.file))).snapshot_id, firstSnapshot);

    const second = await inspectProject(root, options);
    assert.equal(second.ok, true);
    assert.equal(second.verification.verifier_calls, 0);
    assert.equal(second.verification.cache_hits, 3);
    assert.equal(second.snapshot_id, firstSnapshot);

    await writeFile(route, (await readFile(route, 'utf8')).replace('Apply @def-project-object.', 'Apply @def-project-object by the changed route.'));
    const changed = await inspectProject(root, options);
    assert.equal(changed.ok, true);
    assert.equal(changed.verification.verifier_calls, 1);
    assert.equal(changed.verification.cache_hits, 2);
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
    delete process.env.QMD_PROVER_VERIFIER_COUNT;
  }
});

test('an unconfigured verifier exposes machine state but does not reuse AI labels', async () => {
  const root = await project();
  await writeFile(path.join(root, 'goal.qmd'), result('thm-main-no-verifier-labels', 'Every integer is even.'));
  await mkdir(path.join(root, 'workspace'), { recursive: true });
  await writeFile(path.join(root, 'workspace', 'main-proof.qmd'), proof('thm-main-no-verifier-labels', 'DISPROVED\n\nThe integer 1 is not even.'));
  process.env.QMD_PROVER_VERIFIER = verifier;
  try {
    const checked = await inspectProject(root, options);
    assert.equal(checked.facts[0]?.global_verification.status, 'disproved');
    delete process.env.QMD_PROVER_VERIFIER;
    const machineOnly = await inspectProject(root, options);
    assert.equal(machineOnly.ok, true);
    assert.equal(machineOnly.verification.available, false);
    assert.equal(machineOnly.verification.cache_hits, 0);
    assert.equal(machineOnly.facts[0]?.mechanical.status, 'pass');
    assert.equal(machineOnly.facts[0]?.local_verification.status, 'not-run');
    assert.equal(machineOnly.facts[0]?.global_verification.status, 'unverified');
    assert.ok(!machineOnly.graph.nodes.some((node) => node.disproof));
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
  }
});

test('local verification checks dependents conditionally and global verification propagates independently', async () => {
  const root = await project();
  const countFile = path.join(root, 'conditional-verifier-calls.txt');
  process.env.QMD_PROVER_VERIFIER = verifier;
  process.env.QMD_PROVER_VERIFIER_COUNT = countFile;
  try {
    await writeFile(path.join(root, 'goal.qmd'), result('thm-main-conditional', 'The final conclusion holds.'));
    await mkdir(path.join(root, 'workspace'), { recursive: true });
    const route = path.join(root, 'workspace', 'route.qmd');
    await writeFile(route, [
      result('lem-conditional-premise', 'The premise holds.', { proofText: 'INVALID premise proof.' }),
      proof('thm-main-conditional', 'Use @lem-conditional-premise.')
    ].join('\n'));

    const rejected = await inspectFact(root, '@thm-main-conditional', options);
    assert.equal(rejected.ok, true);
    assert.equal(rejected.verification.verifier_calls, 2);
    const premise = must(rejected.graph.nodes.find((node) => node.id === 'lem-conditional-premise'));
    const targetNode = must(rejected.graph.nodes.find((node) => node.id === 'thm-main-conditional'));
    assert.equal(premise.local_verification?.outcome, 'rejected');
    assert.equal(premise.global_verification?.status, 'rejected');
    assert.equal(targetNode.local_verification?.outcome, 'verified');
    assert.equal(targetNode.global_verification?.status, 'blocked');
    assert.deepEqual(targetNode.global_verification?.blockers, ['lem-conditional-premise']);
    const checksRoot = path.join(root, '.qmd-prover', 'verification', 'checks');
    const checkFiles = await readdir(checksRoot);
    const records = await Promise.all(checkFiles.map((name) => readJson<Record<string, unknown>>(path.join(checksRoot, name))));
    const targetRecord = must(records.find((record) => record.target === 'thm-main-conditional'));
    const packet = targetRecord.packet as { dependencies: Array<Record<string, unknown>> };
    assert.equal(packet.dependencies.length, 1);
    assert.equal(packet.dependencies[0]?.id, 'lem-conditional-premise');
    assert.equal('proof' in must(packet.dependencies[0]), false);
    assert.equal('status' in must(packet.dependencies[0]), false);
    assert.deepEqual(Object.keys(packet.dependencies[0]?.identity as Record<string, unknown>).sort(), ['statement_hash']);

    await writeFile(route, (await readFile(route, 'utf8')).replace('INVALID premise proof.', 'A valid premise proof.'));
    const repaired = await inspectFact(root, '@thm-main-conditional', options);
    assert.equal(repaired.verification.verifier_calls, 1);
    assert.equal(repaired.verification.cache_hits, 1);
    assert.equal(repaired.check.global_verification.status, 'verified');
    assert.deepEqual(repaired.graph.edges, rejected.graph.edges);
    assert.deepEqual((await readFile(countFile, 'utf8')).trim().split('\n'), [
      'lem-conditional-premise', 'thm-main-conditional', 'lem-conditional-premise'
    ]);
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
    delete process.env.QMD_PROVER_VERIFIER_COUNT;
  }
});

test('machine cycles invalidate global results without suppressing local conditional checks', async () => {
  const root = await project();
  process.env.QMD_PROVER_VERIFIER = verifier;
  try {
    await writeFile(path.join(root, 'goal.qmd'), result('thm-main-cycle-layers', 'The cyclic target holds.'));
    await mkdir(path.join(root, 'workspace'), { recursive: true });
    await writeFile(path.join(root, 'workspace', 'cycle.qmd'), [
      result('lem-cycle-left', 'The left claim.', { proofText: 'Use @lem-cycle-right.' }),
      result('lem-cycle-right', 'The right claim.', { proofText: 'Use @lem-cycle-left.' }),
      proof('thm-main-cycle-layers', 'Use @lem-cycle-left.')
    ].join('\n'));

    const inspected = await inspectProject(root, options);
    assert.equal(inspected.ok, false);
    assert.equal(inspected.verification.verifier_calls, 3);
    assert.equal(inspected.verification.local_verified, 3);
    assert.equal(inspected.verification.global_invalid, 2);
    assert.equal(inspected.verification.global_blocked, 1);
    assert.ok(inspected.facts.filter((fact) => fact.id.startsWith('lem-cycle-')).every((fact) => (
      fact.local_verification.outcome === 'verified' && fact.global_verification.status === 'invalid'
    )));
    assert.equal(must(inspected.facts.find((fact) => fact.id === 'thm-main-cycle-layers')).global_verification.status, 'blocked');
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
  }
});

test('DISPROVED refutations are independently verified, exposed, cached, and unusable as premises', async () => {
  const root = await project();
  const countFile = path.join(root, 'disproof-verifier-calls.txt');
  process.env.QMD_PROVER_VERIFIER = verifier;
  process.env.QMD_PROVER_VERIFIER_COUNT = countFile;
  try {
    await writeFile(path.join(root, 'goal.qmd'), result('thm-main-disproof', 'Every integer is even.'));
    await mkdir(path.join(root, 'workspace'), { recursive: true });
    const route = path.join(root, 'workspace', 'route.qmd');
    await writeFile(route, [
      result('def-parity-witness', 'The integer 1 is an admissible parity witness.'),
      result('lem-false-premise', 'Every integer is even.', {
        proofText: 'DISPROVED\n\nBy @def-parity-witness, the integer 1 satisfies the domain hypothesis and is not even.'
      }),
      proof('thm-main-disproof', 'Apply @lem-false-premise.')
    ].join('\n'));

    const refutation = await inspectFact(root, '@lem-false-premise', options);
    assert.equal(refutation.ok, true, JSON.stringify(refutation.diagnostics));
    assert.equal(refutation.fact.marker, 'DISPROVED');
    assert.equal(refutation.fact.status, 'disproved');
    assert.equal(refutation.fact.disproof?.status, 'global');
    assert.match(refutation.fact.disproof?.refutation ?? '', /integer 1/);
    assert.equal(refutation.check.local_verification.outcome, 'disproved');
    assert.equal(refutation.check.global_verification.status, 'disproved');
    assert.equal(refutation.verification.local_disproved, 1);
    assert.equal(refutation.verification.global_disproved, 1);
    const refutationNode = must(refutation.graph.nodes.find((node) => node.id === 'lem-false-premise'));
    assert.equal(refutationNode.status, 'disproved');
    assert.match(refutationNode.disproof?.refutation ?? '', /integer 1/);
    assert.match(printReport(refutation), /global=disproved/);
    assert.match(printReport(refutation), /refutation:.*integer 1/);
    assert.match(await readFile(route, 'utf8'), /DISPROVED/);
    const impact = await analyzeDependencies(root, 'impact', ['@def-parity-witness'], options);
    assert.equal(impact.ok, true, JSON.stringify(impact.diagnostics));
    const affected = impact.affected ?? [];
    assert.deepEqual(affected.map(({ id, status }) => ({ id, status })), [
      { id: 'lem-false-premise', status: 'disproved' },
      { id: 'thm-main-disproof', status: 'candidate' }
    ]);
    const search = await analyzeDependencies(root, 'search', ['false'], { ...options, status: 'disproved' });
    assert.deepEqual(search.matches?.map((node) => node.id), ['lem-false-premise']);
    const frontier = await analyzeDependencies(root, 'frontier', ['@thm-main-disproof'], options);
    assert.deepEqual(frontier.frontier?.map((item) => ({ id: item.fact.id, status: item.fact.status })), [
      { id: 'lem-false-premise', status: 'disproved' }
    ]);

    const blocked = await inspectFact(root, '@thm-main-disproof', options);
    assert.equal(blocked.ok, true);
    assert.equal(blocked.verification.verifier_calls, 1);
    assert.equal(blocked.verification.cache_hits, 2);
    assert.equal(blocked.verification.local_disproved, 1);
    assert.equal(blocked.verification.global_disproved, 1);
    assert.equal(blocked.check.local_verification.outcome, 'verified');
    assert.equal(blocked.check.global_verification.status, 'blocked');
    assert.equal(blocked.graph.nodes.find((node) => node.id === 'lem-false-premise')?.status, 'disproved');
    const blockers = blocked.blockers as unknown as Array<{ blocker: { status: string } }>;
    assert.equal(blockers[0]?.blocker.status, 'disproved');

    await writeFile(route, (await readFile(route, 'utf8')).replace(
      'By @def-parity-witness, the integer 1 satisfies the domain hypothesis and is not even.',
      'REFUTATION_CORRECT_VERDICT'
    ));
    const rejectedRefutation = await inspectFact(root, '@lem-false-premise', options);
    assert.equal(rejectedRefutation.ok, true);
    assert.equal(rejectedRefutation.fact.status, 'rejected');
    assert.equal(rejectedRefutation.fact.disproof, undefined);
    assert.equal(rejectedRefutation.check.local_verification.outcome, 'rejected');
    assert.equal(rejectedRefutation.check.global_verification.status, 'rejected');
    assert.ok(rejectedRefutation.diagnostics.some((item) => item.code === 'AI_DISPROOF_REJECTED'));
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
    delete process.env.QMD_PROVER_VERIFIER_COUNT;
  }
});

test('a verifier-discovered counterexample produces disproved without editing QMD', async () => {
  const root = await project();
  process.env.QMD_PROVER_VERIFIER = verifier;
  try {
    await writeFile(path.join(root, 'goal.qmd'), result('thm-main-verifier-disproof', 'Every integer is even.'));
    await mkdir(path.join(root, 'workspace'), { recursive: true });
    const candidate = path.join(root, 'workspace', 'main-proof.qmd');
    await writeFile(candidate, proof('thm-main-verifier-disproof', 'DISCOVER_COUNTEREXAMPLE'));

    const inspected = await inspectFact(root, '@thm-main-verifier-disproof', options);
    assert.equal(inspected.ok, true, JSON.stringify(inspected.diagnostics));
    assert.equal(inspected.fact.marker, null);
    assert.equal(inspected.fact.status, 'disproved');
    assert.equal(inspected.check.local_verification.outcome, 'disproved');
    assert.match(inspected.fact.disproof?.refutation ?? '', /verifier-discovered counterexample/);
    assert.equal(inspected.graph.nodes.find((node) => node.id === 'thm-main-verifier-disproof')?.disproof?.status, 'global');
    assert.doesNotMatch(await readFile(candidate, 'utf8'), /DISPROVED/);

    const cached = await inspectFact(root, '@thm-main-verifier-disproof', options);
    assert.equal(cached.fact.status, 'disproved');
    assert.equal(cached.verification.verifier_calls, 0);
    assert.equal(cached.verification.cache_hits, 1);
    assert.equal(cached.verification.local_disproved, 1);
    assert.equal(cached.verification.global_disproved, 1);
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
  }
});

test('a disproved verifier verdict without refutation evidence fails closed', async () => {
  const root = await project();
  process.env.QMD_PROVER_VERIFIER = verifier;
  try {
    await writeFile(path.join(root, 'goal.qmd'), result('thm-main-empty-disproof', 'Every integer is even.'));
    await mkdir(path.join(root, 'workspace'), { recursive: true });
    await writeFile(
      path.join(root, 'workspace', 'main-proof.qmd'),
      proof('thm-main-empty-disproof', 'DISCOVER_EMPTY_DISPROOF')
    );

    const inspected = await inspectFact(root, '@thm-main-empty-disproof', options);
    assert.equal(inspected.ok, false);
    assert.equal(inspected.fact.status, 'unverified');
    assert.equal(inspected.fact.disproof, undefined);
    assert.equal(inspected.check.local_verification.status, 'error');
    assert.match(inspected.check.local_verification.error ?? '', /requires a nonempty refutation/);
    assert.equal(inspected.verification.local_disproved, 0);
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
  }
});

test('staleness auditing rejects a cache whose recorded disproof outcome is inconsistent', async () => {
  const root = await project();
  process.env.QMD_PROVER_VERIFIER = verifier;
  try {
    await writeFile(path.join(root, 'goal.qmd'), result('thm-main-stale-disproof', 'Every integer is even.'));
    await mkdir(path.join(root, 'workspace'), { recursive: true });
    await writeFile(
      path.join(root, 'workspace', 'main-proof.qmd'),
      proof('thm-main-stale-disproof', 'DISPROVED\n\nThe integer 1 is not even.')
    );
    assert.equal((await inspectFact(root, '@thm-main-stale-disproof', options)).fact.status, 'disproved');

    const checks = path.join(root, '.qmd-prover', 'verification', 'checks');
    const [cacheName] = await readdir(checks);
    const cacheFile = path.join(checks, cacheName ?? 'missing.json');
    const cache = await readJson<Record<string, unknown>>(cacheFile);
    await writeFile(cacheFile, JSON.stringify({ ...cache, outcome: 'verified' }));

    const audit = await checkStaleness(root, options);
    assert.ok(audit.changed.some((item) => item.id === 'thm-main-stale-disproof' && item.reasons.includes('cache-invalid')));
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
  }
});

test('rigor gates whether reported gaps block acceptance; strict blocks, standard does not', async () => {
  const root = await project();
  process.env.QMD_PROVER_VERIFIER = verifier;
  try {
    await writeFile(path.join(root, 'goal.qmd'), result('lem-has-gap', 'A lemma proved with a routine omission.', { proofText: 'An argument that leaves a GAP for the reader to fill.' }));

    // rigor: standard — the reported gap is advisory, so a correct argument still verifies.
    await writeFile(path.join(root, '.qmd-prover', 'config.yml'), 'verification:\n  citations: standard\n  rigor: standard\n');
    const standard = await inspectFact(root, '@lem-has-gap', options);
    assert.equal(standard.check.local_verification.report?.gaps.length, 1);
    assert.equal(standard.check.local_verification.outcome, 'verified');
    assert.equal(standard.check.global_verification.status, 'verified');

    // rigor: strict — the identical report now blocks, because gaps must be empty.
    await writeFile(path.join(root, '.qmd-prover', 'config.yml'), 'verification:\n  citations: standard\n  rigor: strict\n');
    const strict = await inspectFact(root, '@lem-has-gap', options);
    assert.equal(strict.check.local_verification.report?.gaps.length, 1);
    assert.equal(strict.check.local_verification.status, 'fail');
    assert.equal(strict.check.global_verification.status, 'rejected');
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
  }
});

test('checker contract carries the citations/rigor axes and verifierCommand forwards effort', () => {
  delete process.env.QMD_PROVER_VERIFIER;
  const contract = checkerContract({ verification: { backend: 'codex', citations: 'strict', rigor: 'lenient', effort: 'xhigh' } });
  assert.equal(contract.citations, 'strict');
  assert.equal(contract.rigor, 'lenient');
  assert.equal(contract.effort, 'xhigh');
  assert.equal('require_zero_gaps' in contract, false);
  assert.equal('definition_strictness' in contract, false);

  for (const backend of ['codex', 'claude'] as const) {
    const cmd = must(verifierCommand({ verification: { backend, effort: 'xhigh', model: 'a-model' } }));
    assert.equal(cmd.args[cmd.args.indexOf('--effort') + 1], 'xhigh');
    assert.equal(cmd.args[cmd.args.indexOf('--model') + 1], 'a-model');
  }
});

test('verification.tools drives prompt-level tool permissions and filters unknown names', () => {
  const packet = (tools: string[]) => buildVerifierPacket({
    target: { id: 'lem-x', kind: 'lemma', statement: 'S', proof: 'P' },
    config: { verification: { backend: 'codex', tools } }
  });

  const none = packet([]);
  assert.deepEqual(none.checker_contract.tools, []);
  assert.ok(String(none.instructions).includes('Reason from the packet alone'));
  assert.ok(!String(none.instructions).includes('You may use the following tools'));

  const some = packet(['code', 'bogus']);
  assert.deepEqual(some.checker_contract.tools, ['code']); // unknown dropped
  assert.ok(String(some.instructions).includes('code execution'));
  assert.ok(!String(some.instructions).includes('web search'));

  const all = packet(['web-search', 'file-read', 'code']);
  assert.deepEqual(all.checker_contract.tools, ['file-read', 'web-search', 'code']); // canonical order
  const text = String(all.instructions);
  for (const phrase of ['code execution', "reading the project's own files", 'web search']) {
    assert.ok(text.includes(phrase), `missing tool permission: ${phrase}`);
  }
});
