import path from 'node:path';
import { loadConfig } from '../infrastructure/config.js';
import { executableAvailable } from '../infrastructure/executables.js';
import { verifierCommand } from '../verification/protocol.js';
import { SCHEMA_VERSION } from '../shared/core.js';
import type { OperationResult } from '../shared/types.js';

interface DependencyStatus {
  required: boolean;
  available: boolean;
  command: string | null;
  purpose: string;
  remediation?: string;
}

export async function doctorProject(root = process.cwd()): Promise<OperationResult> {
  root = path.resolve(root);
  const config = await loadConfig(root);
  const pandocCommand = process.env.QMD_PROVER_PANDOC?.trim() || 'pandoc';
  const verifier = verifierCommand(config);
  const [pandoc, quarto, verifierAvailable] = await Promise.all([
    executableAvailable(pandocCommand),
    executableAvailable('quarto'),
    verifier ? executableAvailable(verifier.command) : Promise.resolve(false)
  ]);
  const major = Number(process.versions.node.split('.')[0]);
  const dependencies: Record<string, DependencyStatus> = {
    node: {
      required: true, available: major >= 20, command: process.execPath,
      purpose: 'Run the qmd-prover dispatcher.',
      ...(major >= 20 ? {} : { remediation: 'Install Node.js 20 or later.' })
    },
    pandoc: {
      required: true, available: pandoc, command: pandocCommand,
      purpose: 'Parse QMD into Pandoc JSON.',
      ...(pandoc ? {} : { remediation: 'Install Pandoc or set QMD_PROVER_PANDOC to an executable.' })
    },
    verifier: {
      required: false, available: verifierAvailable, command: verifier?.command ?? null,
      purpose: 'Independently check proof and refutation candidates.',
      ...(!verifier ? { remediation: 'Optional: set QMD_PROVER_VERIFIER or verification.command.' }
        : verifierAvailable ? {} : { remediation: `Configured verifier is not executable: ${verifier.command}` })
    },
    quarto: {
      required: false, available: quarto, command: 'quarto',
      purpose: 'Build final HTML, PDF, or other rendered output.',
      ...(quarto ? {} : { remediation: 'Optional: install Quarto before running the suggested final render command.' })
    }
  };
  return {
    schema_version: SCHEMA_VERSION,
    operation: 'doctor',
    ok: dependencies.node.available && dependencies.pandoc.available,
    root,
    dependencies,
    next_actions: Object.entries(dependencies)
      .filter(([, dependency]) => !dependency.available && dependency.remediation)
      .map(([name, dependency]) => ({ dependency: name, remediation: dependency.remediation }))
  };
}
