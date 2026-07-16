import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256, stableJson } from '../infrastructure/files.js';
import { externalPolicyHash, readExternalPolicy } from '../infrastructure/external.js';
import { asErrorLike, asRecord, isRecord } from '../shared/core.js';
import type { JsonObject } from '../shared/types.js';
import type { QmdProverConfig } from '../infrastructure/config.js';
import type { ExternalPolicy } from '../infrastructure/external.js';
import type { Compilation } from '../semantic/compiler.js';

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
  /** Run cost of the check that produced this outcome (a fresh call; 0-work for a cache hit). */
  metrics?: VerifierMetrics;
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

/** Token counts a backend reports for one check. Only fields the backend supplies are present. */
export interface VerifierUsage {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}

/**
 * Run-specific cost of one verifier invocation: wall-clock duration and, when the backend
 * reports it, token usage. These are NOT part of the verdict or the cache key — they vary per
 * run — so they travel alongside the report rather than inside it.
 */
export interface VerifierMetrics {
  duration_ms: number;
  cached?: boolean;
  usage?: VerifierUsage;
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
  proof: string;
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

export const VERIFIER_PROTOCOL_VERSION = 6;

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

/**
 * Tool capabilities the verifier may be *told* it is allowed to use (in a stable order). These are
 * prompt-level permissions only — qmd-prover neither provides tools nor enforces them; it simply
 * states in the reviewer prompt whether each is permitted, and the backend agent uses whatever it
 * actually has. Part of the checker contract, so changing them re-verifies.
 */
export const VERIFIER_TOOLS = ['file-read', 'web-search', 'code'] as const;

function toolList(verification: JsonObject): string[] {
  const raw = Array.isArray(verification.tools) ? verification.tools.map(String) : [];
  return VERIFIER_TOOLS.filter((tool) => raw.includes(tool));
}

export function checkerContract(config: QmdProverConfig | JsonObject = {}): JsonObject {
  const verification = verificationConfig(config);
  return {
    backend: String(verification.backend ?? 'none'),
    model: String(verification.model ?? 'configurable'),
    effort: String(verification.effort ?? 'high'),
    fresh_context: Boolean(setting(config, 'fresh-context', 'fresh_context', true)),
    tools: toolList(verification),
    // Two orthogonal strictness axes. `citations` (lenient|standard|strict) governs how
    // aggressively an uncited non-standard term is flagged; `rigor` (lenient|standard|strict)
    // governs how completely a valid step must be spelled out — and whether reported gaps block
    // acceptance (only `strict` does). `citations` maps 1:1 to the retired definition-strictness
    // (lenient=off, standard=soft, strict=strict); `rigor: strict` matches the retired
    // require-zero-gaps: true. Both default to `standard`.
    citations: String(verification.citations ?? 'standard'),
    rigor: String(verification.rigor ?? 'standard'),
    protocol: { name: PROTOCOL_NAME, version: VERIFIER_PROTOCOL_VERSION }
  };
}

/** True when the configured rigor makes reported gaps block acceptance (i.e. rigor === "strict"). */
export function requireZeroGaps(contract: JsonObject): boolean {
  return String(contract.rigor ?? 'strict') === 'strict';
}

/**
 * The verification environment a compilation is checked against: the external policy
 * (permitted axioms/imports) and a hash combining it with the checker contract. It is
 * a separate axis from the compiled mathematics — swapping verifier backends leaves the
 * compilation identical but changes `contextHash` — so it travels alongside a Compilation
 * rather than being part of it.
 */
export interface VerificationContext {
  externalBasis: ExternalPolicy;
  contextHash: string;
}

export async function verificationContext(compilation: Compilation): Promise<VerificationContext> {
  const externalBasis = await readExternalPolicy(compilation.root);
  const contextHash = sha256(stableJson({
    external_basis_hash: externalPolicyHash(externalBasis),
    checker_contract: checkerContract(compilation.config)
  }, 0));
  return { externalBasis, contextHash };
}

export const VERIFIER_BACKENDS = ['none', 'claude', 'codex', 'command'] as const;

/** Absolute path to a shipped verifier adapter (scripts/verifiers/<backend>.js). */
function builtinAdapter(backend: string): string {
  return fileURLToPath(new URL(`../../verifiers/${backend}.js`, import.meta.url));
}

/** The concrete model id to pass to a CLI, or '' when the backend should pick its own default. */
function modelFlag(verification: JsonObject): string {
  const model = typeof verification.model === 'string' ? verification.model.trim() : '';
  return model && model !== 'configurable' ? model : '';
}

/**
 * The reasoning-effort level to forward to a backend adapter, or '' when unset. Restricted to a
 * bare lowercase word so it is safe to splice into a CLI flag; the adapter maps it to whatever its
 * CLI expects (e.g. codex `-c model_reasoning_effort`). Keeping this in the checker contract too
 * means changing it re-keys the cache, so a different effort recomputes rather than reuses verdicts.
 */
function effortFlag(verification: JsonObject): string {
  const effort = typeof verification.effort === 'string' ? verification.effort.trim().toLowerCase() : '';
  return /^[a-z]+$/.test(effort) ? effort : '';
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
    const effort = effortFlag(verification);
    const args = [
      builtinAdapter(backend), '--executable', backendExecutable(verification, backend),
      ...(model ? ['--model', model] : []),
      ...(effort ? ['--effort', effort] : [])
    ];
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
    proof: String(value.proof ?? ''),
    identity: { statement_hash: String(identity.statement_hash ?? ''), proof_hash: String(identity.proof_hash ?? '') },
    source: { file: String(source.file ?? '') },
    verification_mode: mode
  };
  // Protocol v6 dropped semantic_text (a write-only duplicate of statement/construction)
  // and cited_dependencies (the id list now lives once in scope.direct_dependency_ids).
  // Discard either if a caller passed it through the spread above; keep semantic_text as a
  // derivation fallback so legacy input carrying only that field still yields a body.
  delete (normalized as JsonObject).semantic_text;
  delete (normalized as JsonObject).cited_dependencies;

