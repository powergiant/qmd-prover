#!/usr/bin/env node

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const packet = JSON.parse(input);
  const incorrect = packet.target.proof.includes('INVALID');
  const gap = packet.target.proof.includes('GAP');
  process.stdout.write(JSON.stringify(incorrect ? {
    verdict: 'incorrect', summary: 'The argument contains the test sentinel.',
    critical_errors: ['invalid step'], gaps: [], repair_hints: 'Remove the invalid step.'
  } : gap ? {
    verdict: 'correct', summary: 'The conclusion looks right, but a step is missing.',
    critical_errors: [], gaps: ['justify the missing step'], repair_hints: 'Supply the justification.'
  } : {
    verdict: 'correct', summary: 'The argument establishes the stated claim.',
    critical_errors: [], gaps: [], repair_hints: ''
  }));
});
