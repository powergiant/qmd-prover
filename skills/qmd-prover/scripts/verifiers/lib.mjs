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
// Dependency-free: Node builtins only.

import { spawn } from 'node:child_process';

/** Parse `--name value` / `--flag` pairs from argv. */
export function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    options[token.slice(2)] = next !== undefined && !next.startsWith('--') ? argv[(index += 1)] : true;
  }
  return options;
}

/** Read the whole verification packet from stdin. */
export async function readPacket() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  return JSON.parse(raw);
}

/**
 * Compose the model prompt from the packet. `packet.instructions` is already a
 * complete reviewer prompt; we append the exact target/dependencies/basis and the
 * required output schema.
 */
export function buildPrompt(packet) {
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
    'Respond with ONLY one JSON object matching this schema — no prose, no markdown fences:',
    JSON.stringify(packet.output_schema ?? {})
  ].join('\n');
}

/** Spawn a process, optionally feed it `input` on stdin, and collect its output. */
export function runProcess(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.stdin.on('error', (error) => { if (error && error.code !== 'EPIPE') reject(error); });
    child.stdin.end(input ?? '');
  });
}

/** Find the first balanced {...} JSON object that carries a "verdict" field. */
export function extractVerdict(text) {
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
            const parsed = JSON.parse(source.slice(start, end + 1));
            if (parsed && typeof parsed === 'object' && 'verdict' in parsed) return parsed;
          } catch { /* not this object; keep scanning */ }
          break;
        }
      }
    }
  }
  return null;
}

function normalizeVerdict(object) {
  const list = (value) => (Array.isArray(value) ? value.map(String) : []);
  const string = (value) => (typeof value === 'string' ? value : '');
  return {
    verdict: object.verdict,
    summary: string(object.summary),
    critical_errors: list(object.critical_errors),
    gaps: list(object.gaps),
    nonblocking_comments: list(object.nonblocking_comments ?? object.comments),
    repair_hints: string(object.repair_hints),
    refutation: string(object.refutation)
  };
}

/**
 * Standard adapter runner: read the packet, hand `(prompt, options)` to a backend
 * `invoke` that returns the model's raw text, then extract and emit the verdict.
 * On any failure it exits non-zero so qmd-prover records a verifier error.
 */
export async function runAdapter(invoke) {
  const fail = (message, extra = '') => {
    process.stderr.write(`${message}${extra ? `\n${extra}` : ''}\n`);
    process.exit(1);
  };
  let packet;
  try { packet = await readPacket(); }
  catch (error) { return fail(`verifier adapter: could not parse packet on stdin: ${error.message}`); }

  const options = parseArgs();
  let output;
  try { output = await invoke(buildPrompt(packet), options); }
  catch (error) {
    if (error && error.code === 'ENOENT') {
      return fail(`verifier adapter: executable not found: ${options.executable}. Install it or set verification.executable to its path.`);
    }
    return fail(`verifier adapter: ${error && error.message ? error.message : String(error)}`);
  }

  const verdict = extractVerdict(output);
  if (!verdict) return fail('verifier adapter: model output contained no JSON object with a "verdict" field', String(output).slice(0, 2000));
  process.stdout.write(JSON.stringify(normalizeVerdict(verdict)));
}
