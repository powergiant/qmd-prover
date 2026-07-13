import { spawn } from 'node:child_process';
import path from 'node:path';
import { externalPolicyHash } from '../infrastructure/external.js';
import { AUX, readJson, sha256, stableJson } from '../infrastructure/files.js';
import { asErrorLike, asRecord, isRecord } from '../shared/core.js';
import type { JsonObject, QmdProverConfig, UnknownRecord, VerificationDecisionRecord, VerifierDecisionLocation, VerifierDecisionLookup, VerifierPacket, VerifierPacketInput, VerifierReport, VerifierTarget } from '../shared/types.js';

export const VERIFIER_PROTOCOL_VERSION = 2;

const PROTOCOL_NAME = 'qmd-prover-independent-verifier';

function verificationConfig(config: QmdProverConfig | JsonObject = {}): JsonObject {
  if (isRecord(config) && isRecord(config.verification)) return config.verification;
  return isRecord(config) ? config : {};
}

function setting(config: QmdProverConfig | JsonObject, hyphenated: string, underscored: string, fallback: unknown): unknown {
  const verification = verificationConfig(config);
  if (verification[hyphenated] !== undefined) return verification[hyphenated];
  if (verification[underscored] !== undefined) return verification[underscored];
  return fallback;
}

export function checkerContract(config: QmdProverConfig | JsonObject = {}): JsonObject {
  const verification = verificationConfig(config);
  return {
    backend: String(verification.backend ?? 'none'),
    model: String(verification.model ?? 'configurable'),
    effort: String(verification.effort ?? 'high'),
    fresh_context: Boolean(setting(config, 'fresh-context', 'fresh_context', true)),
    require_zero_gaps: Boolean(setting(config, 'require-zero-gaps', 'require_zero_gaps', true)),
    protocol: { name: PROTOCOL_NAME, version: VERIFIER_PROTOCOL_VERSION }
  };
}

export function verifierCommand(config: QmdProverConfig | JsonObject = {}): { command: string; args: string[]; source: string } | null {
  const override = process.env.QMD_PROVER_VERIFIER?.trim();
  if (override) return { command: override, args: [], source: 'environment' };

  const command = verificationConfig(config).command;
  if (Array.isArray(command) && command.length > 0 && String(command[0]).trim()) {
    return {
      command: String(command[0]),
      args: command.slice(1).map(String),
      source: 'config'
    };
  }
  if (typeof command === 'string' && command.trim()) {
    return { command: command.trim(), args: [], source: 'config' };
  }
  return null;
}

export function configured(config: QmdProverConfig | JsonObject = {}): boolean {
  return verifierCommand(config) !== null;
}

export class VerifierError extends Error {
  code: string;

  constructor(code: string, message: string, details: JsonObject = {}) {
    super(message);
    this.name = 'VerifierError';
    this.code = code;
    Object.assign(this, details);
  }
}

