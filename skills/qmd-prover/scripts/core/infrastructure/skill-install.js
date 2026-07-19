import { cp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
/** The skills directory this install would write to, without touching the disk. */
export function skillDestination({ scope, host, projectDir = process.cwd() }) {
    const home = os.homedir();
    const base = scope === 'global'
        ? (host === 'codex'
            ? process.env.CODEX_HOME || path.join(home, '.codex')
            : process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'))
        : path.join(path.resolve(projectDir), host === 'codex' ? '.codex' : '.claude');
    return path.join(base, 'skills', 'qmd-prover');
}
/** Copy the skill docs to the resolved destination, replacing any previous copy. Returns the destination. */
export async function installSkill(options) {
    const destination = skillDestination(options);
    const source = path.resolve(options.source);
    // The engine ships as the `qmd-prover` command, not inside the skill.
    const engineDirs = new Set([path.join(source, 'src'), path.join(source, 'scripts')]);
    await mkdir(path.dirname(destination), { recursive: true });
    await rm(destination, { recursive: true, force: true });
    await cp(source, destination, {
        recursive: true,
        filter: (from) => !engineDirs.has(path.resolve(from))
    });
    return destination;
}
