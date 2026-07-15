import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { readJson } from '../skills/qmd-prover/src/lib/infrastructure/files.js';
import { inspectFact, inspectProject } from '../skills/qmd-prover/src/lib/inspection/operations.js';
import type { GraphEdge } from '../skills/qmd-prover/src/lib/shared/types.js';
import { bareProject, fakePandoc, here, must, verifier } from './support.js';

const fixture = path.join(here, 'fixtures', 'large-project');
const target = 'thm-main-godel-completeness';

interface ProjectCliResult {
  operation: string;
  ok: boolean;
  summary: { facts: number };
  graph: { edges: unknown[] };
  verification: { verifier_calls: number; cache_hits: number };
}

async function materializeLargeProject() {
  const root = await bareProject();
  await Promise.all([chmod(fakePandoc, 0o755), chmod(verifier, 0o755)]);
  await cp(path.join(fixture, 'project'), root, { recursive: true });
  return { root, workspace: path.join(root, 'workspace') };
}

function reverseClosure(edges: GraphEdge[], start: string): string[] {
  const selected = new Set([start]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (selected.has(edge.to) && !selected.has(edge.from)) {
        selected.add(edge.from);
        changed = true;
      }
    }
  }
  return [...selected].sort();
}

async function verifierCalls(file: string): Promise<string[]> {
  return (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean);
}

async function runProjectCli(root: string): Promise<ProjectCliResult> {
  const cli = path.join(here, '..', 'skills', 'qmd-prover', 'scripts', 'qmd-prover.js');
  return new Promise((resolve, reject) => execFile(process.execPath, [cli, 'inspect', 'project'], {
    cwd: root,
    env: { ...process.env, QMD_PROVER_PANDOC: fakePandoc, QMD_PROVER_VERIFIER: verifier },
    maxBuffer: 4 * 1024 * 1024
  }, (error, stdout) => error ? reject(error) : resolve(JSON.parse(stdout) as ProjectCliResult)));
}

