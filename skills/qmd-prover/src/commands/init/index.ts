import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { readExternalPolicy } from '../../core/infrastructure/external.js';
import { atomicWrite, exists, relativePosix } from '../../core/infrastructure/files.js';
import { auxLayout, scaffoldAux, withWriteLock } from '../../core/infrastructure/aux.js';
import { readCanonicalContract } from '../../core/infrastructure/contract.js';
import { SCHEMA_VERSION } from '../../core/shared/core.js';
import type { JsonObject, OperationResult } from '../../core/shared/types.js';

export interface ExistingProjectInventory {
  agents_md: boolean;
  external_policy: { path: string; mode: string };
  qmd_prover_state: boolean;
  quarto_configs: string[];
  qmd_file_count: number;
  qmd_files: string[];
}

export interface QuartoConfigOutcome {
  path: string;
  status: 'created' | 'preserved';
  /** Where the scaffolded book renders to; absent when an existing configuration was preserved. */
  output_dir?: string;
}

export interface InitializeProjectResult extends OperationResult {
  status: string;
  contract_version: number;
  path: string;
  existing?: ExistingProjectInventory;
  quarto_config?: QuartoConfigOutcome;
}

const START = '<!-- qmd-prover-contract:start version=';
const END = '<!-- qmd-prover-contract:end -->';
const BLOCK = /<!-- qmd-prover-contract:start version=(\d+) -->[\s\S]*?<!-- qmd-prover-contract:end -->/g;

function result(root: string, version: number, status: string, extra: JsonObject = {}): InitializeProjectResult {
  return {
    schema_version: SCHEMA_VERSION,
    operation: 'init-project',
    ok: !status.endsWith('-required') && status !== 'malformed-contract',
    status,
    path: relativePosix(root, path.join(root, 'AGENTS.md')),
    contract_version: version,
    diagnostics: [],
    ...extra
  };
}

function projectPolicy(block: string): string {
  return `# Mathematical project instructions\n\n${block}\n\n## Project-specific additions\n\n`;
}

async function findQmdFiles(root: string, directory = root): Promise<string[]> {
  const ignored = new Set(['.git', '.qmd-prover', '.quarto', 'node_modules']);
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && !ignored.has(entry.name)) files.push(...await findQmdFiles(root, file));
    else if (entry.isFile() && entry.name.endsWith('.qmd')) files.push(relativePosix(root, file));
  }
  return files.sort();
}

async function inspectExistingProject(root: string): Promise<ExistingProjectInventory> {
  const quartoConfigs: string[] = [];
  for (const name of ['_quarto.yml', '_quarto.yaml']) if (await exists(path.join(root, name))) quartoConfigs.push(name);
  const qmdFiles = await findQmdFiles(root);
  const externalPolicy = await readExternalPolicy(root);
  return {
    agents_md: await exists(path.join(root, 'AGENTS.md')),
    external_policy: { path: externalPolicy.path, mode: externalPolicy.mode },
    qmd_prover_state: await exists(auxLayout(root).dir),
    quarto_configs: quartoConfigs,
    qmd_file_count: qmdFiles.length,
    qmd_files: qmdFiles
  };
}

const QUARTO_OUTPUT_DIR = '.qmd-prover/site/book';

/**
 * Reading order for the scaffolded chapter list: the book landing page first,
 * then shallower files before deeper ones, alphabetically within a depth. Root
 * notes therefore precede `workspace/` material, which is how these projects
 * read. The list is a starting point only — it is the project's from then on.
 */
function chapterOrder(files: string[]): string[] {
  const depth = (file: string): number => file.split('/').length;
  return [...files].sort((left, right) => {
    if (left === 'index.qmd') return -1;
    if (right === 'index.qmd') return 1;
    return depth(left) - depth(right) || left.localeCompare(right);
  });
}

function quartoConfig(root: string, files: string[]): string {
  const chapters = chapterOrder(files);
  return [
    `# Rendering configuration for a qmd-prover project, written once by \`qmd-prover init\`.`,
    `# The project renders as a Quarto book because a book is the only Quarto layout in which`,
    `# result numbering runs across the whole project and an @id reference resolves to a`,
    `# declaration in another file. This file is the project's: qmd-prover never rewrites it.`,
    ``,
    `project:`,
    `  type: book`,
    `  # All rendered output lands here, inside the already-ignored state directory.`,
    `  # Quarto's own .quarto/ cache stays in the project root, where its first render`,
    `  # writes a .gitignore covering it.`,
    `  output-dir: ${QUARTO_OUTPUT_DIR}`,
    ``,
    `book:`,
    `  title: "${path.basename(root).replace(/"/g, '')}"`,
    `  # Every QMD file of the project, in reading order. Add each new file as you create it;`,
    `  # a file left out is still compiled and checked, but is missing from the rendered book`,
    `  # and every reference into it renders as a question mark. The first chapter is the book`,
    `  # landing page and must be index.qmd.`,
    chapters.length ? `  chapters:\n${chapters.map((file) => `    - ${file}`).join('\n')}` : `  chapters: []`,
    ``,
    `format:`,
    `  html:`,
    `    toc: true`,
    ``,
    `crossref:`,
    `  chapters: true`,
    ``
  ].join('\n');
}

