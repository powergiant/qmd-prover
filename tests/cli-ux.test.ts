import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { initializeWorkspace } from '../skills/qmd-prover/src/lib/workspace/initialize.js';
import { fakePandoc, here, options, project, result } from './support.js';

interface ProcessError extends Error { code?: string | number | null }
interface ProcessResult { error: ProcessError | null; stdout: string; stderr: string }

const cli = path.join(here, '..', 'skills', 'qmd-prover', 'scripts', 'qmd-prover.js');

function run(root: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<ProcessResult> {
  return new Promise((resolve) => execFile(process.execPath, [cli, ...args], { cwd: root, env },
    (error, stdout, stderr) => resolve({ error, stdout, stderr })));
}

test('CLI failures are stable JSON without stack traces and validate options before project scans', async () => {
  const root = await project();
  const unknown = await run(root, ['frobnicate']);
  assert.equal(unknown.error?.code, 1);
  assert.equal(JSON.parse(unknown.stdout).diagnostics[0].code, 'CLI_ERROR');
  assert.doesNotMatch(unknown.stderr, /\n\s+at /);

  const missingTools = { ...process.env, PATH: path.dirname(process.execPath), QMD_PROVER_PANDOC: 'missing-pandoc-for-ux-test' };
  const badLimit = await run(root, ['dependency', 'alternative', 'paths', '@a', '@b', '--limit', 'nope'], missingTools);
  assert.equal(badLimit.error?.code, 1);
  assert.match(JSON.parse(badLimit.stdout).diagnostics[0].message, /--limit must be an integer/);
  assert.doesNotMatch(badLimit.stdout, /PARSE_ERROR/);

  const badKind = await run(root, ['dependency', 'search', 'x', '--kind', 'nonsense'], missingTools);
  assert.equal(badKind.error?.code, 1);
  assert.match(JSON.parse(badKind.stdout).diagnostics[0].message, /--kind must be one of/);
});

test('doctor and verification list make prerequisites and submission IDs discoverable', async () => {
  const root = await project();
  const env = { ...process.env, PATH: path.dirname(process.execPath), QMD_PROVER_PANDOC: 'missing-pandoc-for-doctor-test' };
  const doctor = await run(root, ['doctor'], env);
  assert.equal(doctor.error?.code, 2);
  const health = JSON.parse(doctor.stdout);
  assert.equal(health.dependencies.node.available, true);
  assert.equal(health.dependencies.pandoc.available, false);
  assert.match(health.dependencies.pandoc.remediation, /QMD_PROVER_PANDOC/);

  const checks = path.join(root, '.qmd-prover', 'verification', 'checks');
  await mkdir(checks, { recursive: true });
  await writeFile(path.join(checks, 'record.json'), JSON.stringify({ submission_id: 'sub-visible', target: 'lem-visible', outcome: 'verified' }));
  const listed = await run(root, ['verification', 'list']);
  assert.equal(listed.error, null);
  assert.equal(JSON.parse(listed.stdout).submissions[0].submission_id, 'sub-visible');

  const shown = await run(root, ['verification', 'show', 'sub-visible']);
  assert.equal(shown.error, null);
  assert.equal(JSON.parse(shown.stdout).record.target, 'lem-visible');
  const missing = await run(root, ['verification', 'show', 'sub-missing']);
  assert.equal(missing.error?.code, 2);
  assert.equal(JSON.parse(missing.stdout).diagnostics[0].code, 'SUBMISSION_NOT_FOUND');
  assert.doesNotMatch(missing.stderr, /ENOENT|\n\s+at /);
});

test('workspace adoption preserves existing QMD and returns concrete parse blockers without writes', async () => {
  const root = await project();
  await writeFile(path.join(root, 'goal.qmd'), result('thm-main-adopt-ux', 'Adopt safely.'));
  const workspace = path.join(root, '.qmd-prover', 'workspaces', 'thm-main-adopt-ux');
  await mkdir(workspace, { recursive: true });
  const existingProgress = '# Existing progress\n\nDo not overwrite this.\n';
  await writeFile(path.join(workspace, 'progress.qmd'), existingProgress);
  await writeFile(path.join(workspace, 'attempt.qmd'), '# Existing attempt\n');
  const adopted = await initializeWorkspace(root, '@thm-main-adopt-ux', options);
  assert.equal(adopted.status, 'adopted');
  assert.equal(await readFile(path.join(workspace, 'progress.qmd'), 'utf8'), existingProgress);
  assert.equal((await stat(path.join(workspace, 'workspace.json'))).isFile(), true);

  const blockedRoot = await project();
  await writeFile(path.join(blockedRoot, 'goal.qmd'), result('thm-main-blocked-ux', 'Blocked safely.'));
  const blocked = await initializeWorkspace(blockedRoot, '@thm-main-blocked-ux', { pandoc: 'missing-pandoc-for-workspace-test' });
  assert.equal(blocked.status, 'blocked');
  assert.ok(blocked.diagnostics?.some((item) => item.code === 'PARSE_ERROR'));
  await assert.rejects(stat(path.join(blockedRoot, '.qmd-prover', 'workspaces', 'thm-main-blocked-ux', 'workspace.json')), /ENOENT/);
});

test('parse failures block mechanical checks, print source locations, and block render writes by default', async () => {
  const root = await project();
  await writeFile(path.join(root, 'goal.qmd'), result('thm-main-parse-ux', 'Parser required.'));
  const env = { ...process.env, QMD_PROVER_PANDOC: 'missing-pandoc-for-render-test' };
  const inspected = await run(root, ['inspect', 'fact', '@thm-main-parse-ux'], env);
  assert.equal(inspected.error?.code, 2);
  const inspection = JSON.parse(inspected.stdout);
  assert.equal(inspection.check.mechanical.status, 'fail');
  assert.equal(inspection.check.mechanical.reason, 'blocked-by-parse-error');

  const printed = await run(root, ['inspect', 'path', 'goal.qmd', '--print'], env);
  assert.equal(printed.error?.code, 2);
  assert.match(printed.stdout, /PARSE_ERROR goal\.qmd/);

  await writeFile(path.join(root, 'second.qmd'), result('thm-main-second-parse-ux', 'Parser also required.'));
  const printedProject = await run(root, ['inspect', 'project', '--print'], env);
  assert.equal(printedProject.error?.code, 2);
  assert.match(printedProject.stdout, /PARSE_ERROR \(2 locations\)/);
  assert.match(printedProject.stdout, /files: goal\.qmd, second\.qmd/);

  const rendered = await run(root, ['render'], env);
  assert.equal(rendered.error?.code, 2);
  assert.equal(JSON.parse(rendered.stdout).status, 'blocked');
  await assert.rejects(stat(path.join(root, '.qmd-prover', 'generated', 'proof-status.qmd')), /ENOENT/);

  const allowed = await run(root, ['render', '--allow-errors'], env);
  assert.equal(allowed.error, null);
  assert.equal(JSON.parse(allowed.stdout).status, 'prepared-with-errors');
  assert.equal((await stat(path.join(root, '.qmd-prover', 'generated', 'proof-status.qmd'))).isFile(), true);
});

test('dependency failures deduplicate IDs and distinguish uncomputed analysis from empty results', async () => {
  const root = await project();
  await writeFile(path.join(root, 'goal.qmd'), result('thm-main-dependency-ux', 'Parser required.'));
  const blocked = await run(root, ['dependency', 'cycles'], { ...process.env, QMD_PROVER_PANDOC: 'missing-pandoc-for-dependency-test' });
  assert.equal(blocked.error?.code, 2);
  const blockedOutput = JSON.parse(blocked.stdout);
  assert.equal(blockedOutput.computed, false);
  assert.equal(blockedOutput.cycles, undefined);
  assert.equal(blockedOutput.graph, undefined);

  const validRoot = await project();
  const same = await run(validRoot, ['dependency', 'path', '@unknown-same', '@unknown-same'], {
    ...process.env, QMD_PROVER_PANDOC: fakePandoc
  });
  assert.equal(same.error?.code, 2);
  assert.equal(JSON.parse(same.stdout).diagnostics.filter((item: { code: string }) => item.code === 'FACT_UNKNOWN').length, 1);
});
