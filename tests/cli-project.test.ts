import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { initializeProject } from '../skills/qmd-prover/src/commands/init/index.js';
import { readExternalPolicy } from '../skills/qmd-prover/src/core/infrastructure/external.js';
import { bareProject, fakePandoc, here, must, proof, result, verifier } from './support.js';

interface CliError extends Error { code?: string | number | null }
interface CliProcessResult { error: CliError | null; stdout: string; stderr: string }
interface CliJsonResult {
  fact: { id: string; status?: string; disproof?: { refutation: string } };
  graph?: { nodes: Array<{ id: string; status: string; disproof?: { refutation: string } }> };
  scope: { type: string; path: string };
  operation: string;
}

test('project initialization inventories external policy, adopts, preserves, appends, and synchronizes safely', async () => {
  const canonicalSource = await readFile(path.join(here, '..', 'skills', 'qmd-prover', 'references', 'AGENTS.md'), 'utf8');
  const canonicalBlock = must(canonicalSource.match(/<!-- qmd-prover-contract:start version=21 -->[\s\S]*?<!-- qmd-prover-contract:end -->/))[0];

  const fresh = await bareProject();
  const created = await initializeProject(fresh);
  assert.deepEqual({ ok: created.ok, status: created.status, version: created.contract_version }, { ok: true, status: 'created', version: 21 });
  assert.equal(must(created.existing).external_policy.mode, 'unrestricted');
  assert.equal(created.workspace_root, undefined);
  await assert.rejects(stat(path.join(fresh, '.qmd-prover', 'workspaces')), { code: 'ENOENT' });
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
  const oldBlock = canonicalBlock.replace("version=21", "version=1");
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
  const malformedSource = 'Local policy\n\n<!-- qmd-prover-contract:start version=21 -->\nUnclosed contract\n';
  await writeFile(path.join(malformed, 'AGENTS.md'), malformedSource);
  const malformedResult = await initializeProject(malformed);
  assert.equal(malformedResult.status, 'malformed-contract');
  assert.equal(await readFile(path.join(malformed, 'AGENTS.md'), 'utf8'), malformedSource);

  await assert.rejects(
    initializeProject(await bareProject(), { adoptExisting: true, appendContract: true }),
    /init accepts only one of/
  );
});

