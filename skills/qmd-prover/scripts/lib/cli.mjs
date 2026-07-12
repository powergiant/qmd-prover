import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { compileProject, theoremBundle } from './compiler.mjs';
import { AUX, cleanId, readJson } from './files.mjs';
import { renderProject } from './render.mjs';
import { readLocatedBlock } from './source.mjs';
import { revokeVerification, showVerification, submitProof } from './verification.mjs';
import { initializeWorkspace, inspectWorkspace } from './workspace.mjs';

const usage = `Usage:
  qmd-prover inspect-project
  qmd-prover inspect-theorem @thm-main-ID
  qmd-prover workspace init @thm-main-ID
  qmd-prover workspace inspect @thm-main-ID
  qmd-prover submit-proof PROPOSAL_FILE [--to CANONICAL_QMD]
  qmd-prover verification show SUBMISSION_ID
  qmd-prover verification revoke @thm-ID --reason "..."
  qmd-prover render`;

function output(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

async function history(root, id) {
  const directory = path.join(root, AUX, 'verification');
  try {
    const entries = await readdir(directory);
    const records = [];
    for (const name of entries.filter((entry) => entry.startsWith('submission-') && entry.endsWith('.json')).sort()) {
      const record = await readJson(path.join(directory, name));
      if (record.target === id) records.push(record);
    }
    return records;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function main(args, { root = process.cwd(), pandoc = process.env.QMD_PROVER_PANDOC } = {}) {
  const [command, ...rest] = args;
  const options = pandoc ? { pandoc } : {};
  if (!command || command === '--help' || command === '-h') { process.stdout.write(`${usage}\n`); return; }
  if (command === 'inspect-project') {
    const result = await compileProject(root, options);
    for (const item of result.diagnostics) process.stderr.write(`${item.file ?? '<project>'}:${item.line ?? '?'}: ${item.severity} ${item.code}: ${item.message}\n`);
    output({ schema_version: 1, ok: result.ok, summary: result.summary, diagnostics: result.diagnostics });
    if (!result.ok) process.exitCode = 2;
    return;
  }
  if (command === 'inspect-theorem') {
    if (rest.length !== 1) throw new Error('inspect-theorem requires one semantic ID');
    const compilation = await compileProject(root, options);
    const bundle = theoremBundle(compilation, rest[0]);
    const located = await readLocatedBlock(path.join(root, bundle.target.file), bundle.target.id);
    output({ schema_version: 1, ...bundle, source: { statement: located?.statement?.text ?? '', proof: located?.proof?.text ?? '' }, verification_history: await history(root, bundle.target.id) });
    return;
  }
  if (command === 'submit-proof') {
    const destinationIndex = rest.indexOf('--to');
    const proposal = rest[0];
    const destination = destinationIndex >= 0 ? rest[destinationIndex + 1] : undefined;
    if (!proposal || (rest.length !== 1 && !(rest.length === 3 && destinationIndex === 1 && destination))) throw new Error('submit-proof requires one proposal QMD file and optional --to CANONICAL_QMD');
    output(await submitProof(root, proposal, { ...options, destination }));
    return;
  }
  if (command === 'workspace') {
    const [subcommand, value, ...tail] = rest;
    if (!value || tail.length) throw new Error('workspace requires init or inspect and one thm-main-* ID');
    if (subcommand === 'init') { output(await initializeWorkspace(root, value, options)); return; }
    if (subcommand === 'inspect') {
      const result = await inspectWorkspace(root, value, options);
      output(result);
      if (!result.ok) process.exitCode = 2;
      return;
    }
    throw new Error('Invalid workspace command');
  }
  if (command === 'verification') {
    const [subcommand, value, ...tail] = rest;
    if (subcommand === 'show' && value && tail.length === 0) { output(await showVerification(root, value)); return; }
    if (subcommand === 'revoke' && value) {
      const index = tail.indexOf('--reason');
      const reason = index >= 0 ? tail[index + 1] : '';
      output(await revokeVerification(root, cleanId(value), reason, options));
      return;
    }
    throw new Error('Invalid verification command');
  }
  if (command === 'render') { output(await renderProject(root, options)); return; }
  throw new Error(`Unknown command: ${command}\n${usage}`);
}
