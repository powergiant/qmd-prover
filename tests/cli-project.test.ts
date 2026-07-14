import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { HELP_COMMANDS } from '../skills/qmd-prover/src/lib/application/help.js';
import { initializeProject } from '../skills/qmd-prover/src/lib/application/project.js';
import { readExternalPolicy } from '../skills/qmd-prover/src/lib/infrastructure/external.js';
import { bareProject, fakePandoc, here, must, options, proof, result, verifier } from './support.js';

interface CliError extends Error { code?: string | number | null }
interface CliProcessResult { error: CliError | null; stdout: string; stderr: string }
interface CliJsonResult {
  fact: { id: string };
  scope: { type: string; path: string };
  operation: string;
}

test('project initialization inventories external policy, adopts, preserves, appends, and synchronizes safely', async () => {
  const canonicalSource = await readFile(path.join(here, '..', 'skills', 'qmd-prover', 'references', 'AGENTS.md'), 'utf8');
  const canonicalBlock = must(canonicalSource.match(/<!-- qmd-prover-contract:start version=12 -->[\s\S]*?<!-- qmd-prover-contract:end -->/))[0];

  const fresh = await bareProject();
  const created = await initializeProject(fresh);
  assert.deepEqual({ ok: created.ok, status: created.status, version: created.contract_version }, { ok: true, status: 'created', version: 12 });
  assert.equal(must(created.existing).external_policy.mode, 'unrestricted');
  assert.equal(created.workspace_root, '.qmd-prover/workspaces');
  assert.equal((await stat(path.join(fresh, '.qmd-prover', 'workspaces'))).isDirectory(), true);
  assert.match(await readFile(path.join(fresh, 'AGENTS.md'), 'utf8'), /## Project-specific additions/);
  assert.equal((await initializeProject(fresh)).status, 'already-initialized');

  const emptyPolicy = await bareProject();
  await writeFile(path.join(emptyPolicy, 'AGENTS.md'), '  \n');
  assert.equal((await initializeProject(emptyPolicy)).status, 'created');

  const external = await bareProject();
  await mkdir(path.join(external, '.qmd-prover'));
  await writeFile(path.join(external, '.qmd-prover', '.external.qmd'), '  \n');
  assert.equal(must((await initializeProject(external)).existing).external_policy.mode, 'none');
  await writeFile(path.join(external, '.qmd-prover', '.external.qmd'), 'Standard ZFC may be used.\n');
  assert.deepEqual(await readExternalPolicy(external), {
    path: '.qmd-prover/.external.qmd', mode: 'declared', content: 'Standard ZFC may be used.\n'
  });

  const blankPolicyProject = await bareProject();
  await writeFile(path.join(blankPolicyProject, 'AGENTS.md'), '\n');
  await writeFile(path.join(blankPolicyProject, 'existing.qmd'), '# Existing mathematics\n');
  const blankIntent = await initializeProject(blankPolicyProject);
  assert.equal(blankIntent.status, 'intent-required');
  assert.equal(await readFile(path.join(blankPolicyProject, 'AGENTS.md'), 'utf8'), '\n');
  assert.equal((await initializeProject(blankPolicyProject, { adoptExisting: true })).status, 'adopted');

  const partial = await bareProject();
  await mkdir(path.join(partial, 'theory'));
  await writeFile(path.join(partial, '_quarto.yml'), 'project:\n  type: website\n');
  await writeFile(path.join(partial, 'theory', 'existing.qmd'), '# Existing mathematics\n');
  const intentRequired = await initializeProject(partial);
  assert.deepEqual({ ok: intentRequired.ok, status: intentRequired.status }, { ok: false, status: 'intent-required' });
  assert.deepEqual(must(intentRequired.existing).quarto_configs, ['_quarto.yml']);
  assert.deepEqual(must(intentRequired.existing).qmd_files, ['theory/existing.qmd']);
  await assert.rejects(readFile(path.join(partial, 'AGENTS.md')), { code: 'ENOENT' });
  await assert.rejects(stat(path.join(partial, '.qmd-prover')), { code: 'ENOENT' });
  assert.equal((await initializeProject(partial, { adoptExisting: true })).status, 'adopted');
  assert.equal(await readFile(path.join(partial, 'theory', 'existing.qmd'), 'utf8'), '# Existing mathematics\n');

  const existing = await bareProject();
  const localPolicy = '# Existing project policy\n\n- Preserve this rule.\n';
  await writeFile(path.join(existing, 'AGENTS.md'), localPolicy);
  const appendRequired = await initializeProject(existing);
  assert.equal(appendRequired.status, 'append-required');
  assert.equal(appendRequired.ok, false);
  assert.equal(await readFile(path.join(existing, 'AGENTS.md'), 'utf8'), localPolicy);
  assert.equal((await initializeProject(existing, { appendContract: true })).status, 'appended');
  const appended = await readFile(path.join(existing, 'AGENTS.md'), 'utf8');
  assert.ok(appended.startsWith(localPolicy));
  assert.ok(appended.includes(canonicalBlock));

  const stale = await bareProject();
  const oldBlock = canonicalBlock.replace('version=12', 'version=1');
  await writeFile(path.join(stale, 'AGENTS.md'), `# Local before\n\n${oldBlock}\n\n## Local after\n`);
  const syncRequired = await initializeProject(stale);
  assert.deepEqual({ ok: syncRequired.ok, status: syncRequired.status, current: syncRequired.current_contract_version }, { ok: false, status: 'sync-required', current: 1 });
  assert.equal((await initializeProject(stale, { syncContract: true })).status, 'synchronized');
  const synchronized = await readFile(path.join(stale, 'AGENTS.md'), 'utf8');
  assert.match(synchronized, /^# Local before/);
  assert.match(synchronized, /## Local after\n$/);
  assert.ok(synchronized.includes(canonicalBlock));
  assert.doesNotMatch(synchronized, /version=1 -->/);

  const malformed = await bareProject();
  const malformedSource = 'Local policy\n\n<!-- qmd-prover-contract:start version=12 -->\nUnclosed contract\n';
  await writeFile(path.join(malformed, 'AGENTS.md'), malformedSource);
  const malformedResult = await initializeProject(malformed);
  assert.equal(malformedResult.status, 'malformed-contract');
  assert.equal(await readFile(path.join(malformed, 'AGENTS.md'), 'utf8'), malformedSource);

  await assert.rejects(
    initializeProject(await bareProject(), { adoptExisting: true, appendContract: true }),
    /init accepts only one of/
  );
});

test('dispatcher preserves JSON commands and adds workspace operations', async () => {
  const root = await bareProject();
  const cli = path.join(here, '..', 'skills', 'qmd-prover', 'scripts', 'qmd-prover.js');
  const initialized = await new Promise<{ status: string; contract_version: number; workspace_root: string }>((resolve, reject) => execFile(process.execPath, [cli, 'init'], {
    cwd: root
  }, (error, stdout, stderr) => error ? reject(error) : resolve(JSON.parse(stdout))));
  assert.equal(initialized.status, 'created');
  assert.equal(initialized.contract_version, 12);
  assert.equal(initialized.workspace_root, '.qmd-prover/workspaces');
  const policyRoot = await bareProject();
  await writeFile(path.join(policyRoot, 'AGENTS.md'), '# Existing policy\n');
  const guarded = await new Promise<{ error: CliError | null; output: { ok: boolean; status: string } }>((resolve) => execFile(process.execPath, [cli, 'init'], {
    cwd: policyRoot
  }, (error, stdout) => resolve({ error, output: JSON.parse(stdout) })));
  assert.equal(must(guarded.error).code, 2);
  assert.deepEqual({ ok: guarded.output.ok, status: guarded.output.status }, { ok: false, status: 'append-required' });
  await chmod(fakePandoc, 0o755);
  await writeFile(path.join(root, 'goal.qmd'), result('thm-main-cli', 'CLI statement.', { proofText: 'The statement follows directly.' }));
  const run = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => execFile(process.execPath, [cli, 'inspect', 'project'], {
    cwd: root, env: { ...process.env, QMD_PROVER_PANDOC: fakePandoc, QMD_PROVER_VERIFIER: verifier }
  }, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr })));
  const jsonInspection = JSON.parse(run.stdout);
  assert.equal(jsonInspection.summary.goals[0].id, 'thm-main-cli');
  const cliEnv = { ...process.env, QMD_PROVER_PANDOC: fakePandoc, QMD_PROVER_VERIFIER: verifier };
  const runJson = (args: string[]) => new Promise<CliJsonResult>((resolve, reject) => execFile(process.execPath, [cli, ...args], {
    cwd: root, env: cliEnv
  }, (error, stdout) => error ? reject(error) : resolve(JSON.parse(stdout))));
  assert.equal((await runJson(['inspect', 'fact', '@thm-main-cli'])).fact.id, 'thm-main-cli');
  assert.deepEqual((await runJson(['inspect', 'path', 'goal.qmd'])).scope, { type: 'file', path: 'goal.qmd' });
  assert.equal((await runJson(['dependency', 'reverse', 'dependencies', '@thm-main-cli'])).operation, 'dependency-reverse-dependencies');
  assert.equal((await runJson(['dependency', 'alternative', 'paths', '@thm-main-cli', '@thm-main-cli'])).operation, 'dependency-alternative-paths');
  assert.equal((await runJson(['dependency', 'unused', 'imports'])).operation, 'dependency-unused-imports');
  assert.equal((await runJson(['dependency', 'unused', 'exports'])).operation, 'dependency-unused-exports');
  assert.equal((await runJson(['dependency', 'ready', 'for', 'ai'])).operation, 'dependency-ready-for-ai');
  assert.equal((await runJson(['check', 'staleness'])).operation, 'check-staleness');
  const printed = await new Promise<string>((resolve, reject) => execFile(process.execPath, [cli, 'inspect', 'project', '--print'], {
    cwd: root, env: { ...process.env, QMD_PROVER_PANDOC: fakePandoc, QMD_PROVER_VERIFIER: verifier }
  }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  assert.match(printed, new RegExp(`snapshot: ${jsonInspection.snapshot_id}`));
  const workspace = await new Promise<{ status: string }>((resolve, reject) => execFile(process.execPath, [cli, 'workspace', 'init', '@thm-main-cli'], {
    cwd: root, env: { ...process.env, QMD_PROVER_PANDOC: fakePandoc, QMD_PROVER_VERIFIER: verifier }
  }, (error, stdout) => error ? reject(error) : resolve(JSON.parse(stdout))));
  assert.equal(workspace.status, 'created');
  await writeFile(path.join(root, 'duplicate.qmd'), result('thm-main-cli', 'Duplicate.'));
  const failed = await new Promise<{ error: CliError | null; stdout: string }>((resolve) => execFile(process.execPath, [cli, 'inspect', 'project'], {
    cwd: root, env: { ...process.env, QMD_PROVER_PANDOC: fakePandoc, QMD_PROVER_VERIFIER: verifier }
  }, (error, stdout) => resolve({ error, stdout })));
  assert.equal(must(failed.error).code, 2);
  assert.equal(JSON.parse(failed.stdout).ok, false);
});

test('dispatcher provides help for every command group and leaf', async () => {
  const cli = path.join(here, '..', 'skills', 'qmd-prover', 'scripts', 'qmd-prover.js');
  const run = (args: string[]) => new Promise<CliProcessResult>((resolve) => execFile(process.execPath, [cli, ...args], (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  const commands = [
    'init',
    'inspect', 'inspect project', 'inspect fact', 'inspect path',
    'dependency', 'dependency dependencies', 'dependency reverse', 'dependency reverse dependencies',
    'dependency impact', 'dependency frontier', 'dependency path', 'dependency alternative', 'dependency alternative paths',
    'dependency cycles', 'dependency findings', 'dependency unused', 'dependency unused imports', 'dependency unused exports',
    'dependency isolated', 'dependency unreachable', 'dependency ready', 'dependency ready for', 'dependency ready for ai',
    'dependency reused', 'dependency search',
    'check', 'check staleness',
    'workspace', 'workspace init', 'workspace inspect',
    'submit', 'submit proof',
    'verification', 'verification show', 'verification revoke',
    'render'
  ];
  const rootHelp = await run(['help']);
  assert.equal(rootHelp.error, null);
  assert.match(rootHelp.stdout, /^Usage:\n/);
  assert.match(rootHelp.stdout, /Commands:\n  init\n    Initialize or safely adopt a qmd-prover project\.\n  inspect\n  dependency/);
  assert.ok(HELP_COMMANDS.every((item) => (['description', 'arguments', 'options', 'examples', 'notes'] as const).every((section) => Array.isArray(item.sections[section]))));
  for (const command of commands) {
    const result = await run([...command.split(' '), 'help']);
    assert.equal(result.error, null, `${command} help failed: ${result.stderr}`);
    assert.match(result.stdout, /^Usage:\n/);
    assert.match(result.stdout, new RegExp(`qmd-prover ${command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
  const inspectHelp = await run(['inspect', 'help']);
  assert.match(inspectHelp.stdout, /Commands:\n  project\n  fact\n  path/);
  const initHelp = await run(['init', '--help']);
  assert.match(initHelp.stdout, /Description:\n  Initialize the qmd-prover project contract/);
  assert.match(initHelp.stdout, /Arguments:\n  This command accepts no positional arguments\./);
  assert.match(initHelp.stdout, /Options:[\s\S]*--adopt-existing[\s\S]*--append-contract[\s\S]*--sync-contract/);
  assert.match(initHelp.stdout, /Notes:[\s\S]*Use at most one mutation option/);
  assert.equal((await run(['help', 'inspect', 'fact'])).error, null);
  assert.equal((await run(['inspect', 'fact', '--help'])).error, null);
  assert.equal((await run(['inspect', 'fact', '-h'])).error, null);
  const removed = await run(['inspect-project', '--help']);
  assert.equal(must(removed.error).code, 1);
  assert.match(removed.stderr, /Unknown command: inspect-project/);
  const removedDependency = await run(['dependency', 'alternative-paths', '--help']);
  assert.equal(must(removedDependency.error).code, 1);
  assert.match(removedDependency.stderr, /Unknown command: dependency alternative-paths/);
  const removedInit = await run(['init', 'project', '--help']);
  assert.equal(must(removedInit.error).code, 1);
  assert.match(removedInit.stderr, /Unknown command: init project/);
  const removedTheoremHelp = await run(['inspect', 'theorem', '--help']);
  assert.equal(must(removedTheoremHelp.error).code, 1);
  assert.match(removedTheoremHelp.stderr, /Unknown command: inspect theorem/);
  const removedTheorem = await run(['inspect', 'theorem', '@thm-main-id']);
  assert.equal(must(removedTheorem.error).code, 1);
  assert.match(removedTheorem.stderr, /inspect requires project, fact, or path/);

  const skillRoot = path.join(here, '..', 'skills', 'qmd-prover');
  await assert.rejects(stat(path.join(skillRoot, 'src', 'qmd-prover.mts')), { code: 'ENOENT' });
  await assert.rejects(stat(path.join(skillRoot, 'scripts', 'qmd-prover.mjs')), { code: 'ENOENT' });
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
  assert.match(skill, /Do not impose a fixed mathematical strategy/);
  assert.match(skill, /workspace init @thm-main-ID/);
  assert.match(skill, /asks to initialize qmd-prover/);
  assert.match(skill, /init --append-contract/);
  assert.match(skill, /init --sync-contract/);
  assert.match(contract, /<!-- qmd-prover-contract:start version=12 -->/);
  assert.match(contract, /\.qmd-prover\/\.external\.qmd/);
  assert.match(contract, /file absent \| External results are unrestricted/);
  assert.match(contract, /file present but whitespace-only \| Use no external mathematical results/);
  assert.match(contract, /<!-- qmd-prover-contract:end -->/);
  assert.match(contract, /name="Uniform index theorem"/);
  assert.match(contract, /\.proof of="thm-main-uniform-index"/);
  assert.match(contract, /qmd-prover:\n  imports:/);
  assert.match(contract, /\| `\.definition` \| `def-\*` \|/);
  assert.match(contract, /\| `\.lemma` \| `lem-\*` \|/);
  assert.match(contract, /\| `\.proposition` \| `prp-\*` \|/);
  assert.match(contract, /\| `\.theorem` \| `thm-\*` \|/);
  assert.match(contract, /\| `\.corollary` \| `cor-\*` \|/);
  assert.match(contract, /\| `\.theorem \.goal` \| `thm-main-\*` \|/);
  assert.match(contract, /ISO introduction `date`/);
  assert.match(contract, /`OPEN`/);
  assert.match(contract, /`REJECTED`/);
  assert.match(contract, /`REVOKED`/);
  assert.match(contract, /configured external independent verifier/);
  assert.match(contract, /Prefer `inspect fact` or `inspect path`/);
  assert.match(contract, /last nonempty paragraph of the definition block/);
  assert.match(contract, /`workspace-verified` result is established only inside that provisional workspace snapshot/);
  assert.match(contract, /does not prescribe a fixed proof workflow/);
  assert.match(contract, /does not establish compliance by itself/);
  assert.match(contract, /qmd-prover\.js" init/);
  assert.match(contract, /intent-required/);
  assert.match(contract, /\.qmd-prover\/workspaces\/<thm-main-ID>\//);
  assert.match(contract, /canonical QMD as read-only/);
  assert.doesNotMatch(contract, /For each requested goal:/);
  assert.doesNotMatch(contract, /### Uses/);
  assert.match(contract, /Project-specific additions/);
});