  if (mode === 'definition-construction') {
    normalized.construction = String(value.construction ?? value.statement ?? value.body ?? value.semantic_text ?? '');
    normalized.proof = String(value.proof ?? '');
  } else {
    normalized.statement = String(value.statement ?? value.semantic_text ?? '');
    normalized.proof = String(value.proof ?? '');
  }
  return normalized;
}

/**
 * The term-citation axis, gated on verification.citations. It governs only how a specialized term
 * used without a supplied definition is treated; it never relaxes checking of the argument's actual
 * logical steps. `lenient` assumes evident meaning, `standard` flags genuine doubt, `strict` demands
 * every load-bearing term be fixed by a citation.
 */
function citationRule(citations: string): string {
  if (citations === 'strict') {
    return 'Citations (strict): every specialized term, object, or notation the argument depends on must be fixed by a definition in the semantic context or by the external basis, unless it is unambiguously standard mathematical vocabulary. Report as a gap any load-bearing term whose precise meaning is not so fixed, even when the intended meaning seems clear.';
  }
  if (citations === 'standard') {
    return 'Citations (standard): if the argument leans on a specialized term, object, or notation whose precise meaning you genuinely doubt is standard, and that meaning is not fixed by the semantic context or the external basis, report it as a gap. Do not flag ordinary, unambiguously standard vocabulary, or a notion whose intended meaning is clear from context.';
  }
  return 'Citations (lenient): do not treat the argument as defective merely because a specialized term, object, or notation is used without a supplied definition. When such a term is not fixed by the semantic context, assume its standard or contextually evident meaning and judge the argument on that basis. Never report a missing citation on its own as a defect.';
}

