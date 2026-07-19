import path from 'node:path';
import { ConfigError, loadConfig, pandocCommand, quartoCommand } from '../../core/infrastructure/config.js';
import { executableAvailable } from '../../core/infrastructure/executables.js';
import { verifierProbe } from '../../core/verification/protocol.js';
import { collectCompatibilityWarnings, engineVersions } from '../../core/infrastructure/compatibility.js';
import { SCHEMA_VERSION } from '../../core/shared/core.js';
export async function doctorProject(root = process.cwd()) {
    root = path.resolve(root);
    let config;
    try {
        config = await loadConfig(root);
    }
    catch (error) {
        // A malformed config.yml should be reported by doctor, not crash it — this is the command a
        // user runs to find config problems.
        if (error instanceof ConfigError) {
            return {
                schema_version: SCHEMA_VERSION,
                operation: 'doctor',
                ok: false,
                root,
                config_error: error.message,
                next_actions: [{ dependency: 'config', remediation: `Fix ${error.message}` }]
            };
        }
        throw error;
    }
    const pandocCmd = pandocCommand(config);
    const quartoCmd = quartoCommand(config);
    const verifier = verifierProbe(config);
    const [pandoc, quarto, verifierAvailable] = await Promise.all([
        executableAvailable(pandocCmd),
        executableAvailable(quartoCmd),
        verifier ? executableAvailable(verifier.command) : Promise.resolve(false)
    ]);
    const major = Number(process.versions.node.split('.')[0]);
    const [versions, compatibility] = await Promise.all([
        engineVersions(),
        collectCompatibilityWarnings(root)
    ]);
    const dependencies = {
        node: {
            required: true, available: major >= 20, command: process.execPath,
            purpose: 'Run the qmd-prover command.',
            ...(major >= 20 ? {} : { remediation: 'Install Node.js 20 or later.' })
        },
        pandoc: {
            required: true, available: pandoc, command: pandocCmd,
            purpose: 'Parse QMD into Pandoc JSON.',
            ...(pandoc ? {} : { remediation: 'Install Pandoc, set tools.pandoc in .qmd-prover/config.yml, or set QMD_PROVER_PANDOC.' })
        },
        verifier: {
            required: false, available: verifierAvailable, command: verifier?.command ?? null,
            purpose: 'Independently check proof and refutation candidates.',
            ...(!verifier ? { remediation: 'Optional: set verification.backend to claude or codex (with that CLI installed), or QMD_PROVER_VERIFIER.' }
                : verifierAvailable ? {} : { remediation: `Configured verifier tool is not executable: ${verifier.command}. Install it or set verification.executable to its path.` })
        },
        quarto: {
            required: false, available: quarto, command: quartoCmd,
            purpose: 'Build final HTML, PDF, or other rendered output.',
            ...(quarto ? {} : { remediation: 'Optional: install Quarto, set tools.quarto in config, or set QMD_PROVER_QUARTO, before the final render command.' })
        }
    };
    return {
        schema_version: SCHEMA_VERSION,
        operation: 'doctor',
        ok: dependencies.node.available && dependencies.pandoc.available,
        root,
        versions,
        dependencies,
        // Version drift never fails doctor; it is reported for the agent to act on.
        compatibility,
        next_actions: Object.entries(dependencies)
            .filter(([, dependency]) => !dependency.available && dependency.remediation)
            .map(([name, dependency]) => ({ dependency: name, remediation: dependency.remediation }))
    };
}
