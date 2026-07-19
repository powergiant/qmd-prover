import { fileURLToPath } from 'node:url';
import { installSkill } from '../../core/infrastructure/skill-install.js';
import { SCHEMA_VERSION } from '../../core/shared/core.js';
import type { SkillHost, SkillScope } from '../../core/infrastructure/skill-install.js';
import type { OperationResult } from '../../core/shared/types.js';

// `qmd-prover install` places the docs-only skill into the host's skills
// directory. Unlike an `npm run` script — which npm forces to execute in the
// package directory — this command runs in the user's own cwd, so a local
// (per-project) install correctly targets the project the user is working in.

export interface InstallSkillOptions {
  scope: SkillScope;
  host: SkillHost;
  dir?: string;
}

export async function installSkillCommand(root: string, { scope, host, dir }: InstallSkillOptions): Promise<OperationResult> {
  // The skill docs ship alongside this command inside the installed package:
  // <package>/skills/qmd-prover/{SKILL.md, references/, agents/}.
  const source = fileURLToPath(new URL('../../../', import.meta.url));
  const projectDir = scope === 'local' ? (dir ?? root) : undefined;
  const destination = await installSkill({ source, scope, host, projectDir });
  const hostName = host === 'claude' ? 'Claude Code' : 'Codex';
  return {
    schema_version: SCHEMA_VERSION,
    operation: 'install-skill',
    ok: true,
    host,
    scope,
    destination,
    // Hosts build their skill registry at session start, so a skill installed
    // now is not auto-activated in this session — but it is usable immediately by
    // reading its SKILL.md directly.
    message: `Installed the qmd-prover skill (docs only) for ${hostName} (${scope}) at ${destination}.`,
    next_actions: [
      { action: 'use-now', detail: `Read ${destination}/SKILL.md and follow it to use qmd-prover in this session; no host registration is required first.` },
      { action: 'activate-later', detail: 'Start a new session so the host discovers the skill and can invoke it on its own.' }
    ]
  };
}