/**
 * The proof-rigor axis, gated on verification.rigor. It governs how completely a *valid* step must
 * be spelled out — i.e. what counts as a `gap` — never whether a step may be wrong (that floor is
 * always enforced as a critical_error). `lenient` accepts informal argument, `standard` asks for
 * material justification while allowing routine steps, `strict` demands every load-bearing step be
 * explicit (and, in code, makes any reported gap block acceptance).
 */
function rigorRule(rigor: string): string {
  if (rigor === 'strict') {
    return 'Rigor (strict): require every load-bearing step, case, and well-definedness obligation the argument actually relies on to be justified rather than merely asserted, and report as a gap any such step that is missing or only asserted — including ones a competent reader could readily supply, such as an omitted case, base case, or unproved nontrivial claim the argument uses. Do not manufacture gaps from routine notation, standard conventions, or completeness points that do not affect whether the argument or construction goes through.';
  }
  if (rigor === 'lenient') {
    return 'Rigor (lenient): judge the argument at an informal, textbook level. Take a step as evident whenever a competent reader could routinely supply it, and do not report such routine omissions; report a gap only for a step whose justification a careful reader would genuinely stop to question. A routine existence or well-definedness claim may be taken for granted.';
  }
  return 'Rigor (standard): judge the argument at an ordinary rigorous level. Report as a gap a step whose justification a competent reader would want to see spelled out, but take genuinely mechanical or immediate steps as evident, and do not manufacture gaps from routine notation, standard conventions, or completeness points that do not bear on whether the argument goes through. A routine well-definedness claim need not carry its own proof; a nontrivial one should.';
}

/** The mode-specific paragraph describing what kind of target is being checked. */
function modeParagraph(mode: VerificationMode): string {
  if (mode === 'definition-construction') {
    return 'The target is a definition: its construction introduces a term, object, or notation and normally carries no separate proof. Confirm that everything needed to make the construction meaningful is supplied or available from the semantic context and that it is not circular through itself or its dependencies. Do not demand a theorem-style proof for a purely definitional stipulation; judge any existence, uniqueness, or well-definedness claim it actually asserts at the rigor level stated below.';
  }
  if (mode === 'refutation') {
    return 'The target is a theorem-like statement accompanied by a proposed counterexample or refutation. Confirm that the argument really falsifies the exact quantified statement, satisfies every stated hypothesis, and does not merely expose a gap in some proof attempt. If it succeeds, return verdict "disproved" with a self-contained refutation; otherwise return verdict "incorrect" and explain the defect.';
  }
  return 'The target is a theorem-like result (theorem, lemma, proposition, or corollary) with a submitted proof. Confirm that the proof establishes the exact stated result, and not a nearby, weaker, stronger, converse, or special-case claim.';
}

/** How to read the external_basis field: what background mathematics each mode permits. */
function externalBasisParagraph(): string {
  return [
    'The external_basis field fixes what mathematics you may use beyond the supplied dependencies:',
    '- mode "unrestricted": you may use standard, well-established mathematics as background (ordinary set theory, induction, elementary logic, and the like), but identify any nontrivial external result you invoke precisely enough to confirm its hypotheses; do not import project-specific results that are absent from the dependencies.',
    '- mode "declared": you may use only the external results or classes of results described in external_basis.content, together with unambiguously elementary reasoning; treat anything beyond that as unavailable.',
    '- mode "none": you may use no external mathematical results at all; every nonelementary fact must come from the supplied dependencies.'
  ].join('\n');
}

/**
 * What the verifier is told about tools, driven by verification.tools. This is prompt-level only:
 * it states which capabilities are permitted — used only to *check* the submission, never to import
 * unsupplied premises — and forbids the rest. With no tools it is the strict self-contained
 * instruction. qmd-prover does not itself provide or enforce any tool.
 */