/**
 * Write `_quarto.yml` once, when the project has no Quarto configuration at all.
 * An existing configuration is never touched or merged: the project may already
 * render as something other than a book, and that is the project's decision.
 */
async function scaffoldQuartoConfig(root: string, existing: ExistingProjectInventory): Promise<QuartoConfigOutcome> {
  const [configured] = existing.quarto_configs;
  if (configured) return { path: configured, status: 'preserved' };
  await atomicWrite(path.join(root, '_quarto.yml'), quartoConfig(root, existing.qmd_files));
  return { path: '_quarto.yml', status: 'created', output_dir: QUARTO_OUTPUT_DIR };
}

function hasMathematicalProject(existing: ExistingProjectInventory): boolean {
  return existing.qmd_prover_state || existing.quarto_configs.length > 0 || existing.qmd_file_count > 0;
}

export async function initializeProject(
  root: string,
  { adoptExisting = false, appendContract = false, syncContract = false }: {
    adoptExisting?: boolean;
    appendContract?: boolean;
    syncContract?: boolean;
  } = {}
): Promise<InitializeProjectResult> {
  const requestedMutations = [adoptExisting, appendContract, syncContract].filter(Boolean).length;
  if (requestedMutations > 1) {
    throw new Error('init accepts only one of --adopt-existing, --append-contract, or --sync-contract');
  }

  const canonical = await readCanonicalContract();
  const policyFile = path.join(root, 'AGENTS.md');
  const existing = await inspectExistingProject(root);
  const currentPolicy = existing.agents_md ? await readFile(policyFile, 'utf8') : '';
  const projectMaterialExists = hasMathematicalProject(existing);

  if (!currentPolicy.trim()) {
    if (projectMaterialExists) {
      if (!adoptExisting) {
        return result(root, canonical.version, 'intent-required', {
          existing,
          message: 'Existing mathematical project files were found. Ask whether to adopt them in place, inspect them first, or leave them unchanged.',
          suggested_command: 'qmd-prover init --adopt-existing'
        });
      }
    }
  }

  return withWriteLock(root, async () => {
    const outcome = await resolveContract();
    // Materialize the state directory for any initialized project, decoupled from
    // whether AGENTS.md needed a write: `ok` covers created/adopted/appended/
    // synchronized *and* already-initialized, so a project missing config.yml gets
    // it back here even when the contract was already current. The gated -required
    // and malformed outcomes are not ok, so a project awaiting the user's decision
    // is never mutated. The Quarto book configuration is scaffolded on the same
    // condition, so a project always gets a rendering layout in which numbering and
    // cross-file references resolve.
    if (!outcome.ok) return outcome;
    await scaffoldAux(root);
    return { ...outcome, quarto_config: await scaffoldQuartoConfig(root, existing) };
  });

  async function resolveContract(): Promise<InitializeProjectResult> {
    const policyExists = await exists(policyFile);

    if (!policyExists) {
      await atomicWrite(policyFile, projectPolicy(canonical.block));
      return result(root, canonical.version, projectMaterialExists ? 'adopted' : 'created', { existing });
    }

    const source = await readFile(policyFile, 'utf8');
    if (!source.trim()) {
      await atomicWrite(policyFile, projectPolicy(canonical.block));
      return result(root, canonical.version, projectMaterialExists ? 'adopted' : 'created', { existing });
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
      if (appendContract) {
        const separator = source.endsWith('\n') ? '\n' : '\n\n';
        await atomicWrite(policyFile, `${source}${separator}${canonical.block}\n`);
        return result(root, canonical.version, 'appended', { existing });
      }

      return result(root, canonical.version, 'append-required', {
        existing,
        message: 'AGENTS.md already exists without a qmd-prover contract.',
        suggested_command: 'qmd-prover init --append-contract'
      });
    }

    const current = matches[0][0];
    const currentVersion = Number(matches[0][1]);
    if (current === canonical.block) {
      return result(root, canonical.version, 'already-initialized', { existing });
    }

    if (syncContract) {
      await atomicWrite(policyFile, source.replace(current, () => canonical.block));
      return result(root, canonical.version, 'synchronized', { existing, previous_contract_version: currentVersion });
    }

    return result(root, canonical.version, 'sync-required', {
      existing,
      current_contract_version: currentVersion,
      message: 'AGENTS.md contains a different qmd-prover managed block.',
      suggested_command: 'qmd-prover init --sync-contract'
    });
  }
}
