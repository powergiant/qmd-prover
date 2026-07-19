#!/usr/bin/env node

import { appendFileSync } from 'node:fs';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const packet = JSON.parse(input);
  if (process.env.QMD_PROVER_VERIFIER_COUNT) appendFileSync(process.env.QMD_PROVER_VERIFIER_COUNT, `${packet.target.id}\n`);
  const external = `[external:${packet.external_basis.mode}:${packet.external_basis.content ?? ''}]`;
  const incorrect = packet.target.proof.includes('INVALID');
  const gap = packet.target.proof.includes('GAP');
  const refutation = packet.target.verification_mode === 'refutation';
  const discoveredCounterexample = packet.target.proof.includes('DISCOVER_COUNTEREXAMPLE');
  const emptyDisproof = packet.target.proof.includes('DISCOVER_EMPTY_DISPROOF');
  const wrongRefutationVerdict = packet.target.proof.includes('REFUTATION_CORRECT_VERDICT');
  const disproofWithGap = packet.target.proof.includes('REFUTE_LOOSE');
  process.stdout.write(JSON.stringify(incorrect ? {
    verdict: 'incorrect', summary: 'The argument contains the test sentinel.',
    critical_errors: ['invalid step'], gaps: [], repair_hints: 'Remove the invalid step.'
  } : gap ? {
    verdict: 'correct', summary: 'The conclusion looks right, but a step is missing.',
    critical_errors: [], gaps: ['justify the missing step'], repair_hints: 'Supply the justification.'
  } : emptyDisproof ? {
    verdict: 'disproved', summary: 'The statement is allegedly false.',
    critical_errors: [], gaps: [], repair_hints: '', refutation: ''
  } : wrongRefutationVerdict ? {
    verdict: 'correct', summary: 'A proof verdict cannot confirm refutation mode.',
    critical_errors: [], gaps: [], repair_hints: '', refutation: ''
  } : disproofWithGap ? {
    verdict: 'disproved', summary: 'The statement is false, with a routine gap in the refutation.',
    critical_errors: [], gaps: ['spell out the routine step'], repair_hints: '',
    refutation: 'The integer 1 is a counterexample that satisfies the hypotheses.'
  } : refutation || discoveredCounterexample ? {
    verdict: 'disproved', summary: 'The exact statement is false.',
    critical_errors: [], gaps: [], repair_hints: '',
    refutation: refutation ? packet.target.proof : 'A verifier-discovered counterexample satisfies the hypotheses and falsifies the conclusion.'
  } : {
    verdict: 'correct', summary: `The argument establishes the stated claim. ${external}`,
    critical_errors: [], gaps: [], repair_hints: ''
  }));
});