test('dispatcher preserves JSON commands over the unified project', async () => {
  const root = await bareProject();
  const cli = path.join(here, '..', 'skills', 'qmd-prover', 'scripts', 'qmd-prover.js');
  const initialized = await new Promise<{ status: string; contract_version: number; workspace_root?: string }>((resolve, reject) => execFile(process.execPath, [cli, 'init'], {
    cwd: root
  }, (error, stdout, stderr) => error ? reject(error) : resolve(JSON.parse(stdout))));
  assert.equal(initialized.status, 'created');
  assert.equal(initialized.contract_version, 21);
  assert.equal(initialized.workspace_root, undefined);
  const policyRoot = await bareProject();
  await writeFile(path.join(policyRoot, 'AGENTS.md'), '# Existing policy\n');
  const guarded = await new Promise<{ error: CliError | null; output: { ok: boolean; status: string } }>((resolve) => execFile(process.execPath, [cli, 'init'], {
    cwd: policyRoot
  }, (error, stdout) => resolve({ error, output: JSON.parse(stdout) })));
  assert.equal(must(guarded.error).code, 2);
  assert.deepEqual({ ok: guarded.output.ok, status: guarded.output.status }, { ok: false, status: 'append-required' });
  await chmod(fakePandoc, 0o755);
  await writeFile(path.join(root, 'goal.qmd'), result('thm-main-cli', 'CLI statement.'));
  await mkdir(path.join(root, 'workspace'), { recursive: true });
  await writeFile(path.join(root, 'workspace', 'main-proof.qmd'), proof('thm-main-cli', 'The statement follows directly.'));
  const run = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => execFile(process.execPath, [cli, 'inspect', 'project'], {
    cwd: root, env: { ...process.env, QMD_PROVER_PANDOC: fakePandoc, QMD_PROVER_VERIFIER: verifier }
  }, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr })));
  const jsonInspection = JSON.parse(run.stdout);
  assert.equal(jsonInspection.goals[0].id, 'thm-main-cli');
  const cliEnv = { ...process.env, QMD_PROVER_PANDOC: fakePandoc, QMD_PROVER_VERIFIER: verifier };
  const runJson = (args: string[]) => new Promise<CliJsonResult>((resolve, reject) => execFile(process.execPath, [cli, ...args], {
    cwd: root, env: cliEnv
  }, (error, stdout) => error ? reject(error) : resolve(JSON.parse(stdout))));
  assert.equal((await runJson(['inspect', 'fact', '@thm-main-cli'])).fact.id, 'thm-main-cli');
  assert.deepEqual((await runJson(['inspect', 'path', 'goal.qmd'])).scope, { type: 'file', path: 'goal.qmd' });
  assert.deepEqual((await runJson(['inspect', 'path', 'workspace'])).scope, { type: 'folder', path: 'workspace' });
  assert.equal((await runJson(['dependency', 'reverse', 'dependencies', '@thm-main-cli'])).operation, 'dependency-reverse-dependencies');
  assert.equal((await runJson(['dependency', 'alternative', 'paths', '@thm-main-cli', '@thm-main-cli'])).operation, 'dependency-alternative-paths');
  assert.equal((await runJson(['dependency', 'unused', 'imports'])).operation, 'dependency-unused-imports');
  assert.equal((await runJson(['dependency', 'unused', 'exports'])).operation, 'dependency-unused-exports');
  assert.equal((await runJson(['dependency', 'ready', 'for', 'ai'])).operation, 'dependency-ready-for-ai');
  assert.equal((await runJson(['check', 'staleness'])).operation, 'check-staleness');
  const unknown = await new Promise<{ error: CliError | null; output: { ok: boolean; diagnostics: Array<{ code: string }> } }>((resolve) => execFile(process.execPath, [cli, 'inspect', 'fact', '@def-missing-cli'], {
    cwd: root, env: cliEnv
  }, (error, stdout) => resolve({ error, output: JSON.parse(stdout) })));
  assert.equal(must(unknown.error).code, 2);
  assert.equal(unknown.output.ok, false);
  assert.equal(unknown.output.diagnostics[0]?.code, 'FACT_UNKNOWN');
  const runFailure = (args: string[]) => new Promise<CliProcessResult>((resolve) => execFile(process.execPath, [cli, ...args], {
    cwd: root, env: cliEnv
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  const removedWorkspaceInspect = await runFailure(['inspect', 'workspace', '@thm-main-cli']);
  assert.equal(must(removedWorkspaceInspect.error).code, 1);
  assert.match(removedWorkspaceInspect.stderr, /inspect requires project, fact, or path/);
  const removedWorkspace = await runFailure(['workspace', 'init', '@thm-main-cli']);
  assert.equal(must(removedWorkspace.error).code, 1);
  assert.match(removedWorkspace.stderr, /Unknown command: workspace/);
  const removedSubmit = await runFailure(['submit', 'proof', 'missing.qmd']);
  assert.equal(must(removedSubmit.error).code, 1);
  assert.match(removedSubmit.stderr, /Unknown command: submit/);
  const printed = await new Promise<string>((resolve, reject) => execFile(process.execPath, [cli, 'inspect', 'project', '--print'], {
    cwd: root, env: { ...process.env, QMD_PROVER_PANDOC: fakePandoc, QMD_PROVER_VERIFIER: verifier }
  }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  assert.match(printed, new RegExp(`snapshot: ${jsonInspection.snapshot_id}`));
  await writeFile(
    path.join(root, 'workspace', 'main-proof.qmd'),
    proof('thm-main-cli', 'DISPROVED\n\nThis verifier fixture checks the proposed counterexample.')
  );
  // --graph retains the subgraph so the graph-node assertion below still resolves;
  // fact.status and fact.disproof are present in the lean default JSON regardless.
  const disproved = await runJson(['inspect', 'fact', '@thm-main-cli', '--graph']);
  assert.equal(disproved.fact.status, 'disproved');
  assert.match(disproved.fact.disproof?.refutation ?? '', /proposed counterexample/);
  assert.equal(disproved.graph?.nodes.find((node) => node.id === 'thm-main-cli')?.status, 'disproved');
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
    'doctor',
    'init',
    'inspect', 'inspect project', 'inspect fact', 'inspect path',
    'dependency', 'dependency dependencies', 'dependency reverse', 'dependency reverse dependencies',
    'dependency impact', 'dependency frontier', 'dependency path', 'dependency alternative', 'dependency alternative paths',
    'dependency cycles', 'dependency findings', 'dependency unused', 'dependency unused imports', 'dependency unused exports',
    'dependency isolated', 'dependency unreachable', 'dependency ready', 'dependency ready for', 'dependency ready for ai',
    'dependency reused', 'dependency search',
    'check', 'check staleness',
    'verification', 'verification list', 'verification show',
    'render'
  ];
  const rootHelp = await run(['help']);
  assert.equal(rootHelp.error, null);
  assert.match(rootHelp.stdout, /^Usage:\n/);
  assert.match(rootHelp.stdout, /Commands:\n  doctor[\s\S]*  init\n    Initialize or safely adopt a qmd-prover project\.\n  inspect\n  dependency/);
  // Every leaf command (one with no further sub-command) documents a purpose under Description;
  // every group instead lists its sub-commands under Commands.
  const leaves = commands.filter((item) => !commands.some((candidate) => candidate.startsWith(`${item} `)));
  for (const command of commands) {
    const result = await run([...command.split(' '), 'help']);
    assert.equal(result.error, null, `${command} help failed: ${result.stderr}`);
    assert.match(result.stdout, /^Usage:\n/);
    assert.match(result.stdout, new RegExp(`qmd-prover ${command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    if (leaves.includes(command)) assert.match(result.stdout, /\nDescription:\n/, `${command} help needs a purpose`);
    else assert.match(result.stdout, /\nCommands:\n/, `${command} group help needs a command list`);
  }
  const inspectHelp = await run(['inspect', 'help']);
  assert.match(inspectHelp.stdout, /Commands:[\s\S]*  project[\s\S]*  fact[\s\S]*  path/);
  assert.doesNotMatch(inspectHelp.stdout, /workspace/);
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
  const removedWorkspaceHelp = await run(['workspace', 'help']);
  assert.equal(must(removedWorkspaceHelp.error).code, 1);
  assert.match(removedWorkspaceHelp.stderr, /Unknown command: workspace/);
  const removedSubmitHelp = await run(['submit', 'proof', '--help']);
  assert.equal(must(removedSubmitHelp.error).code, 1);
  assert.match(removedSubmitHelp.stderr, /Unknown command: submit proof/);
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
  const [skill, contract, examplePolicy, cliReference] = await Promise.all([
    readFile(path.join(skillRoot, 'SKILL.md'), 'utf8'),
    readFile(path.join(skillRoot, 'references', 'AGENTS.md'), 'utf8'),
    readFile(path.join(here, '..', 'examples', 'godel-completeness', 'AGENTS.md'), 'utf8'),
    readFile(path.join(skillRoot, 'references', 'cli.md'), 'utf8')
  ]);
  assert.match(skill, /same unchanged agent\/project context/);
  assert.match(skill, /Stop and ask before creating, appending, or synchronizing project policy/);
  assert.match(skill, /workspace\/` folder/);
  assert.match(skill, /Complete leaf-command map/);
  assert.match(skill, /doctor \[--print\]/);
  assert.match(skill, /dependency alternative paths @FROM @TO/);
  assert.match(skill, /verification list/);
  assert.match(skill, /render \[--allow-errors\]/);
  assert.match(skill, /An `@id` citation is a dependency but does not grant cross-file scope/);
  assert.match(skill, /global status is `verified`/);
  assert.doesNotMatch(skill, /workspace init|inspect workspace|submit proof/);
  assert.match(contract, /<!-- qmd-prover-contract:start version=21 -->/);
  assert.match(contract, /\.qmd-prover\/\.external\.qmd/);
  assert.match(contract, /An absent file permits external mathematics/);
  assert.match(contract, /a whitespace-only file permits none/);
  assert.match(contract, /<!-- qmd-prover-contract:end -->/);
  assert.match(contract, /qmd-prover:\n  imports:/);
  assert.match(contract, /export="<same-ID>"/);
  assert.match(contract, /`from` is relative to the consumer/);
  assert.match(contract, /\| `\.definition` \| `def-\*` \|/);
  assert.match(contract, /\| `\.lemma` \| `lem-\*` \|/);
  assert.match(contract, /\| `\.proposition` \| `prp-\*` \|/);
  assert.match(contract, /\| `\.theorem` \| `thm-\*` \|/);
  assert.match(contract, /\| `\.corollary` \| `cor-\*` \|/);
  assert.match(contract, /IDs begin `thm-main-`;.*classes `\.theorem \.goal`/);
  assert.match(contract, /ISO `date`/);
  assert.match(contract, /`OPEN`/);
  assert.match(contract, /`REJECTED`/);
  assert.match(contract, /`DISPROVED`/);
  assert.match(contract, /`REVOKED`/);
  assert.match(contract, /Machine dependency analysis and local AI verification have separate state/);
  assert.match(contract, /narrow fact or path inspection verifies only the selected facts/);
  assert.match(contract, /globally verified exactly when every direct dependency is globally verified/);
  assert.match(contract, /qmd-prover\.js" init/);
  assert.match(contract, /workspace\/` folder/);
  assert.match(contract, /never a semantic boundary/);
  assert.match(contract, /globally unique across the project/);
  assert.match(contract, /command diagnostics, not source markers/);
  assert.doesNotMatch(contract, /`(?:GLOBAL_DUPLICATE_ID|DUPLICATE_ID|WORKSPACE_UNINITIALIZED|WORKSPACE_MISSING|PARSE_ERROR|FACT_UNKNOWN)`/);
  assert.doesNotMatch(contract, /\.qmd-prover\/workspaces/);
  assert.match(contract, /check staleness` is read-only/);
  assert.match(contract, /Project-specific additions/);
  const managed = must(contract.match(/<!-- qmd-prover-contract:start version=21 -->[\s\S]*?<!-- qmd-prover-contract:end -->/))[0];
  assert.equal(must(examplePolicy.match(/<!-- qmd-prover-contract:start version=21 -->[\s\S]*?<!-- qmd-prover-contract:end -->/))[0], managed);
  assert.match(cliReference, /### Diagnostic codes/);
  assert.match(cliReference, /not a QMD class, attribute, status marker/);
  assert.match(cliReference, /`DUPLICATE_ID`/);
  assert.doesNotMatch(cliReference, /WORKSPACE_/);
  assert.match(cliReference, /`disproved`/);
});

test('maintainer and agent documentation preserves the full design structure', async () => {
  const root = path.join(here, '..');
  const files = {
    architecture: await readFile(path.join(root, 'docs', 'architecture.md'), 'utf8'),
    design: await readFile(path.join(root, 'docs', 'design.md'), 'utf8'),
    discipline: await readFile(path.join(root, 'docs', 'design-discipline.md'), 'utf8'),
    inspector: await readFile(path.join(root, 'docs', 'design-inspector.md'), 'utf8'),
    proving: await readFile(path.join(root, 'docs', 'design-proving.md'), 'utf8'),
    rendering: await readFile(path.join(root, 'docs', 'design-rendering.md'), 'utf8'),
    skill: await readFile(path.join(root, 'skills', 'qmd-prover', 'SKILL.md'), 'utf8'),
    contract: await readFile(path.join(root, 'skills', 'qmd-prover', 'references', 'AGENTS.md'), 'utf8'),
    cli: await readFile(path.join(root, 'skills', 'qmd-prover', 'references', 'cli.md'), 'utf8')
  };

  const outsideFences = (source: string): string => source
    .split(/^```.*$/m)
    .filter((_part, index) => index % 2 === 0)
    .join('\n');
  const requireHeadings = (source: string, headings: string[]): void => {
    const prose = outsideFences(source);
    let previous = -1;
    for (const heading of headings) {
      const current = prose.indexOf(heading);
      assert.ok(current > previous, `missing or out-of-order documentation heading: ${heading}`);
      previous = current;
    }
  };

  requireHeadings(files.architecture, [
    '## Module layout', '## Dependency direction', '## Larger workflows', '## Safety invariants'
  ]);
  requireHeadings(files.design, [
    '## Purpose', '## Components', '## System boundary', '## Mathematical project model',
    '### Example: one theorem after prolonged work', '### Project dependency model',
    '### Retention instead of canonical promotion', '## Semantic QMD and inspection',
    '### Complete semantic QMD example', '### Inspection scopes', '### Three inspection layers', '### Dependency analysis and search',
    '### Staleness and transitive invalidation', '## How agents use the infrastructure',
    '## Installation and requirements', '## Starting a mathematical project',
    '## Using qmd-prover through Codex or Claude Code', '## Using the Node utilities directly',
    '## Rendering with Quarto', '## Further design documents'
  ]);
  requireHeadings(files.discipline, [
    '## Role', '## Canonical and local policy', '### Example: project-local policy',
    '## External mathematical basis', '## Rule categories', '### Mechanically enforceable rules',
    '### Locally mathematically judged rules', '### Agent conduct rules', '## Semantic scope',
    '## Recognized block types', '### Definition block', '### Lemma block',
    '### Proposition block', '### Theorem block', '### Corollary block',
    '### Main-goal theorem block', '### Proof block',
    '### Example: semantic and nonsemantic references', '## Change process'
  ]);
  requireHeadings(files.inspector, [
    '## Role', '### Diagnostics versus QMD source',
    '## 1. Inspect a theorem, lemma, or definition', '### Select and parse the fact',
    '### Build the mechanical graph', '### Check one conditional step with AI',
    '### Compose global state and record evidence', '### Construct the related dependency graph',
    '## 2. Inspect a file or folder', '### Source discovery', '### Aggregate checks',
    '### Aggregate dependency graph', '## 3. Inspect the project',
    '### Project discovery', '### Project checks', '### Project dependency graph',
    '## 4. Analyze and search the dependency graph', '### Dependency queries',
    '### Find the proof frontier', '### Additional graph findings', '### Search',
    '## 5. Check staleness', '### Cache accepted identities',
    '### Compare current mathematics with the cache', '### Report transitive invalidation',
    '### Atomicity and failure behavior', '### Agent contract requirement'
  ]);
  requireHeadings(files.proving, [
    '## Role', '## Flexible proof development', '## Organizing proof development',
    '## Preparing a candidate', '### Example candidate', '## Candidate preflight',
    '### Example preflight failure', '## Local conditional verification', '### Example verifier packet',
    '## Rejection and repair', '### Example rejection and repair', '## Safe acceptance',
    '### Example stale acceptance', '## Records', '## Invocation model',
    '### Example direct invocation'
  ]);
  requireHeadings(files.rendering, [
    '## Role', '### Example Quarto project', '## User-note rendering input',
    '### Example user page', '## Observability', '### Example generated status page',
    '## Proof-development observability', '## Dependency navigation',
    '### Example graph inclusion', '## Separation of concerns', '## Generated material',
    '## Formats and graceful degradation', '### Example render commands'
  ]);
  requireHeadings(files.skill, [
    '## Project setup', '## Project contract preflight', '## Proof-development layout',
    '## Using the infrastructure', '## Status and rendering'
  ]);
  requireHeadings(files.contract, [
    '## Contents', '## Project setup', '## External mathematical basis',
    '## qmd-prover contract', '## Proof development in the project',
    '## Verification discipline', '## Agent workflow', '## Project-specific additions'
  ]);
  requireHeadings(files.cli, [
    '## Requirements', '## Commands', '### Diagnostic codes', '## Semantic QMD',
    '## Install the skill from a source checkout', '## Test', '## Current boundary'
  ]);

  const minimumLines: Record<keyof typeof files, number> = {
    architecture: 80,
    design: 420,
    discipline: 300,
    inspector: 300,
    proving: 280,
    rendering: 190,
    skill: 60,
    contract: 150,
    cli: 95
  };
  for (const [name, source] of Object.entries(files) as [keyof typeof files, string][]) {
    assert.ok(source.split('\n').length >= minimumLines[name], `${name} documentation was unexpectedly compressed`);
  }
});
