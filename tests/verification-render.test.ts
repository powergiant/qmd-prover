import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { renderProject } from '../skills/qmd-prover/src/lib/application/render.js';
import { readJson } from '../skills/qmd-prover/src/lib/infrastructure/files.js';
import { inspectFact } from '../skills/qmd-prover/src/lib/inspection/operations.js';
import { initializeWorkspace } from '../skills/qmd-prover/src/lib/workspace/initialize.js';
import { options, project, proof, result, verifier } from './support.js';

test('render prepares Quarto-compatible status QMD and an SVG linked to user main goals', async () => {
  const root = await project();
  await writeFile(path.join(root, 'goal.qmd'), result('thm-main-render', 'If x < y, then x < y.', { title: 'Render < safely' }));
  const rendered = await renderProject(root, options);
  assert.equal(rendered.status, 'prepared');
  assert.equal(rendered.render_command, undefined);
  assert.equal((rendered.quarto as { available: boolean }).available, false);
  const statusQmd = await readFile(path.join(root, '.qmd-prover', 'generated', 'proof-status.qmd'), 'utf8');
  const graph = await readFile(path.join(root, '.qmd-prover', 'generated', 'dependencies.svg'), 'utf8');
  assert.match(statusQmd, /\| @thm-main-render \| not-run \| unverified \|/);
  assert.match(graph, /goal\.qmd#thm-main-render/);
  assert.match(graph, /Render &lt; safely/);
  assert.equal((await readJson<{ summary: { results: number } }>(path.join(root, '.qmd-prover', 'reports', 'status.json'))).summary.results, 1);
  await assert.rejects(() => stat(path.join(root, '.qmd-prover', 'site')), /ENOENT/);
});

test('render exposes independently verified disproof evidence in status QMD and graph SVG', async () => {
  const root = await project();
  process.env.QMD_PROVER_VERIFIER = verifier;
  try {
    await writeFile(path.join(root, 'goal.qmd'), result('thm-main-render-disproof', 'Every integer is even.'));
    const created = await initializeWorkspace(root, '@thm-main-render-disproof', options);
    await writeFile(
      path.join(root, created.workspace, 'main-proof.qmd'),
      proof('thm-main-render-disproof', 'DISPROVED\n\nThe integer 1 satisfies the hypothesis | but is not even.')
    );
    const inspected = await inspectFact(root, '@thm-main-render-disproof', options);
    assert.equal(inspected.fact.status, 'workspace-disproved');

    const rendered = await renderProject(root, options);
    assert.equal(rendered.status, 'prepared');
    const statusQmd = await readFile(path.join(root, '.qmd-prover', 'generated', 'proof-status.qmd'), 'utf8');
    const graph = await readFile(path.join(root, '.qmd-prover', 'generated', 'dependencies.svg'), 'utf8');
    assert.match(statusQmd, /\| @thm-main-render-disproof \| disproved \| disproved \| global:/);
    assert.match(statusQmd, /hypothesis \\\| but is not even/);
    assert.match(graph, /local: disproved; global: disproved/);
    assert.match(graph, /The integer 1 satisfies the hypothesis \| but is not even/);
  } finally {
    delete process.env.QMD_PROVER_VERIFIER;
  }
});
