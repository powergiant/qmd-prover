#!/usr/bin/env node

import { main } from './cli/run.js';
import { asErrorLike, SCHEMA_VERSION } from './core/shared/core.js';

main(process.argv.slice(2)).catch((error) => {
  const failure = asErrorLike(error);
  const message = failure.message ?? String(error);
  const code = typeof failure.code === 'string' ? failure.code : 'CLI_ERROR';
  process.stdout.write(`${JSON.stringify({
    schema_version: SCHEMA_VERSION,
    operation: 'cli-error',
    ok: false,
    diagnostics: [{ severity: 'error', code, message }]
  }, null, 2)}\n`);
  process.stderr.write(`${process.env.QMD_PROVER_DEBUG === '1' ? failure.stack ?? message : message}\n`);
  process.exitCode = failure.exitCode ?? 1;
});
