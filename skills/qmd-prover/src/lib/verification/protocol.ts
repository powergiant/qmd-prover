import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256, stableJson } from '../infrastructure/files.js';
import { asErrorLike, asRecord, isRecord } from '../shared/core.js';
import type { JsonObject } from '../shared/types.js';
import type { QmdProverConfig } from '../infrastructure/config.js';

/** How a fact is discharged: constructing a definition, proving, or refuting a claim. */
export type VerificationMode = 'definition-construction' | 'proof' | 'refutation';
export type VerificationOutcome = 'verified' | 'disproved' | 'rejected';
export type GlobalVerificationStatus =
  'verified' | 'disproved' | 'blocked' | 'unverified' | 'rejected' | 'invalid';

export interface GlobalVerification {
  status: GlobalVerificationStatus;
  blockers: string[];
  reason?: string;
}

export interface DisproofEvidence {
  status: 'conditional' | 'global';
  summary: string;
  refutation: string;
  source: string;
  verification_key?: string;
}

/** A single verifier verdict recorded against a fact (local, before propagation). */
export interface AiCheck {
  status: 'pass' | 'fail' | 'error' | 'not-run';
  source?: string;
  reason?: string;
  cached?: boolean;
  attempted?: boolean;
  fatal?: boolean;
  code?: string;
  error?: string;
  remediation?: string;
  report?: VerifierReport | null;
  outcome?: VerificationOutcome;
  details?: {
    command?: string;
    exit_code?: number | null;
    signal?: string | null;
    stderr_excerpt?: string;
    stdout_excerpt?: string;
    [key: string]: unknown;
  };
  inherited?: boolean;
  submission_id?: string;
  decision_id?: string;
}

export interface VerifierReport {
  verdict: 'correct' | 'incorrect' | 'disproved';
  summary: string;
  critical_errors: string[];
  gaps: string[];
  nonblocking_comments: string[];
  repair_hints: string;
  refutation: string;
}

export interface VerifierPacketInput {
  target: JsonObject;
  dependencies?: JsonObject[];
  externalBasis?: JsonObject | null;
  scope?: unknown;
  config?: QmdProverConfig | JsonObject;
}

export interface VerifierTarget extends JsonObject {
  id: string;
  kind: string;
  semantic_text: string;
  proof: string;
  cited_dependencies: string[];
  identity: { statement_hash: string; proof_hash: string };
  source: { file: string };
  verification_mode: VerificationMode;
}

export interface VerifierPacket extends JsonObject {
  schema_version: number;
  checker_contract: JsonObject;
  target: VerifierTarget;
  dependencies: JsonObject[];
  external_basis: JsonObject;
  scope: unknown;
}

export const VERIFIER_PROTOCOL_VERSION = 5;

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
    definition_strictness: String(setting(config, 'definition-strictness', 'definition_strictness', 'off')),
    protocol: { name: PROTOCOL_NAME, version: VERIFIER_PROTOCOL_VERSION }
  };
}

export const VERIFIER_BACKENDS = ['none', 'claude', 'codex', 'command'] as const;

/** Absolute path to a shipped verifier adapter (scripts/verifiers/<backend>.mjs). */
function builtinAdapter(backend: string): string {
  return fileURLToPath(new URL(`../../verifiers/${backend}.mjs`, import.meta.url));
}

/** The concrete model id to pass to a CLI, or '' when the backend should pick its own default. */
function modelFlag(verification: JsonObject): string {
  const model = typeof verification.model === 'string' ? verification.model.trim() : '';
  return model && model !== 'configurable' ? model : '';
}

function backendExecutable(verification: JsonObject, backend: string): string {
  const configured = typeof verification.executable === 'string' ? verification.executable.trim() : '';
  return configured || backend;
}

function customCommand(command: unknown): { command: string; args: string[] } | null {
  if (Array.isArray(command) && command.length > 0 && String(command[0]).trim()) {
    return { command: String(command[0]), args: command.slice(1).map(String) };
  }
  if (typeof command === 'string' && command.trim()) return { command: command.trim(), args: [] };
  return null;
}

/**
 * The process to spawn for one verification. `claude`/`codex` backends run a shipped
 * adapter under Node that bridges the packet to that CLI, so no custom command is needed.
 * Precedence: QMD_PROVER_VERIFIER env > verification.backend claude|codex > verification.command.
 */
