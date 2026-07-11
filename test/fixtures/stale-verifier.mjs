#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', async () => {
  JSON.parse(input);
  if (process.env.QMD_PROVER_VERIFIER_READY) await writeFile(process.env.QMD_PROVER_VERIFIER_READY, 'ready');
  setTimeout(() => process.stdout.write(JSON.stringify({
    verdict: 'correct', summary: 'Correct before the concurrent edit.',
    critical_errors: [], gaps: [], repair_hints: ''
  })), 120);
});
