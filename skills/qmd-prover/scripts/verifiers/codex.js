#!/usr/bin/env node
// qmd-prover verifier adapter for OpenAI Codex.
//
// Enable with, in .qmd-prover/config.yml:
//   verification:
//     backend: codex
//     executable: ""      # path to the `codex` CLI, or leave blank if it is on PATH
//     model: ""           # "" uses the CLI default, or a concrete model id, e.g. gpt-5-codex
//
// qmd-prover spawns `node codex.js --executable <codex> [--model <id>]` and pipes the
// verification packet to this adapter's stdin. We run the Codex CLI non-interactively
// (`codex exec ...`) — the same entry point the Codex SDK's `thread.run()` drives — and
// return the verdict JSON on stdout.
//
// The `codex` CLI must be installed and authenticated (`codex login` or OPENAI_API_KEY).
// No qmd-prover code changes are needed to point it at a different model or executable —
// only config.
import { runAdapter, runProcess } from './lib.js';
/** `codex exec` prints a "tokens used\n<N>" line (grouped digits) to stderr; pull out the count. */
function parseCodexTokens(stderr) {
    const match = /tokens used[\s:]*([\d][\d,]*)/i.exec(stderr);
    if (!match)
        return undefined;
    const value = Number.parseInt(match[1].replace(/,/g, ''), 10);
    return Number.isFinite(value) ? value : undefined;
}
await runAdapter(async (prompt, options) => {
    const executable = typeof options.executable === 'string' ? options.executable : 'codex';
    const args = ['exec'];
    if (typeof options.model === 'string' && options.model)
        args.push('--model', options.model);
    // Forward the configured reasoning effort (validated to a bare word upstream).
    if (typeof options.effort === 'string' && options.effort) {
        args.push('-c', `model_reasoning_effort="${options.effort}"`);
    }
    // Read-only reasoning task: forbid the agent from touching the filesystem or network.
    args.push('--sandbox', 'read-only');
    // The math project need not be a git repository; this is a pure reasoning call.
    args.push('--skip-git-repo-check');
    args.push(prompt);
    const result = await runProcess(executable, args);
    if (result.code !== 0) {
        throw new Error(`codex exited ${result.code ?? `signal ${result.signal}`}: ${result.stderr.trim() || result.stdout.trim()}`);
    }
    // `codex exec` prints the final assistant message (often the bare JSON) to stdout, and a
    // token-usage line to stderr; report the token count so qmd-prover can record it.
    const tokens = parseCodexTokens(result.stderr);
    return tokens === undefined ? result.stdout : { text: result.stdout, usage: { total_tokens: tokens } };
});