test('large project fixture completes through the public CLI, persists its graph, and keys caches by external basis', async () => {
  const { root } = await materializeLargeProject();
  const countFile = path.join(root, 'large-verifier-calls.txt');

  process.env.QMD_PROVER_VERIFIER = verifier;
  process.env.QMD_PROVER_VERIFIER_COUNT = countFile;
  try {
    const first = await inspectProject(root, { pandoc: fakePandoc });
    assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
    assert.equal(first.complete, true);
    assert.equal(first.graph.nodes.length, 32);
    assert.equal(first.graph.edges.length, 84);
    assert.deepEqual(first.graph.cycles, []);
    assert.deepEqual(first.findings.unused_imports, []);
    assert.deepEqual(first.findings.unused_exports, []);
    assert.deepEqual(first.findings.isolated_facts, []);
    assert.deepEqual(first.findings.unreachable.facts.map((fact) => fact.id), ['lem-semantic-substitution']);
    assert.equal(first.verification.eligible, 32);
    assert.equal(first.verification.verifier_calls, 32);
    assert.equal(first.verification.local_verified, 32);
    assert.equal(first.verification.local_not_run, 0);
    assert.equal(first.verification.global_verified, 32);
    assert.ok(first.facts.every((fact) => fact.status === 'verified'));
    assert.ok(first.graph.edges.every((edge) => edge.checks?.existence === 'pass'
      && edge.checks.scope === 'pass'
      && edge.checks.cycle === 'pass'));
    const targetFact = must(first.facts.find((fact) => fact.id === target));
    assert.match(must(targetFact.local_verification.report).summary, /\[external:declared:# External mathematical basis/);

    const firstCalls = await verifierCalls(countFile);
    assert.equal(firstCalls.length, 32);
    const callPosition = new Map(firstCalls.map((id, index) => [id, index]));
    for (const edge of first.graph.edges) {
      assert.ok(must(callPosition.get(edge.to)) < must(callPosition.get(edge.from)), `${edge.to} must be checked before ${edge.from}`);
    }

    const persistedManifest = await readJson<{ results: unknown[] }>(path.join(root, '.qmd-prover', 'manifest.json'));
    const persistedGraph = await readJson<{ snapshot_id: string; edges: unknown[] }>(path.join(root, '.qmd-prover', 'graph.json'));
    const latest = await readJson<{ snapshot_id: string; file: string }>(path.join(root, '.qmd-prover', 'graphs', 'latest.json'));
    const snapshot = await readJson<{ snapshot_id: string }>(path.join(root, latest.file));
    assert.equal(persistedManifest.results.length, 32);
    assert.equal(persistedGraph.edges.length, 84);
    assert.equal(latest.snapshot_id, first.snapshot_id);
    assert.equal(snapshot.snapshot_id, first.snapshot_id);

    const second = await inspectProject(root, { pandoc: fakePandoc });
    assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
    assert.equal(second.snapshot_id, first.snapshot_id);
    assert.equal(second.verification.verifier_calls, 0);
    assert.equal(second.verification.cache_hits, 32);
    assert.equal(second.verification.local_verified, 32);
    assert.deepEqual(await verifierCalls(countFile), firstCalls);

    await writeFile(path.join(root, '.qmd-prover', '.external.qmd'), '# External mathematical basis\n\nStandard first-order metatheory and dependent choice may be used.\n');
    const changedBasis = await inspectProject(root, { pandoc: fakePandoc });
    assert.equal(changedBasis.ok, true, JSON.stringify(changedBasis.diagnostics));
    assert.notEqual(changedBasis.snapshot_id, first.snapshot_id);
    assert.equal(changedBasis.verification.verifier_calls, 32);
    assert.equal(changedBasis.verification.cache_hits, 0);
    assert.match(must(must(changedBasis.facts.find((fact) => fact.id === target)).local_verification.report).summary, /dependent choice may be used/);
    assert.equal((await verifierCalls(countFile)).length, 64);

    const cli = await runProjectCli(root);
    assert.equal(cli.operation, 'inspect-project');
    assert.equal(cli.ok, true);
    assert.equal(cli.summary.facts, 32);
    assert.equal(cli.graph.edges.length, 84);
    assert.equal(cli.verification.verifier_calls, 0);
    assert.equal(cli.verification.cache_hits, 32);
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
    delete process.env.QMD_PROVER_VERIFIER_COUNT;
  }
});

test('inspect fact locates a large-project fact and verifies only its dependency closure', async () => {
  const { root } = await materializeLargeProject();
  const countFile = path.join(root, 'large-narrow-verifier-calls.txt');
  process.env.QMD_PROVER_VERIFIER = verifier;
  process.env.QMD_PROVER_VERIFIER_COUNT = countFile;
  try {
    const inspected = await inspectFact(root, '@def-hilbert-calculus', { pandoc: fakePandoc });
    assert.equal(inspected.ok, true, JSON.stringify(inspected.diagnostics));
    assert.equal(inspected.fact.id, 'def-hilbert-calculus');
    assert.ok(inspected.graph.nodes.some((node) => node.id === 'def-fol-substitution'));
    assert.ok(!inspected.graph.nodes.some((node) => node.id === 'lem-proof-finitary'));
    assert.equal(inspected.verification.verifier_calls, inspected.graph.nodes.length);
    assert.deepEqual((await verifierCalls(countFile)).sort(), inspected.graph.nodes.map((node) => node.id).sort());
    const latest = await readJson<{ schema_version: number; file: string }>(path.join(root, '.qmd-prover', 'graphs', 'latest.json'));
    const snapshot = await readJson<{ schema_version: number; goals: unknown[]; notes: unknown[]; graph: { nodes: unknown[] } }>(path.join(root, latest.file));
    assert.equal(latest.schema_version, 6);
    assert.equal(snapshot.schema_version, 6);
    assert.equal(snapshot.goals.length, 1);
    assert.equal(snapshot.notes.length, 7);
    assert.equal(snapshot.graph.nodes.length, 32);
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
    delete process.env.QMD_PROVER_VERIFIER_COUNT;
  }
});

test('inspect fact uses the main-goal proof overlay without changing user notes', async () => {
  const { root } = await materializeLargeProject();
  const userFile = path.join(root, 'completeness.qmd');
  const before = await readFile(userFile);
  process.env.QMD_PROVER_VERIFIER = verifier;
  try {
    const inspected = await inspectFact(root, `@${target}`, { pandoc: fakePandoc });
    assert.equal(inspected.ok, true, JSON.stringify(inspected.diagnostics));
    assert.equal(inspected.fact.id, target);
    assert.equal(inspected.fact.status, 'verified');
    assert.equal(inspected.fact.proof_file, 'workspace/main-proof.qmd');
    assert.equal(inspected.check.local_verification.status, 'pass');
    assert.equal(inspected.check.global_verification.status, 'verified');
    assert.deepEqual(await readFile(userFile), before);
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
  }
});

test('large project rechecks only the changed local proof when dependency statements stay fixed', async () => {
  const { root, workspace } = await materializeLargeProject();
  const countFile = path.join(root, 'large-incremental-verifier-calls.txt');
  process.env.QMD_PROVER_VERIFIER = verifier;
  process.env.QMD_PROVER_VERIFIER_COUNT = countFile;
  try {
    const first = await inspectProject(root, { pandoc: fakePandoc });
    assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
    const changedId = 'lem-substitution-composition';
    const affected = reverseClosure(first.graph.edges, changedId);
    assert.deepEqual(affected, [
      'lem-canonical-truth',
      'lem-constant-elimination',
      'lem-henkin-witness-consistency',
      'lem-henkinization',
      'lem-pure-language-extension',
      'lem-substitution-composition',
      'thm-consistent-model',
      target
    ]);

    const foundations = path.join(workspace, 'foundations.qmd');
    const source = await readFile(foundations, 'utf8');
    await writeFile(foundations, source.replace(
      'Use @lem-fresh-variable to rename every binder',
      'Use @lem-fresh-variable first to rename every binder'
    ));
    const changed = await inspectProject(root, { pandoc: fakePandoc });
    assert.equal(changed.ok, true, JSON.stringify(changed.diagnostics));
    assert.notEqual(changed.snapshot_id, first.snapshot_id);
    assert.equal(changed.verification.verifier_calls, 1);
    assert.equal(changed.verification.cache_hits, 31);
    assert.deepEqual((await verifierCalls(countFile)).slice(32), [changedId]);

    const stable = await inspectProject(root, { pandoc: fakePandoc });
    assert.equal(stable.snapshot_id, changed.snapshot_id);
    assert.equal(stable.verification.verifier_calls, 0);
    assert.equal(stable.verification.cache_hits, 32);
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
    delete process.env.QMD_PROVER_VERIFIER_COUNT;
  }
});

test('large project locally checks every fact and globally blocks the reverse closure after a leaf proof is rejected', async () => {
  const { root, workspace } = await materializeLargeProject();
  const foundations = path.join(workspace, 'foundations.qmd');
  const source = await readFile(foundations, 'utf8');
  await writeFile(foundations, source.replace(
    'Use @lem-fresh-variable to rename every binder',
    'INVALID. Use @lem-fresh-variable to rename every binder'
  ));

  process.env.QMD_PROVER_VERIFIER = verifier;
  try {
    const inspected = await inspectProject(root, { pandoc: fakePandoc });
    const rejectedId = 'lem-substitution-composition';
    const blocked = reverseClosure(inspected.graph.edges, rejectedId).filter((id) => id !== rejectedId);
    assert.equal(inspected.ok, true);
    assert.equal(inspected.verification.verifier_calls, 32);
    assert.equal(inspected.verification.local_verified, 31);
    assert.equal(inspected.verification.local_rejected, 1);
    assert.equal(inspected.verification.local_not_run, 0);
    assert.equal(inspected.verification.global_verified, 24);
    assert.equal(inspected.verification.global_rejected, 1);
    assert.equal(inspected.verification.global_blocked, 7);
    assert.equal(must(inspected.facts.find((fact) => fact.id === rejectedId)).local_verification.status, 'fail');
    assert.deepEqual(inspected.facts.filter((fact) => fact.global_verification.status === 'blocked').map((fact) => fact.id).sort(), blocked);
    assert.equal(must(inspected.facts.find((fact) => fact.id === target)).mechanical.status, 'pass');
    assert.ok(inspected.diagnostics.some((item) => item.code === 'AI_CHECK_REJECTED' && item.id === rejectedId));
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
  }
});

test('large project fixture exposes a missing cross-file import as a mechanical failure', async () => {
  const { root, workspace } = await materializeLargeProject();
  const calculus = path.join(workspace, 'calculus.qmd');
  const source = await readFile(calculus, 'utf8');
  await writeFile(calculus, source.replace('        - lem-substitution-composition\n', ''));

  process.env.QMD_PROVER_VERIFIER = verifier;
  try {
    const inspected = await inspectProject(root, { pandoc: fakePandoc });
    assert.equal(inspected.ok, false);
    const codes = new Set(inspected.diagnostics.map((item) => item.code));
    assert.ok(codes.has('DEPENDENCY_UNAVAILABLE'));
    assert.equal(inspected.verification.local_not_run, 0);
    assert.equal(inspected.verification.verifier_calls, 32);
    assert.ok(inspected.verification.global_invalid > 0);
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
  }
});

test('large project never verifies a protected goal against a mutated statement', async () => {
  const { root } = await materializeLargeProject();
  const countFile = path.join(root, 'large-stale-verifier-calls.txt');
  process.env.QMD_PROVER_VERIFIER = verifier;
  process.env.QMD_PROVER_VERIFIER_COUNT = countFile;
  try {
    const first = await inspectProject(root, { pandoc: fakePandoc });
    assert.equal(first.ok, true, JSON.stringify(first.diagnostics));

    const canonical = path.join(root, 'completeness.qmd');
    const source = await readFile(canonical, 'utf8');
    await writeFile(canonical, source.replace(
      'proof calculus developed in this project.',
      'proof calculus developed in this project and recorded here.'
    ));
    const mutated = await inspectProject(root, { pandoc: fakePandoc });
    assert.equal(mutated.ok, false);
    assert.ok(mutated.diagnostics.some((item) => item.code === 'MAIN_STATEMENT_MUTATED' && item.id === target));
    const goal = must(mutated.facts.find((fact) => fact.id === target));
    assert.equal(goal.local_verification.status, 'not-run');
    assert.equal(goal.global_verification.status, 'invalid');
    assert.deepEqual((await verifierCalls(countFile)).slice(32), []);
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
    delete process.env.QMD_PROVER_VERIFIER_COUNT;
  }
});
