import assert from 'node:assert/strict';
import { chmod, cp } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { initializeWorkspace } from '../skills/qmd-prover/src/lib/workspace/initialize.js';
import { inspectWorkspace } from '../skills/qmd-prover/src/lib/workspace/inspect.js';
import { bareProject, fakePandoc, here, verifier } from './support.js';

const fixture = path.join(here, 'fixtures', 'large-project');
const target = 'thm-main-godel-completeness';

test('large workspace fixture is mechanically valid and reuses exact verification caches', async () => {
  const root = await bareProject();
  await Promise.all([chmod(fakePandoc, 0o755), chmod(verifier, 0o755)]);
  await cp(path.join(fixture, 'project'), root, { recursive: true });
  const created = await initializeWorkspace(root, `@${target}`, { pandoc: fakePandoc });
  const workspace = path.join(root, created.workspace);
  await cp(path.join(fixture, 'workspace', target), workspace, { recursive: true });

  process.env.QMD_PROVER_VERIFIER = verifier;
  try {
    const first = await inspectWorkspace(root, `@${target}`, { pandoc: fakePandoc });
    assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
    assert.equal(first.complete, true);
    assert.equal(first.manifest.files.length, 5);
    assert.equal(first.manifest.results.length, 32);
    assert.equal(first.manifest.proofs.length, 20);
    assert.equal(first.verification.eligible, 32);
    assert.equal(first.verification.verifier_calls, 32);
    assert.equal(first.verification.passed, 32);
    assert.equal(first.verification.not_run, 0);
    assert.ok(first.facts.every((fact) => fact.status === 'workspace-verified'));

    const second = await inspectWorkspace(root, `@${target}`, { pandoc: fakePandoc });
    assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
    assert.equal(second.snapshot_id, first.snapshot_id);
    assert.equal(second.verification.verifier_calls, 0);
    assert.equal(second.verification.cache_hits, 32);
    assert.equal(second.verification.passed, 32);
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
  }
});