function excerpt(value: unknown, limit = 4000): string {
  const text = String(value ?? '').trim();
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…[truncated]`;
}

export function verifierErrorDetails(error: unknown): JsonObject {
  const value = asErrorLike(error);
  return {
    code: value.code ?? 'VERIFIER_FAILED',
    message: value.message ?? String(error),
    ...(value.command ? { command: value.command } : {}),
    ...(value.exit_code !== undefined ? { exit_code: value.exit_code } : {}),
    ...(value.signal ? { signal: value.signal } : {}),
    ...(value.stderr ? { stderr_excerpt: excerpt(value.stderr) } : {}),
    ...(value.stdout ? { stdout_excerpt: excerpt(value.stdout) } : {})
  };
}

function cloneJson<T>(value: T | undefined, fallback: T): T {
  if (value === undefined) return fallback;
  return JSON.parse(JSON.stringify(value));
}

function targetMode(target: JsonObject): string {
  return String(target?.kind ?? '').toLowerCase() === 'definition'
    ? 'definition-construction'
    : 'proof';
}

function normalizedTarget(target: JsonObject = {}): VerifierTarget {
  const value = cloneJson(target, {});
  const kind = String(value.kind ?? 'theorem').toLowerCase();
  const mode = targetMode(value);
  const identity = asRecord(value.identity);
  const source = asRecord(value.source);
  const normalized: VerifierTarget = {
    ...value,
    id: String(value.id ?? ''),
    kind,
    semantic_text: String(value.semantic_text ?? value.statement ?? value.construction ?? ''),
    proof: String(value.proof ?? ''),
    cited_dependencies: [],
    identity: { statement_hash: String(identity.statement_hash ?? ''), proof_hash: String(identity.proof_hash ?? '') },
    source: { file: String(source.file ?? '') },
    verification_mode: mode
  };

  if (mode === 'definition-construction') {
    normalized.construction = String(value.construction ?? value.statement ?? value.body ?? '');
    normalized.proof = String(value.proof ?? '');
  } else {
    normalized.statement = String(value.statement ?? '');
    normalized.proof = String(value.proof ?? '');
  }
  normalized.cited_dependencies = Array.isArray(value.cited_dependencies)
    ? value.cited_dependencies.map(String)
    : Array.isArray(value.dependencies) ? value.dependencies.map(String) : [];
  return normalized;
}

function reviewPrompt(mode: string, contract: JsonObject): string {
  const common = [
    'Act as an independent mathematical verifier, not as the author of the submission.',
    'Judge only the exact target, dependencies, scope, and external basis supplied in this packet. Do not silently import facts, assumptions, definitions, or intended meanings that are not supplied or explicitly permitted by the external basis.',
    'Check that every cited dependency is used with the hypotheses, domains, directions, side conditions, and quantified variables required by its exact statement. A citation by name is not evidence that it applies.',
    'Check quantifier order, variable binding, hidden existence or uniqueness assumptions, degenerate and boundary cases, and whether every required case is covered.',
    'Report a gap whenever a mathematically necessary step is omitted, even if the conclusion is plausible or standard. Do not repair the argument silently.',
    'Treat unavailable, out-of-scope, unresolved, stale, or unverified dependencies as unusable evidence.',
    `Return only one JSON object conforming to output_schema. The acceptance policy requires verdict="correct", no critical_errors, and ${contract.require_zero_gaps ? 'no gaps' : 'all material gaps to be reported explicitly'}.`
  ];
  if (mode === 'definition-construction') {
    common.splice(2, 0,
      'The target is a definition construction. Verify that every object and operation needed to make the construction meaningful is supplied, that all well-definedness/existence/uniqueness obligations claimed by the construction or linked justification are established, and that the construction is not circular through itself or its dependencies. Do not demand a theorem-style proof when the construction is intrinsically definitional, but do demand justification for nontrivial well-definedness claims.');
  } else {
    common.splice(2, 0,
      'The target is a theorem-like result (theorem, lemma, proposition, or corollary). Verify that the supplied proof establishes the exact statement—not a nearby, weaker, stronger, converse, or special-case claim—from the supplied hypotheses and admissible dependencies.');
  }
  return common.join('\n\n');
}

export function buildVerifierPacket({
  target,
  dependencies = [],
  externalBasis = null,
  scope = null,
  config = {}
}: VerifierPacketInput): VerifierPacket {
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new TypeError('buildVerifierPacket requires a target object');
  }
  const normalized = normalizedTarget(target);
  const mode = targetMode(normalized);
  const contract = checkerContract(config);
  return {
    schema_version: VERIFIER_PROTOCOL_VERSION,
    protocol: { name: PROTOCOL_NAME, version: VERIFIER_PROTOCOL_VERSION },
    task: 'independent-mathematical-verification',
    checker_contract: contract,
    instructions: reviewPrompt(mode, contract),
    target: normalized,
    dependencies: cloneJson(Array.isArray(dependencies) ? dependencies : [], []),
    external_basis: cloneJson(externalBasis ?? { mode: 'none', content: '' }, { mode: 'none', content: '' }),
    scope: cloneJson(scope, null),
    output_schema: {
      verdict: '"correct" or "incorrect"',
      summary: 'string',
      critical_errors: ['string'],
      gaps: ['string'],
      nonblocking_comments: ['string'],
      repair_hints: 'string'
    }
  };
}

export function verificationKey(packetOrInput: unknown, config: QmdProverConfig | JsonObject | undefined = undefined): string {
  const input = asRecord(packetOrInput);
  const wrapped = Object.hasOwn(input, 'packet');
  const packet = wrapped ? input.packet : packetOrInput;
  const suppliedContract = wrapped ? input.checker_contract : undefined;
  const contract = suppliedContract ?? asRecord(packet).checker_contract ?? checkerContract(config ?? {});
  return sha256(stableJson({ packet, checker_contract: contract }, 0));
}

export function verifierDecisionLocation(root: string, key: string): VerifierDecisionLocation {
  const digest = String(key).replace(/^sha256:/, '');
  return {
    id: `inspection-${digest.slice(0, 24)}`,
    relative: `${AUX}/verification/checks/${digest}.json`,
    file: path.join(path.resolve(root), AUX, 'verification', 'checks', `${digest}.json`)
  };
}

export async function readVerifierDecision(root: string, key: string, packet: VerifierPacket): Promise<VerifierDecisionLookup> {
  const location = verifierDecisionLocation(root, key);
  let record: UnknownRecord;
  try { record = await readJson<UnknownRecord>(location.file); }
  catch (error) { return { location, record: null, invalid: asErrorLike(error).code !== 'ENOENT' }; }
  let report: VerifierReport | null = null;
  try { report = normalizeReport(record.report); } catch { /* Invalid cached decisions fail closed. */ }
  if (!report || typeof record.submission_id !== 'string' || typeof record.source !== 'string' || typeof record.accepted !== 'boolean') {
    return { location, record: null, invalid: true };
  }
  const valid = record.verification_key === key
    && record?.packet_hash === sha256(stableJson(packet, 0))
    && record.target === packet.target.id
    && record.statement_hash === packet.target.identity.statement_hash
    && record.proof_hash === packet.target.identity.proof_hash
    && stableJson(record?.checker_contract ?? {}, 0) === stableJson(packet.checker_contract ?? {}, 0)
    && record.external_basis_hash === externalPolicyHash(packet.external_basis)
    && record.accepted === accepted(report);
  const decision: VerificationDecisionRecord | null = valid && report ? {
    ...record,
    submission_id: record.submission_id,
    accepted: record.accepted,
    source: record.source,
    report
  } : null;
  return { location, record: decision, invalid: !valid };
}

function listOfStrings(report: JsonObject, field: string, { optional = false }: { optional?: boolean } = {}): string[] {
  const value = report[field];
  if (value === undefined && optional) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new VerifierError('schema', `Verifier field ${field} must be an array of strings`, { field });
  }
  return value;
}

function stringField(report: JsonObject, field: string): string {
  if (report[field] === undefined) return '';
  if (typeof report[field] !== 'string') {
    throw new VerifierError('schema', `Verifier field ${field} must be a string`, { field });
  }
  return report[field];
}

function normalizeReport(value: unknown): VerifierReport {
  if (!isRecord(value)) {
    throw new VerifierError('schema', 'Verifier output must be a JSON object');
  }
  const report = value;
  if (report.verdict !== 'correct' && report.verdict !== 'incorrect') {
    throw new VerifierError('schema', 'Verifier verdict must be "correct" or "incorrect"', { field: 'verdict' });
  }

  const commentsField = report.nonblocking_comments !== undefined
    ? 'nonblocking_comments'
    : report.comments !== undefined ? 'comments' : null;
  return {
    verdict: report.verdict,
    summary: stringField(report, 'summary'),
    critical_errors: listOfStrings(report, 'critical_errors'),
    gaps: listOfStrings(report, 'gaps'),
    nonblocking_comments: commentsField ? listOfStrings(report, commentsField) : [],
    repair_hints: stringField(report, 'repair_hints')
  };
}

export function accepted(report: Partial<VerifierReport> | null | undefined): boolean {
  return report?.verdict === 'correct'
    && Array.isArray(report.critical_errors)
    && report.critical_errors.length === 0
    && Array.isArray(report.gaps)
    && report.gaps.length === 0;
}

interface ProcessResult { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }

function execute(command: string, args: string[], packet: VerifierPacket): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        QMD_PROVER_FRESH_CONTEXT: '1',
        QMD_PROVER_VERIFIER_PROTOCOL: String(VERIFIER_PROTOCOL_VERSION)
      }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.stdin.on('error', (error) => {
      if (asErrorLike(error).code !== 'EPIPE') reject(error);
    });
    child.stdin.end(`${JSON.stringify(packet)}\n`);
  });
}

export async function invokeVerifier(packet: VerifierPacket, config: QmdProverConfig | JsonObject = {}): Promise<VerifierReport> {
  const executable = verifierCommand(config);
  if (!executable) {
    throw new VerifierError(
      'unconfigured',
      'No verifier command configured. Set verification.command in .qmd-prover/config.yml or QMD_PROVER_VERIFIER.'
    );
  }

  let result;
  try {
    result = await execute(executable.command, executable.args, packet);
  } catch (error) {
    const failure = asErrorLike(error);
    if (failure.code === 'ENOENT') {
      throw new VerifierError('not-found', `Verifier executable not found: ${executable.command}`, {
        command: executable.command
      });
    }
    throw new VerifierError('exit', `Verifier process could not run: ${failure.message ?? String(error)}`, {
      command: executable.command,
      cause: error
    });
  }

  if (result.code !== 0) {
    const suffix = result.stderr.trim() ? `: ${result.stderr.trim()}` : '';
    throw new VerifierError('exit', `Verifier failed with exit ${result.code ?? `signal ${result.signal}`}${suffix}`, {
      command: executable.command,
      exit_code: result.code,
      signal: result.signal,
      stderr: result.stderr
    });
  }

  let report: unknown;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new VerifierError('malformed', 'Verifier did not return valid JSON', {
      stdout: result.stdout,
      stderr: result.stderr
    });
  }
  return normalizeReport(report);
}
