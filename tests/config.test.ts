import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { ConfigError, loadConfig, parseSimpleYaml } from '../skills/qmd-prover/src/core/infrastructure/config.js';
import { checkerContract, configured, verifierCommand } from '../skills/qmd-prover/src/core/verification/protocol.js';
import { bareProject, must } from './support.js';

test('config parser: value types, trailing comments, and quote/bracket protection', () => {
  const parsed = parseSimpleYaml([
    'verification:',
    '  backend: codex   # trailing comment is stripped',
    '  model: ""',
    "  note: 'a # b'",            // quotes protect the #
    '  literal: thm#main',         // # with no space before it is a normal character
    '  fresh-context: true',
    '  flag: false',
    '  tools: [file-read, code]   # comment after the list',
    '  numish: 30',                // no numbers in the subset -> string
    '  nullish: null'              // no null in the subset -> string
  ].join('\n'));
  const v = parsed.verification as Record<string, unknown>;
  assert.equal(v.backend, 'codex');
  assert.equal(v.model, '');
  assert.equal(v.note, 'a # b');
  assert.equal(v.literal, 'thm#main');
  assert.equal(v['fresh-context'], true);
  assert.equal(v.flag, false);
  assert.deepEqual(v.tools, ['file-read', 'code']);
  assert.equal(v.numish, '30');
  assert.equal(v.nullish, 'null');
});

test('config parser: empty value opens a section; quoted "" is empty text', () => {
  const parsed = parseSimpleYaml(['project:', '  exclude: [.qmd-prover]', 'tools:', '  pandoc: ""'].join('\n'));
  assert.deepEqual((parsed.project as Record<string, unknown>).exclude, ['.qmd-prover']);
  assert.equal((parsed.tools as Record<string, unknown>).pandoc, '');
});

test('config parser: malformed input throws ConfigError naming the line', () => {
  assert.throws(() => parseSimpleYaml('good: 1\nno colon here\n'), (error) => error instanceof ConfigError && /line 2/.test(error.message));
  assert.throws(() => parseSimpleYaml('x: "unterminated'), (error) => error instanceof ConfigError && /line 1/.test(error.message));
  assert.throws(() => parseSimpleYaml('x: [a, b'), (error) => error instanceof ConfigError && /line 1/.test(error.message));
  assert.throws(() => parseSimpleYaml('a:\n\tb: 1'), (error) => error instanceof ConfigError && /tab/.test(error.message));
});

test('config parser: inline-list elements may contain ] or , inside quotes', () => {
  const parsed = parseSimpleYaml([
    'verification:',
    '  command: [sh, -c, "echo x[0]"]',
    'project:',
    '  exclude: ["a]b", c]   # comment with a ] in it',
    'a:',
    "  b: ['x,y', z]"
  ].join('\n'));
  assert.deepEqual((parsed.verification as Record<string, unknown>).command, ['sh', '-c', 'echo x[0]']);
  assert.deepEqual((parsed.project as Record<string, unknown>).exclude, ['a]b', 'c']);
  assert.deepEqual((parsed.a as Record<string, unknown>).b, ['x,y', 'z']);
});

test('loadConfig: the retired model "configurable" is rejected with a migration hint', async () => {
  const root = await bareProject();
  await mkdir(path.join(root, '.qmd-prover'), { recursive: true });
  await writeFile(path.join(root, '.qmd-prover', 'config.yml'), 'verification:\n  backend: codex\n  model: configurable\n');
  await assert.rejects(loadConfig(root), (error) => error instanceof ConfigError && /configurable/.test(error.message));
});

test('loadConfig: an unrecognized backend is a ConfigError; valid backends pass', async () => {
  const root = await bareProject();
  await mkdir(path.join(root, '.qmd-prover'), { recursive: true });
  const configFile = path.join(root, '.qmd-prover', 'config.yml');

  await writeFile(configFile, 'verification:\n  backend: codxe\n');
  await assert.rejects(loadConfig(root), (error) => error instanceof ConfigError && /backend/.test(error.message));

  await writeFile(configFile, 'verification:\n  backend: codex\n');
  assert.equal((await loadConfig(root)).verification.backend, 'codex');

  // A trailing comment must not corrupt the value (regression for the mis-parse).
  await writeFile(configFile, 'verification:\n  backend: codex   # or claude\n');
  assert.equal((await loadConfig(root)).verification.backend, 'codex');
});

test('backend: none disables verification even with a leftover command; command still runs', () => {
  delete process.env.QMD_PROVER_VERIFIER;
  const withCommand = { verification: { backend: 'none', command: ['node', 'v.js'] } };
  assert.equal(configured(withCommand), false);
  assert.equal(verifierCommand(withCommand), null);

  const custom = must(verifierCommand({ verification: { backend: 'command', command: ['node', 'v.js'] } }));
  assert.deepEqual([custom.command, ...custom.args], ['node', 'v.js']);

  assert.equal(configured({ verification: { backend: 'codex' } }), true);
});

test('checkerContract hashes the resolved model, so "" and an absent model match', () => {
  assert.equal(checkerContract({ verification: { backend: 'codex', model: '' } }).model, '');
  assert.equal(checkerContract({ verification: { backend: 'codex' } }).model, '');
  assert.equal(checkerContract({ verification: { backend: 'codex', model: 'gpt-5-codex' } }).model, 'gpt-5-codex');
});

test('fresh-context underscore alias is no longer honored (hyphenated key only)', () => {
  assert.equal(checkerContract({ verification: { backend: 'codex', fresh_context: false } }).fresh_context, true);
  assert.equal(checkerContract({ verification: { backend: 'codex', 'fresh-context': false } }).fresh_context, false);
});
