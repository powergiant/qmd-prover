#!/usr/bin/env node
// qmd-prover verifier adapter for Claude Code.
//
// Enable with, in .qmd-prover/config.yml:
//   verification:
//     backend: claude
//     executable: ""      # path to the `claude` CLI, or leave blank if it is on PATH
//     model: configurable # or a concrete model id, e.g. claude-opus-4-8
//
// qmd-prover spawns `node claude.mjs --executable <claude> [--model <id>]` and pipes
// the verification packet to this adapter's stdin. We run the Claude Code CLI in
// headless print mode (`claude -p ... --output-format json`) — the same entry point the
// Claude Agent SDK's `query()` drives — and return the verdict JSON on stdout.
//
// The `claude` CLI must be installed and authenticated (ANTHROPIC_API_KEY or an
// interactive `claude login` in this environment). No qmd-prover code changes are
// needed to point it at a different model or executable — only config.

import { runAdapter, runProcess } from './lib.mjs';

await runAdapter(async (prompt, options) => {
  const executable = typeof options.executable === 'string' ? options.executable : 'claude';
  const args = ['-p', prompt, '--output-format', 'json'];
  if (typeof options.model === 'string' && options.model) args.push('--model', options.model);

  const result = await runProcess(executable, args);
  if (result.code !== 0) {
    throw new Error(`claude exited ${result.code ?? `signal ${result.signal}`}: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  // `--output-format json` wraps the answer as { ..., result: "<assistant text>" }.
  try {
    const envelope = JSON.parse(result.stdout);
    if (envelope && typeof envelope.result === 'string') return envelope.result;
    if (envelope && typeof envelope === 'object' && 'verdict' in envelope) return result.stdout;
  } catch { /* not an envelope; treat stdout as the assistant text */ }
  return result.stdout;
});
