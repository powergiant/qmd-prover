import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite, AUX, exists, relativePosix, withWriteLock } from './files.mjs';

const START = '<!-- qmd-prover-contract:start version=';
const END = '<!-- qmd-prover-contract:end -->';
const BLOCK = /<!-- qmd-prover-contract:start version=(\d+) -->[\s\S]*?<!-- qmd-prover-contract:end -->/g;

async function canonicalContract() {
  const file = new URL('../../references/AGENTS.md', import.meta.url);
  const source = await readFile(file, 'utf8');
  const matches = [...source.matchAll(BLOCK)];
  if (matches.length !== 1) throw new Error('Canonical qmd-prover contract must contain exactly one managed block');
  return { block: matches[0][0], version: Number(matches[0][1]) };
}

function result(root, version, status, extra = {}) {
  return {
    schema_version: 1,
    operation: 'init-project',
    ok: !status.endsWith('-required') && status !== 'malformed-contract',
    status,
    path: relativePosix(root, path.join(root, 'AGENTS.md')),
    contract_version: version,
    ...extra
  };
}

function projectPolicy(block) {
  return `# Mathematical project instructions\n\n${block}\n\n## Project-specific additions\n\n`;
}

async function successfulResult(root, version, status, extra = {}) {
  const workspaceRoot = path.join(root, AUX, 'workspaces');
  await mkdir(workspaceRoot, { recursive: true });
  return result(root, version, status, { workspace_root: relativePosix(root, workspaceRoot), ...extra });
}

async function findQmdFiles(root, directory = root) {
  const ignored = new Set(['.git', '.qmd-prover', '.quarto', 'node_modules']);
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && !ignored.has(entry.name)) files.push(...await findQmdFiles(root, file));
    else if (entry.isFile() && entry.name.endsWith('.qmd')) files.push(relativePosix(root, file));
  }
  return files.sort();
}

async function inspectExistingProject(root) {
  const quartoConfigs = [];
  for (const name of ['_quarto.yml', '_quarto.yaml']) if (await exists(path.join(root, name))) quartoConfigs.push(name);
  const qmdFiles = await findQmdFiles(root);
  return {
    agents_md: await exists(path.join(root, 'AGENTS.md')),
    qmd_prover_state: await exists(path.join(root, '.qmd-prover')),
    quarto_configs: quartoConfigs,
    qmd_file_count: qmdFiles.length,
    qmd_files: qmdFiles
  };
}

function hasMathematicalProject(existing) {
  return existing.qmd_prover_state || existing.quarto_configs.length > 0 || existing.qmd_file_count > 0;
}

export async function initializeProject(root, { adoptExisting = false, appendContract = false, syncContract = false } = {}) {
  if ([adoptExisting, appendContract, syncContract].filter(Boolean).length > 1) {
    throw new Error('init-project accepts only one of --adopt-existing, --append-contract, or --sync-contract');
  }
  const canonical = await canonicalContract();
  const policyFile = path.join(root, 'AGENTS.md');
  const existing = await inspectExistingProject(root);
  const currentPolicy = existing.agents_md ? await readFile(policyFile, 'utf8') : '';

  if (!currentPolicy.trim() && hasMathematicalProject(existing) && !adoptExisting) {
    return result(root, canonical.version, 'intent-required', {
      existing,
      message: 'Existing mathematical project files were found. Ask whether to adopt them in place, inspect them first, or leave them unchanged.',
      suggested_command: 'qmd-prover init-project --adopt-existing'
    });
  }

  return withWriteLock(root, async () => {
    if (!await exists(policyFile)) {
      await atomicWrite(policyFile, projectPolicy(canonical.block));
      return successfulResult(root, canonical.version, hasMathematicalProject(existing) ? 'adopted' : 'created', { existing });
    }

    const source = await readFile(policyFile, 'utf8');
    if (!source.trim()) {
      await atomicWrite(policyFile, projectPolicy(canonical.block));
      return successfulResult(root, canonical.version, hasMathematicalProject(existing) ? 'adopted' : 'created', { existing });
    }

    const matches = [...source.matchAll(BLOCK)];
    const starts = source.split(START).length - 1;
    const ends = source.split(END).length - 1;
    if (matches.length > 1 || starts !== matches.length || ends !== matches.length) {
      return result(root, canonical.version, 'malformed-contract', {
        existing,
        message: 'AGENTS.md contains malformed or duplicate qmd-prover contract markers; repair it manually before initialization.'
      });
    }

    if (matches.length === 0) {
      if (!appendContract) {
        return result(root, canonical.version, 'append-required', {
          existing,
          message: 'AGENTS.md already exists without a qmd-prover contract.',
          suggested_command: 'qmd-prover init-project --append-contract'
        });
      }
      const separator = source.endsWith('\n') ? '\n' : '\n\n';
      await atomicWrite(policyFile, `${source}${separator}${canonical.block}\n`);
      return successfulResult(root, canonical.version, 'appended', { existing });
    }

    const current = matches[0][0];
    const currentVersion = Number(matches[0][1]);
    if (current === canonical.block) return successfulResult(root, canonical.version, 'already-initialized', { existing });
    if (!syncContract) {
      return result(root, canonical.version, 'sync-required', {
        existing,
        current_contract_version: currentVersion,
        message: 'AGENTS.md contains a different qmd-prover managed block.',
        suggested_command: 'qmd-prover init-project --sync-contract'
      });
    }

    await atomicWrite(policyFile, source.replace(current, () => canonical.block));
    return successfulResult(root, canonical.version, 'synchronized', { existing, previous_contract_version: currentVersion });
  });
}
