import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { readJson } from '../skills/qmd-prover/src/lib/infrastructure/files.js';
import { deriveGraphFindings } from '../skills/qmd-prover/src/lib/inspection/findings.js';
import { initializeWorkspace } from '../skills/qmd-prover/src/lib/workspace/initialize.js';
import { inspectWorkspace } from '../skills/qmd-prover/src/lib/workspace/inspect.js';
import { asRecord } from '../skills/qmd-prover/src/lib/shared/core.js';
import type { GraphEdge } from '../skills/qmd-prover/src/lib/shared/types.js';
import { bareProject, fakePandoc, here, must, verifier } from './support.js';

const fixture = path.join(here, 'fixtures', 'large-project');
const target = 'thm-main-godel-completeness';

interface WorkspaceCliResult {
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
  const created = await initializeWorkspace(root, `@${target}`, { pandoc: fakePandoc });
  const workspace = path.join(root, created.workspace);
  await cp(path.join(fixture, 'workspace', target), workspace, { recursive: true });
  return { root, workspace, created };
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

async function runWorkspaceCli(root: string): Promise<WorkspaceCliResult> {
  const cli = path.join(here, '..', 'skills', 'qmd-prover', 'scripts', 'qmd-prover.js');
  return new Promise((resolve, reject) => execFile(process.execPath, [cli, 'workspace', 'inspect', `@${target}`], {
    cwd: root,
    env: { ...process.env, QMD_PROVER_PANDOC: fakePandoc, QMD_PROVER_VERIFIER: verifier },
    maxBuffer: 4 * 1024 * 1024
  }, (error, stdout) => error ? reject(error) : resolve(JSON.parse(stdout) as WorkspaceCliResult)));
}

test('large workspace fixture completes through the public CLI, persists its graph, and keys caches by external basis', async () => {
  const { root, workspace, created } = await materializeLargeProject();
  const countFile = path.join(root, 'large-verifier-calls.txt');
  const metadata = asRecord(created.metadata);
  const canonicalMetadata = asRecord(metadata.canonical);

  assert.equal(created.status, 'created');
  assert.equal(metadata.target, target);
  assert.equal(canonicalMetadata.file, 'completeness.qmd');
  assert.equal(canonicalMetadata.status, 'open');
  assert.deepEqual(canonicalMetadata.dependencies, {});
  assert.match(await readFile(path.join(workspace, 'target.qmd'), 'utf8'), new RegExp(`#${target}`));

  process.env.QMD_PROVER_VERIFIER = verifier;
  process.env.QMD_PROVER_VERIFIER_COUNT = countFile;
  try {
    const first = await inspectWorkspace(root, `@${target}`, { pandoc: fakePandoc });
    assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
    assert.equal(first.complete, true);
    assert.equal(first.manifest.files.length, 5);
    assert.equal(first.manifest.results.length, 32);
    assert.equal(first.manifest.proofs.length, 20);
    assert.equal(first.graph.edges.length, 84);
    assert.deepEqual(first.graph.cycles, []);
    const findings = deriveGraphFindings(first);
    assert.deepEqual(findings.unused_imports, []);
    assert.deepEqual(findings.unused_exports, []);
    assert.deepEqual(findings.isolated_facts, []);
    assert.deepEqual(findings.unreachable.facts.map((fact) => fact.id), ['lem-semantic-substitution']);
    assert.equal(first.verification.eligible, 32);
    assert.equal(first.verification.verifier_calls, 32);
    assert.equal(first.verification.passed, 32);
    assert.equal(first.verification.not_run, 0);
    assert.ok(first.facts.every((fact) => fact.status === 'workspace-verified'));
    assert.ok(first.graph.edges.every((edge) => edge.checks?.existence === 'pass'
      && edge.checks.scope === 'pass'
      && edge.checks.status === 'pass'
      && edge.checks.cycle === 'pass'
      && edge.checks.ai_sufficiency === 'pass'));
    const targetFact = must(first.facts.find((fact) => fact.id === target));
    assert.match(must(targetFact.ai.report).summary, /\[external:declared:# External mathematical basis/);

    const firstCalls = await verifierCalls(countFile);
    assert.equal(firstCalls.length, 32);
    const callPosition = new Map(firstCalls.map((id, index) => [id, index]));
    for (const edge of first.graph.edges) {
      assert.ok(must(callPosition.get(edge.to)) < must(callPosition.get(edge.from)), `${edge.to} must be checked before ${edge.from}`);
    }

    const persistedManifest = await readJson<{ results: unknown[] }>(path.join(workspace, 'manifest.json'));
    const persistedGraph = await readJson<{ snapshot_id: string; edges: unknown[] }>(path.join(workspace, 'graph.json'));
    const latest = await readJson<{ snapshot_id: string; file: string }>(path.join(workspace, 'latest.json'));
    const snapshot = await readJson<{ snapshot_id: string }>(path.join(workspace, latest.file));
    assert.equal(persistedManifest.results.length, 32);
    assert.equal(persistedGraph.edges.length, 84);
    assert.equal(persistedGraph.snapshot_id, first.snapshot_id);
    assert.equal(latest.snapshot_id, first.snapshot_id);
    assert.equal(snapshot.snapshot_id, first.snapshot_id);

    const second = await inspectWorkspace(root, `@${target}`, { pandoc: fakePandoc });
    assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
    assert.equal(second.snapshot_id, first.snapshot_id);
    assert.equal(second.verification.verifier_calls, 0);
    assert.equal(second.verification.cache_hits, 32);
    assert.equal(second.verification.passed, 32);
    assert.deepEqual(await verifierCalls(countFile), firstCalls);

    await writeFile(path.join(root, '.qmd-prover', '.external.qmd'), '# External mathematical basis\n\nStandard first-order metatheory and dependent choice may be used.\n');
    const changedBasis = await inspectWorkspace(root, `@${target}`, { pandoc: fakePandoc });
    assert.equal(changedBasis.ok, true, JSON.stringify(changedBasis.diagnostics));
    assert.equal(changedBasis.stale, false);
    assert.equal(changedBasis.snapshot_id, first.snapshot_id);
    assert.equal(changedBasis.verification.verifier_calls, 32);
    assert.equal(changedBasis.verification.cache_hits, 0);
    assert.match(must(must(changedBasis.facts.find((fact) => fact.id === target)).ai.report).summary, /dependent choice may be used/);
    assert.equal((await verifierCalls(countFile)).length, 64);

    const cli = await runWorkspaceCli(root);
    assert.equal(cli.operation, 'workspace-inspect');
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

test('large workspace rechecks exactly the reverse dependency closure after one leaf proof changes', async () => {
  const { root, workspace } = await materializeLargeProject();
  const countFile = path.join(root, 'large-incremental-verifier-calls.txt');
  process.env.QMD_PROVER_VERIFIER = verifier;
  process.env.QMD_PROVER_VERIFIER_COUNT = countFile;
  try {
    const first = await inspectWorkspace(root, `@${target}`, { pandoc: fakePandoc });
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
    const changed = await inspectWorkspace(root, `@${target}`, { pandoc: fakePandoc });
    assert.equal(changed.ok, true, JSON.stringify(changed.diagnostics));
    assert.notEqual(changed.snapshot_id, first.snapshot_id);
    assert.equal(changed.verification.verifier_calls, affected.length);
    assert.equal(changed.verification.cache_hits, 32 - affected.length);
    assert.deepEqual((await verifierCalls(countFile)).slice(32).sort(), affected);

    const stable = await inspectWorkspace(root, `@${target}`, { pandoc: fakePandoc });
    assert.equal(stable.snapshot_id, changed.snapshot_id);
    assert.equal(stable.verification.verifier_calls, 0);
    assert.equal(stable.verification.cache_hits, 32);
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
    delete process.env.QMD_PROVER_VERIFIER_COUNT;
  }
});

test('large workspace blocks the full reverse dependency closure after a leaf proof is rejected', async () => {
  const { root, workspace } = await materializeLargeProject();
  const foundations = path.join(workspace, 'foundations.qmd');
  const source = await readFile(foundations, 'utf8');
  await writeFile(foundations, source.replace(
    'Use @lem-fresh-variable to rename every binder',
    'INVALID. Use @lem-fresh-variable to rename every binder'
  ));

  process.env.QMD_PROVER_VERIFIER = verifier;
  try {
    const inspected = await inspectWorkspace(root, `@${target}`, { pandoc: fakePandoc });
    const rejectedId = 'lem-substitution-composition';
    const blocked = reverseClosure(inspected.graph.edges, rejectedId).filter((id) => id !== rejectedId);
    const summary = asRecord(inspected.summary);
    assert.equal(inspected.ok, false);
    assert.equal(summary.mechanical_ok, true);
    assert.equal(summary.ai_ok, false);
    assert.equal(inspected.verification.verifier_calls, 25);
    assert.equal(inspected.verification.passed, 24);
    assert.equal(inspected.verification.rejected, 1);
    assert.equal(inspected.verification.not_run, 7);
    assert.equal(must(inspected.facts.find((fact) => fact.id === rejectedId)).ai.status, 'fail');
    assert.deepEqual(inspected.facts.filter((fact) => fact.ai.status === 'not-run').map((fact) => fact.id).sort(), blocked);
    assert.equal(asRecord(asRecord(must(inspected.facts.find((fact) => fact.id === target))).programmatic).reason, 'reference-check-failed');
    assert.ok(inspected.diagnostics.some((item) => item.code === 'WORKSPACE_AI_CHECK_REJECTED' && item.id === rejectedId));
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
  }
});

test('large workspace fixture exposes a missing cross-file import as a mechanical failure', async () => {
  const { root, workspace } = await materializeLargeProject();
  const calculus = path.join(workspace, 'calculus.qmd');
  const source = await readFile(calculus, 'utf8');
  await writeFile(calculus, source.replace('        - lem-substitution-composition\n', ''));

  process.env.QMD_PROVER_VERIFIER = verifier;
  try {
    const inspected = await inspectWorkspace(root, `@${target}`, { pandoc: fakePandoc });
    assert.equal(inspected.ok, false);
    const codes = new Set(inspected.diagnostics.map((item) => item.code));
    assert.ok(codes.has('DEPENDENCY_UNAVAILABLE'));
    assert.ok(codes.has('WORKSPACE_DEPENDENCY_UNAVAILABLE'));
    assert.ok(inspected.verification.not_run > 0);
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
  }
});

test('large workspace fails closed without verifier calls when its protected target changes', async () => {
  const { root } = await materializeLargeProject();
  const countFile = path.join(root, 'large-stale-verifier-calls.txt');
  const canonical = path.join(root, 'completeness.qmd');
  const source = await readFile(canonical, 'utf8');
  await writeFile(canonical, source.replace(
    'proof calculus developed in this project.',
    'proof calculus developed in this project and recorded here.'
  ));

  process.env.QMD_PROVER_VERIFIER = verifier;
  process.env.QMD_PROVER_VERIFIER_COUNT = countFile;
  try {
    const inspected = await inspectWorkspace(root, `@${target}`, { pandoc: fakePandoc });
    assert.equal(inspected.ok, false);
    assert.equal(inspected.stale, true);
    assert.deepEqual(inspected.workspace_staleness, {
      stale: true,
      target_stale: true,
      dependency_stale: false
    });
    assert.equal(inspected.verification.verifier_calls, 0);
    assert.ok(inspected.diagnostics.some((item) => item.code === 'WORKSPACE_STALE' && item.id === target));
    await assert.rejects(readFile(countFile), { code: 'ENOENT' });
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
    delete process.env.QMD_PROVER_VERIFIER_COUNT;
  }
});