export function verifierCommand(config: QmdProverConfig | JsonObject = {}): { command: string; args: string[]; source: string } | null {
  const override = process.env.QMD_PROVER_VERIFIER?.trim();
  if (override) return { command: override, args: [], source: 'environment' };

  const verification = verificationConfig(config);
  const backend = String(verification.backend ?? 'none').trim();
  if (backend === 'claude' || backend === 'codex') {
    const model = modelFlag(verification);
    const args = [builtinAdapter(backend), '--executable', backendExecutable(verification, backend), ...(model ? ['--model', model] : [])];
    return { command: process.execPath, args, source: `backend:${backend}` };
  }
  const custom = customCommand(verification.command);
  return custom ? { ...custom, source: 'config' } : null;
}

/**
 * The underlying tool whose availability doctor should probe and display. For claude/codex
 * this is the CLI itself (not the Node adapter that wraps it).
 */
export function verifierProbe(config: QmdProverConfig | JsonObject = {}): { command: string; backend: string } | null {
  const override = process.env.QMD_PROVER_VERIFIER?.trim();
  if (override) return { command: override, backend: 'command' };

  const verification = verificationConfig(config);
  const backend = String(verification.backend ?? 'none').trim();
  if (backend === 'claude' || backend === 'codex') return { command: backendExecutable(verification, backend), backend };
  const custom = customCommand(verification.command);
  return custom ? { command: custom.command, backend: 'command' } : null;
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

function targetMode(target: JsonObject): VerificationMode {
  if (target.verification_mode === 'refutation') return 'refutation';
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

/**
 * A term-definedness rule, gated on verification.definition-strictness. `off` adds nothing;
 * `soft` only flags terms the verifier genuinely doubts; `strict` flags every load-bearing
 * non-standard term that is not fixed by a cited definition, semantic context, or external basis.
 */
function termDefinednessRule(strictness: string): string | null {
  if (strictness === 'soft') {
    return 'Term definedness (soft): If the argument leans on a specialized term, object, or notation whose precise meaning you genuinely doubt is standard, and that meaning is not fixed by a cited definition, the supplied semantic context, or the external basis, report it as a gap. Do not flag ordinary, unambiguously standard mathematical vocabulary.';
  }
  if (strictness === 'strict') {
    return 'Term definedness (strict): Every specialized term, object, or notation the argument depends on must be fixed by a cited definition, the supplied semantic context, or the external basis, unless it is unambiguously standard mathematical vocabulary. Report as a gap any load-bearing term whose precise meaning is not so fixed, even when its intended meaning seems clear.';
  }
  return null;
}

function reviewPrompt(mode: VerificationMode, contract: JsonObject): string {
  const common = [
    'Act as an independent mathematical verifier, not as the author of the submission.',
    'Perform a local conditional check. Assume each statement in dependencies is true, and judge whether the submitted proof establishes the exact target from those direct premises and the supplied semantic context and external basis.',
    'Check the proof that was actually submitted. Do not replace it with a different proof merely because the target may be derivable by some other argument.',
    'Do not inspect or infer whether a dependency has itself been proved. Dependency verification state and dependency proof text are deliberately absent; global validity is computed separately from the dependency graph.',
    'Judge only the exact target, direct dependency statements, semantic context, and external basis supplied in this packet. Do not silently import facts, assumptions, definitions, or intended meanings that are not supplied or explicitly permitted by the external basis.',
    'Check that every cited dependency is used with the hypotheses, domains, directions, side conditions, and quantified variables required by its exact statement. A citation by name is not evidence that it applies.',
    'Check quantifier order, variable binding, hidden existence or uniqueness assumptions, degenerate and boundary cases, and whether every required case is covered.',
    'Report a gap whenever a mathematically necessary step is omitted, even if the conclusion is plausible or standard. Do not repair the argument silently.',
    'Reject the submitted proof if it relies on an undeclared premise, a stronger version of a dependency, or an interpretation not supplied by the semantic context.',
    `Return only one JSON object conforming to output_schema. A proved claim requires verdict="correct"; a false claim requires verdict="disproved" and a nonempty refutation. Either conclusive verdict also requires no critical_errors and ${contract.require_zero_gaps ? 'no gaps' : 'all material gaps to be reported explicitly'}.`
  ];
  if (mode === 'definition-construction') {
    common.splice(2, 0,
      'The target is a definition construction. Verify that every object and operation needed to make the construction meaningful is supplied, that all well-definedness/existence/uniqueness obligations claimed by the construction or linked justification are established, and that the construction is not circular through itself or its dependencies. Do not demand a theorem-style proof when the construction is intrinsically definitional, but do demand justification for nontrivial well-definedness claims.');
  } else if (mode === 'refutation') {
    common.splice(2, 0,
      'The target is a theorem-like statement accompanied by a proposed counterexample or refutation. Check that the supplied argument really falsifies the exact quantified statement, satisfies every stated hypothesis, and does not merely expose a gap in some proof attempt. Return verdict="disproved" with a concise self-contained refutation when it succeeds; otherwise return verdict="incorrect" and explain the defect.');
  } else {
    common.splice(2, 0,
      'The target is a theorem-like result (theorem, lemma, proposition, or corollary). Verify that the supplied proof establishes the exact statement—not a nearby, weaker, stronger, converse, or special-case claim—from the supplied hypotheses and admissible dependencies.');
  }
  const termRule = termDefinednessRule(String(contract.definition_strictness ?? 'off'));
  if (termRule) common.splice(common.length - 1, 0, termRule);
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
    task: 'local-conditional-mathematical-verification',
    checker_contract: contract,
    instructions: reviewPrompt(mode, contract),
    target: normalized,
    dependencies: cloneJson(Array.isArray(dependencies) ? dependencies : [], []),
    external_basis: cloneJson(externalBasis ?? { mode: 'none', content: '' }, { mode: 'none', content: '' }),
    scope: cloneJson(scope, null),
    output_schema: {
      verdict: '"correct", "incorrect", or "disproved"',
      summary: 'string',
      critical_errors: ['string'],
      gaps: ['string'],
      nonblocking_comments: ['string'],
      repair_hints: 'string',
      refutation: 'nonempty string when verdict is "disproved"; otherwise an empty string is allowed'
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
  if (report.verdict !== 'correct' && report.verdict !== 'incorrect' && report.verdict !== 'disproved') {
    throw new VerifierError('schema', 'Verifier verdict must be "correct", "incorrect", or "disproved"', { field: 'verdict' });
  }

  const commentsField = report.nonblocking_comments !== undefined
    ? 'nonblocking_comments'
    : report.comments !== undefined ? 'comments' : null;
  const normalized: VerifierReport = {
    verdict: report.verdict,
    summary: stringField(report, 'summary'),
    critical_errors: listOfStrings(report, 'critical_errors'),
    gaps: listOfStrings(report, 'gaps'),
    nonblocking_comments: commentsField ? listOfStrings(report, commentsField) : [],
    repair_hints: stringField(report, 'repair_hints'),
    refutation: stringField(report, 'refutation')
  };
  if (normalized.verdict === 'disproved' && !normalized.refutation.trim()) {
    throw new VerifierError('schema', 'A disproved verdict requires a nonempty refutation', { field: 'refutation' });
  }
  return normalized;
}

export function accepted(report: Partial<VerifierReport> | null | undefined): boolean {
  return report?.verdict === 'correct'
    && Array.isArray(report.critical_errors)
    && report.critical_errors.length === 0
    && Array.isArray(report.gaps)
    && report.gaps.length === 0;
}

export function disproved(report: Partial<VerifierReport> | null | undefined): boolean {
  return report?.verdict === 'disproved'
    && typeof report.refutation === 'string'
    && report.refutation.trim().length > 0
    && Array.isArray(report.critical_errors)
    && report.critical_errors.length === 0
    && Array.isArray(report.gaps)
    && report.gaps.length === 0;
}

export function verificationOutcome(
  report: Partial<VerifierReport> | null | undefined,
  packetOrMode: VerifierPacket | VerificationMode
): VerificationOutcome {
  const mode = typeof packetOrMode === 'string'
    ? packetOrMode
    : targetMode(asRecord(packetOrMode.target));
  if (mode === 'refutation') return disproved(report) ? 'disproved' : 'rejected';
  if (accepted(report)) return 'verified';
  if (mode === 'proof' && disproved(report)) return 'disproved';
  return 'rejected';
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
