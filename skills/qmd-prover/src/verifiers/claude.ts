#!/usr/bin/env node
// qmd-prover verifier adapter for Claude Code.
//
// Enable with, in .qmd-prover/config.yml:
//   verification:
//     backend: claude
//     executable: ""      # path to the `claude` CLI, or leave blank if it is on PATH
//     model: ""           # "" uses the CLI default, or a concrete model id, e.g. claude-opus-4-8
//
// qmd-prover spawns `node claude.js --executable <claude> [--model <id>]` and pipes
// the verification packet to this adapter's stdin. We run the Claude Code CLI in
// headless print mode (`claude -p ... --output-format json`) — the same entry point the
// Claude Agent SDK's `query()` drives — and return the verdict JSON on stdout.
//
// The `claude` CLI must be installed and authenticated (ANTHROPIC_API_KEY or an
// interactive `claude login` in this environment). No qmd-prover code changes are
// needed to point it at a different model or executable — only config.

import { runAdapter, runProcess } from './lib.js';
import type { VerifierUsage } from '../lib/verification/protocol.js';

/** Map the `usage` object of a `claude -p --output-format json` envelope into a VerifierUsage. */
function claudeUsage(envelope: Record<string, unknown>): VerifierUsage | undefined {
  const usage = envelope.usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const record = usage as Record<string, unknown>;
  const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  const input = num(record.input_tokens);
  const output = num(record.output_tokens);
  if (input === undefined && output === undefined) return undefined;
  return { ...(input !== undefined ? { input_tokens: input } : {}), ...(output !== undefined ? { output_tokens: output } : {}), total_tokens: (input ?? 0) + (output ?? 0) };
}

await runAdapter(async (prompt, options) => {
  const executable = typeof options.executable === 'string' ? options.executable : 'claude';
  const args = ['-p', prompt, '--output-format', 'json'];
  if (typeof options.model === 'string' && options.model) args.push('--model', options.model);
  // Forward the configured reasoning effort (low|medium|high|xhigh|max); claude warns and
  // falls back to its default on any value it does not recognize.
  if (typeof options.effort === 'string' && options.effort) args.push('--effort', options.effort);

  const result = await runProcess(executable, args);
  if (result.code !== 0) {
    throw new Error(`claude exited ${result.code ?? `signal ${result.signal}`}: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  // `--output-format json` wraps the answer as { ..., result: "<assistant text>", usage: {...} }.
  try {
    const envelope: unknown = JSON.parse(result.stdout);
    if (envelope && typeof envelope === 'object') {
      const record = envelope as Record<string, unknown>;
      const usage = claudeUsage(record);
      if (typeof record.result === 'string') return usage ? { text: record.result, usage } : record.result;
      if ('verdict' in record) return usage ? { text: result.stdout, usage } : result.stdout;
    }
  } catch { /* not an envelope; treat stdout as the assistant text */ }
  return result.stdout;
});