function toolsParagraph(tools: string[]): string {
  const allow = new Set(tools);
  const lead = 'Judge the submission from the material in this packet, and never rely on outside expectations about how this result is usually proved.';
  const perms: string[] = [];
  if (allow.has('code')) {
    perms.push('code execution — write and run code to carry out or check a computation, such as arithmetic, symbolic algebra, or enumerating small finite cases, and reason from its result');
  }
  if (allow.has('file-read')) {
    perms.push("reading the project's own files — to look up the definition or notation of a term the packet leaves unexplained, but never to read a dependency's proof or verification state, which stay outside this local check");
  }
  if (allow.has('web-search')) {
    perms.push('web search — to confirm the exact statement and hypotheses of an external result that the external basis permits or cites, but never to bring in a result the external basis does not allow');
  }
  if (!perms.length) {
    return `${lead} Reason from the packet alone: do not read files, run commands, or search the web.`;
  }
  const list = perms.length === 1 ? perms[0] : `${perms.slice(0, -1).join('; ')}; and ${perms[perms.length - 1]}`;
  return `${lead} You may use the following tools, and only to check the submitted argument rather than to introduce premises the packet does not supply: ${list}. Use no tool beyond these.`;
}

function reviewPrompt(mode: VerificationMode, contract: JsonObject): string {
  const sections = [
    'You are an independent mathematical verifier. Judge the submission strictly on its own merits: you did not write it, and you must neither assume it is correct nor repair it.',

    toolsParagraph(Array.isArray(contract.tools) ? contract.tools.map(String) : []),

    'This is a LOCAL, CONDITIONAL check. Assume every statement in dependencies is true exactly as written, and do not consider how or whether it was proved: dependency proofs and their verification states are withheld deliberately and composed separately. Your only question is whether the submitted argument (the proof, construction, or refutation in target) establishes the exact target from those assumed dependency statements, the semantic context, and the permitted external basis — and from nothing else.',

    modeParagraph(mode),

    'Among dependencies, entries with kind "definition" are the semantic context: each fixes the meaning of the terms and notation it introduces and may be unfolded. Every other dependency is a fact whose statement you may assume but not unfold. A citation like @some-id in the text refers to the dependency carrying that id.',

    externalBasisParagraph(),

    'Establish the exact target and nothing weaker, stronger, or adjacent. Check that every cited dependency is applied with the exact hypotheses, domains, directions, side conditions, and quantified variables its statement requires — naming a result is not evidence that it applies. Scrutinize quantifier order and scope, variable binding and capture, hidden existence, uniqueness, or well-definedness assumptions, degenerate and boundary cases, and whether every case the argument relies on is actually covered.',

    'Sort every defect you find into one of two kinds, because they are judged differently. A critical_error means the submission does not establish the target as written: a step that is wrong, invalid, or circular, a use of a dependency, definition, or hypothesis that does not actually apply, or a load-bearing part of the argument that is missing and cannot be routinely supplied. A gap means the argument is correct and complete in structure but a step is left terser or less justified than the rigor level below asks for, so a competent reader could routinely fill it. Put anything that does not bear on validity in nonblocking_comments, and never silently fill or replace a step.',

    'Correctness is a floor and is never relaxed: leniency about the meaning of a term, or about how tersely a routine step is stated, never licenses a wrong or unsupported inference. A cited definition, lemma, or hypothesis supports a step only when it applies exactly as stated — invoking one for a claim it does not entail, or appealing to a result whose hypotheses are not met, is a critical_error, not acceptable shorthand.',

    citationRule(String(contract.citations ?? 'lenient')),

    rigorRule(String(contract.rigor ?? 'strict')),

    [
      'Return exactly one JSON object matching output_schema, and nothing else — no prose, no markdown, no code fences.',
      '- verdict "correct": the submission is valid and establishes the exact target — it has no critical_errors. Still list under gaps every step left less justified than the rigor level asks for; report them honestly even when they do not overturn a correct argument.',
      '- verdict "incorrect": the submission does not establish the target as written — it has at least one critical_error. List them. This rejects the argument; it does not assert the target is false.',
      '- verdict "disproved": the exact target statement is itself false; provide a self-contained refutation.'
    ].join('\n')
  ];
  return sections.join('\n\n');
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
      verdict: 'correct | incorrect | disproved',
      summary: 'string: one or two sentences stating the overall judgement',
      critical_errors: ['string: each a wrong or invalid step that breaks the argument'],
      gaps: ['string: each a necessary step left missing or unjustified'],
      nonblocking_comments: ['string: each an observation that does not affect validity'],
      repair_hints: 'string: concrete guidance for fixing the errors and gaps, or empty',
      refutation: 'string: self-contained counterexample, nonempty iff verdict is disproved'
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

export function accepted(report: Partial<VerifierReport> | null | undefined, gapsBlock = true): boolean {
  return report?.verdict === 'correct'
    && Array.isArray(report.critical_errors)
    && report.critical_errors.length === 0
    && (!gapsBlock || (Array.isArray(report.gaps) && report.gaps.length === 0));
}

export function disproved(report: Partial<VerifierReport> | null | undefined, gapsBlock = true): boolean {
  return report?.verdict === 'disproved'
    && typeof report.refutation === 'string'
    && report.refutation.trim().length > 0
    && Array.isArray(report.critical_errors)
    && report.critical_errors.length === 0
    && (!gapsBlock || (Array.isArray(report.gaps) && report.gaps.length === 0));
}

export function verificationOutcome(
  report: Partial<VerifierReport> | null | undefined,
  packetOrMode: VerifierPacket | VerificationMode
): VerificationOutcome {
  const mode = typeof packetOrMode === 'string'
    ? packetOrMode
    : targetMode(asRecord(packetOrMode.target));
  // Only rigor "strict" makes reported gaps block acceptance; at lenient/standard a correct
  // argument with formality gaps still verifies (the gaps stay recorded as advisories).
  const gapsBlock = typeof packetOrMode === 'string' ? true : requireZeroGaps(asRecord(packetOrMode.checker_contract));
  if (mode === 'refutation') return disproved(report, gapsBlock) ? 'disproved' : 'rejected';
  if (accepted(report, gapsBlock)) return 'verified';
  if (mode === 'proof' && disproved(report, gapsBlock)) return 'disproved';
  return 'rejected';
}

interface ProcessResult { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; duration_ms: number }

function execute(command: string, args: string[], packet: VerifierPacket): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
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
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr, duration_ms: Date.now() - start }));
    child.stdin.on('error', (error) => {
      if (asErrorLike(error).code !== 'EPIPE') reject(error);
    });
    child.stdin.end(`${JSON.stringify(packet)}\n`);
  });
}

/** Read an optional `usage` object emitted by an adapter into a VerifierUsage, dropping non-numbers. */
function extractUsage(report: unknown): VerifierUsage | undefined {
  const usage = asRecord(report).usage;
  if (!isRecord(usage)) return undefined;
  const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  const result: VerifierUsage = {};
  if (num(usage.total_tokens) !== undefined) result.total_tokens = num(usage.total_tokens);
  if (num(usage.input_tokens) !== undefined) result.input_tokens = num(usage.input_tokens);
  if (num(usage.output_tokens) !== undefined) result.output_tokens = num(usage.output_tokens);
  return Object.keys(result).length ? result : undefined;
}

export async function invokeVerifier(packet: VerifierPacket, config: QmdProverConfig | JsonObject = {}): Promise<{ report: VerifierReport; metrics: VerifierMetrics }> {
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new VerifierError('malformed', 'Verifier did not return valid JSON', {
      stdout: result.stdout,
      stderr: result.stderr
    });
  }
  const usage = extractUsage(parsed);
  return {
    report: normalizeReport(parsed),
    metrics: { duration_ms: result.duration_ms, ...(usage ? { usage } : {}) }
  };
}
