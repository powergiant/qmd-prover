#!/usr/bin/env tsx

// Install the docs-only qmd-prover skill into a host agent's skills directory.
//
// The executable is a separate `qmd-prover` command installed on the host's PATH
// (`npm install -g .` or `npm link`); this copies only the instructions the agent
// reads (SKILL.md, references/, agents/) and deliberately omits the src/ and
// scripts/ engine so the two halves are versioned and installed independently.
//
// Usage: install-skill [--local|--global] [--codex|--claude] [--dir <project>]
//   --local   (default) install into a project, under <project>/.claude or <project>/.codex
//   --global  install into the host's home skills directory
//   --claude  (default) target Claude Code (.claude/skills/qmd-prover)
//   --codex   target Codex (.codex/skills/qmd-prover)
//   --dir     project directory for a local install (default: current directory)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installSkill } from '../skills/qmd-prover/src/core/infrastructure/skill-install.js';
import type { SkillHost, SkillScope } from '../skills/qmd-prover/src/core/infrastructure/skill-install.js';

// This dev script is equivalent to the `qmd-prover install` command, but runs
// straight from a checkout without the engine needing to be on PATH first. Both
// share the copy logic in core/infrastructure/skill-install.ts.

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(repository, 'skills', 'qmd-prover');

const argv = process.argv.slice(2);
let scope: SkillScope = 'local';
let host: SkillHost = 'claude';
let projectDir = process.cwd();

for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === '--local' || arg === '--global') {
    scope = arg.slice(2) as SkillScope;
  } else if (arg === '--codex' || arg === '--claude') {
    host = arg.slice(2) as SkillHost;
  } else if (arg === '--dir') {
    const value = argv[index + 1];
    if (!value) {
      process.stderr.write('--dir requires a path\n');
      process.exit(1);
    }
    projectDir = path.resolve(value);
    index += 1;
  } else {
    process.stderr.write(`Unknown option "${arg}". Usage: install-skill [--local|--global] [--codex|--claude] [--dir <project>]\n`);
    process.exit(1);
  }
}

const destination = await installSkill({ source, scope, host, projectDir });

process.stdout.write(`${destination}\n`);
process.stderr.write(`Installed the qmd-prover skill (docs only) for ${host === 'claude' ? 'Claude Code' : 'Codex'} (${scope}).\n`);
process.stderr.write('Ensure the `qmd-prover` command is on PATH (npm install -g . or npm link), then run `qmd-prover version` to confirm.\n');
