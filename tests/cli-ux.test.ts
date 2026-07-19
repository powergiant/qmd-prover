import assert from 'node:assert/strict';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fakePandoc, here, project, result } from './support.js';

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

test('version reports engine versions and the compatibility gate warns without refusing on drift', async () => {
  const root = await project();

  // `version` is a project-independent identity command.
  const version = await run(root, ['version']);
  assert.equal(version.error, null);
  const engine = JSON.parse(version.stdout);
  assert.equal(engine.operation, 'version');
  assert.equal(typeof engine.tool, 'string');
  for (const field of ['schema_version', 'verifier_protocol_version', 'contract_version']) {
    assert.equal(typeof engine[field], 'number', `${field} is a number`);
  }

  // A project whose persisted state and contract were written by a different
  // engine: drift on all three axes.
  await writeFile(path.join(root, 'AGENTS.md'),
    'Local policy\n\n<!-- qmd-prover-contract:start version=1 -->\nold\n<!-- qmd-prover-contract:end -->\n');
  await mkdir(path.join(root, '.qmd-prover', 'graphs'), { recursive: true });
  await writeFile(path.join(root, '.qmd-prover', 'graphs', 'latest.json'),
    JSON.stringify({ schema_version: engine.schema_version - 1, snapshot_id: 'x', file: '.qmd-prover/graphs/x.json' }));
  await mkdir(path.join(root, '.qmd-prover', 'verification', 'checks'), { recursive: true });
  await writeFile(path.join(root, '.qmd-prover', 'verification', 'checks', 'a.json'),
    JSON.stringify({ checker_contract: { protocol: { name: 'qmd-prover-verify', version: engine.verifier_protocol_version - 1 } } }));

  // doctor surfaces the drift as data and never fails on it.
  const doctor = await run(root, ['doctor'], { ...process.env, PATH: path.dirname(process.execPath), QMD_PROVER_PANDOC: fakePandoc });
  const kinds = JSON.parse(doctor.stdout).compatibility.map((warning: { kind: string }) => warning.kind).sort();
  assert.deepEqual(kinds, ['contract', 'schema', 'verifier-protocol']);

  // A project command still runs (exit 2 is the domain result, not a refusal) and
  // prints the same drift as stderr warnings.
  const inspected = await run(root, ['dependency', 'cycles']);
  assert.match(inspected.stderr, /qmd-prover: warning: Project snapshot uses data schema v/);
  assert.match(inspected.stderr, /qmd-prover: warning: Project AGENTS\.md carries contract v1/);
  assert.match(inspected.stderr, /qmd-prover: warning: Cached verifier decisions use protocol v/);
});

test('install places the docs-only skill in the cwd project and reports activation guidance', async () => {
  const root = await project();
  const installed = await run(root, ['install']);
  assert.equal(installed.error, null);
  const outcome = JSON.parse(installed.stdout);
  assert.equal(outcome.operation, 'install-skill');
  assert.equal(outcome.scope, 'local');
  // Runs in the cwd, so a bare (local) install targets that project — not the qmd-prover repo.
  // realpath resolves the macOS /var -> /private/var symlink that process.cwd() reports.
  const realRoot = await import('node:fs/promises').then((fs) => fs.realpath(root));
  assert.equal(outcome.destination, path.join(realRoot, '.claude', 'skills', 'qmd-prover'));

  const entries = await import('node:fs/promises').then((fs) => fs.readdir(outcome.destination));
  assert.ok(entries.includes('SKILL.md'), 'skill docs copied');
  assert.ok(!entries.includes('scripts') && !entries.includes('src'), 'engine is not bundled into the skill');

  // The activation gotcha is surfaced, not silently assumed away.
  const actions = (outcome.next_actions as Array<{ action: string }>).map((entry) => entry.action);
  assert.deepEqual(actions, ['use-now', 'activate-later']);

  // --dir requires a path, and --dir is incompatible with a global install.
  assert.match(JSON.parse((await run(root, ['install', '--dir'])).stdout).diagnostics[0].message, /--dir requires a path/);
  assert.match(JSON.parse((await run(root, ['install', '--global', '--dir', root])).stdout).diagnostics[0].message, /--dir applies only to a local/);
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
