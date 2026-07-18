// Shared helpers for qmd-prover independent-verifier adapters.
//
// An adapter is a small program that qmd-prover spawns for one local conditional
// check. It receives ONE JSON verification packet on stdin and must print ONE JSON
// verdict object on stdout, conforming to the protocol in references/cli.md:
//   { verdict: "correct"|"incorrect"|"disproved", summary, critical_errors[],
//     gaps[], nonblocking_comments[], repair_hints, refutation }
//
// These helpers turn that contract into a one-liner for a concrete model CLI:
// build the prompt from the packet, run the CLI, pull the verdict JSON back out.
// Runtime is dependency-free: Node builtins only. The two imports below are
// `import type`, so they erase at compile time and add no runtime coupling — the
// emitted .js still imports nothing but node:child_process.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VerifierPacket } from '../core/verification/protocol.js';
import type { VerifierReport, VerifierUsage } from '../core/shared/verdicts.js';

/** Flags parsed from argv: `--name value` yields a string, a bare `--flag` yields true. */
export type AdapterOptions = Record<string, string | boolean>;

/** What an adapter returns: the raw model text, or that text plus token usage the backend reported. */
export type AdapterResult = string | { text: string; usage?: VerifierUsage };

/** The invoke callback each adapter supplies: prompt in, raw model text (and optional usage) out. */
export type AdapterInvoke = (prompt: string, options: AdapterOptions) => Promise<AdapterResult>;

export interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/** Parse `--name value` / `--flag` pairs from argv. */
export function parseArgs(argv: string[] = process.argv.slice(2)): AdapterOptions {
  const options: AdapterOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    options[token.slice(2)] = next !== undefined && !next.startsWith('--') ? argv[(index += 1)] : true;
  }
  return options;
}

/** Read the whole verification packet from stdin. */
export async function readPacket(): Promise<VerifierPacket> {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  return JSON.parse(raw) as VerifierPacket;
}

/**
 * Compose the model prompt from the packet. `packet.instructions` is already a
 * complete reviewer prompt; we append the exact target/dependencies/basis and the
 * required output schema.
 */
export function buildPrompt(packet: VerifierPacket): string {
  const context = {
    target: packet.target,
    dependencies: packet.dependencies,
    external_basis: packet.external_basis,
    scope: packet.scope,
    checker_contract: packet.checker_contract
  };
  return [
    String(packet.instructions ?? '').trim(),
    '',
    'VERIFICATION PACKET (JSON):',
    JSON.stringify(context, null, 2),
    '',
    'OUTPUT SCHEMA — return one JSON object with exactly these fields (the values below describe each field):',
    JSON.stringify(packet.output_schema ?? {}, null, 2)
  ].join('\n');
}

/** Spawn a process, optionally feed it `input` on stdin, and collect its output. */
export function runProcess(command: string, args: string[], input?: string): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.stdin.on('error', (error: NodeJS.ErrnoException) => { if (error && error.code !== 'EPIPE') reject(error); });
    child.stdin.end(input ?? '');
  });
}

/** Find the first balanced {...} JSON object that carries a "verdict" field. */
export function extractVerdict(text: string): Record<string, unknown> | null {
  const source = String(text ?? '');
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let end = start; end < source.length; end += 1) {
      const char = source[end];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed: unknown = JSON.parse(source.slice(start, end + 1));
            if (parsed && typeof parsed === 'object' && 'verdict' in parsed) return parsed as Record<string, unknown>;
          } catch { /* not this object; keep scanning */ }
          break;
        }
      }
    }
  }
  return null;
}

function normalizeVerdict(object: Record<string, unknown>): VerifierReport {
  const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
  const string = (value: unknown): string => (typeof value === 'string' ? value : '');
  return {
    // The adapter passes the verdict through verbatim; qmd-prover's normalizeReport
    // re-validates it against the allowed set, so a cast to the union is safe here.
    verdict: object.verdict as VerifierReport['verdict'],
    summary: string(object.summary),
    critical_errors: list(object.critical_errors),
    gaps: list(object.gaps),
    nonblocking_comments: list(object.nonblocking_comments ?? object.comments),
    repair_hints: string(object.repair_hints),
    refutation: string(object.refutation)
  };
}

/**
 * Optional observability: when QMD_PROVER_VERIFIER_DEBUG names a directory, write the
 * exact prompt, the model's raw stdout, and the extracted verdict for each check, keyed
 * by target id. Purely diagnostic — any failure here is swallowed so it can never affect
 * the verdict qmd-prover records. Used to inspect and tune the reviewer prompt.
 */
function debugDump(packet: VerifierPacket, part: 'prompt' | 'output' | 'verdict', value: string): void {
  const dir = process.env.QMD_PROVER_VERIFIER_DEBUG?.trim();
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    const id = String((packet.target as { id?: unknown })?.id ?? 'unknown').replace(/[^\w.-]/g, '_') || 'unknown';
    const suffix = part === 'verdict' ? 'verdict.json' : `${part}.txt`;
    writeFileSync(join(dir, `${id}.${suffix}`), value);
  } catch { /* diagnostic only */ }
}

/**
 * Standard adapter runner: read the packet, hand `(prompt, options)` to a backend
 * `invoke` that returns the model's raw text, then extract and emit the verdict.
 * On any failure it exits non-zero so qmd-prover records a verifier error.
 */
export async function runAdapter(invoke: AdapterInvoke): Promise<void> {
  const fail = (message: string, extra = ''): never => {
    process.stderr.write(`${message}${extra ? `\n${extra}` : ''}\n`);
    process.exit(1);
  };
  let packet: VerifierPacket;
  try { packet = await readPacket(); }
  catch (error) { return fail(`verifier adapter: could not parse packet on stdin: ${(error as Error).message}`); }

  const options = parseArgs();
  const prompt = buildPrompt(packet);
  debugDump(packet, 'prompt', prompt);
  let result: AdapterResult;
  try { result = await invoke(prompt, options); }
  catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err && err.code === 'ENOENT') {
      return fail(`verifier adapter: executable not found: ${options.executable}. Install it or set verification.executable to its path.`);
    }
    return fail(`verifier adapter: ${err && err.message ? err.message : String(error)}`);
  }
  const output = typeof result === 'string' ? result : result.text;
  const usage = typeof result === 'string' ? undefined : result.usage;
  debugDump(packet, 'output', String(output ?? ''));

  const verdict = extractVerdict(output);
  if (!verdict) return fail('verifier adapter: model output contained no JSON object with a "verdict" field', String(output).slice(0, 2000));
  // qmd-prover reads `usage` from the emitted JSON as metrics; it is not part of the verdict schema.
  const emitted = usage ? { ...normalizeVerdict(verdict), usage } : normalizeVerdict(verdict);
  debugDump(packet, 'verdict', JSON.stringify(emitted, null, 2));
  process.stdout.write(JSON.stringify(emitted));
}
