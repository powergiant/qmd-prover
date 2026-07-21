import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { compileProject, factErrors, factIntent, hasCheckableContent } from '../semantic/compiler.js';
import type { Compilation } from '../semantic/compiler.js';
import { externalPolicyHash } from '../infrastructure/external.js';
import { atomicJson, atomicWrite, relativePosix, sha256, stableJson } from '../infrastructure/files.js';
import { auxLayout } from '../infrastructure/aux.js';
import { findDiv, findProofs, locateDivs, readLocatedBlock, readLocatedProof, setStatusAttribute } from '../semantic/source.js';
import type { LocatedBlock, LocatedDiv } from '../semantic/source.js';
import { buildVerifierPacket, checkerContract, configured, invokeVerifier, verificationContext, verificationKey, verificationOutcome } from '../verification/protocol.js';
import { cachedDecision, verifierFailure } from '../verification/cache.js';
import type { LocalOutcome } from '../verification/cache.js';
import { asErrorLike, SCHEMA_VERSION } from '../shared/core.js';
import type { Diagnostic, JsonObject, CompilerOptions, SelectionOptions } from '../shared/types.js';
import type { FactStatusValue, ResultKind } from '../shared/core.js';
import type { VerificationContext, VerifierPacket } from '../verification/protocol.js';
import type {
  FactListStatus, GlobalVerification, GlobalVerificationStatus, LocalNotRunReason, LocalVerification,
  LocalVerificationStatus, VerificationMode, VerifierMetrics, VerifierReport
} from '../shared/verdicts.js';
import type { ReferenceCheck, SemanticResult } from '../semantic/model.js';
import { projectSourceSignature, readPublishedSnapshot } from './snapshot.js';

export interface InspectionVerificationSummary {
  available: boolean;
  eligible: number;
  verifier_calls: number;
  cache_hits: number;
  cache_misses: number;
  unusable_cache_entries: number;
  /** Wall-clock time spent in fresh verifier calls this run (cache hits do no work). */
  verifier_duration_ms: number;
  /** Total tokens reported across fresh verifier calls this run, when the backend reports them. */
  verifier_tokens: number;
  local_verified: number;
  local_disproved: number;
  local_rejected: number;
  local_not_run: number;
  global_verified: number;
  global_disproved: number;
  global_rejected: number;
  global_blocked: number;
  global_unverified: number;
  global_open: number;
  global_broken: number;
  global_abandoned: number;
  stopped_after?: string | null;
}

export interface FactInspectionCheck {
  id: string;
  status: FactListStatus;
  kind?: ResultKind;
  file?: string;
  line?: number;
  mechanical: {
    status: 'pass' | 'fail';
    verification_mode?: VerificationMode;
    references: ReferenceCheck[];
    diagnostics?: string[];
    reason?: string;
  };
  local_verification: LocalVerification;
  global_verification: GlobalVerification;
  diagnostics: Diagnostic[];
}

export interface FactMechanicalCheck {
  status: 'pass' | 'fail';
  verification_mode: VerificationMode;
  references: ReferenceCheck[];
  diagnostics: string[];
  reason?: string;
}

export interface VerifiedFact {
  id: string;
  kind: SemanticResult['kind'];
  status: GlobalVerificationStatus;
  file: string;
  line?: number;
  mechanical: FactMechanicalCheck;
  local_verification: LocalOutcome;
  global_verification: GlobalVerification;
}

export interface VerificationRun {
  verification: InspectionVerificationSummary;
  facts: VerifiedFact[];
  diagnostics: Diagnostic[];
  selected: Set<string>;
}

/** The trimmed body text of a located block, or '' when absent. Markers no longer live in the body,
 *  so the verifier packet uses the block text verbatim. */
function blockText(value: unknown): string {
  return String(value ?? '').trim();
}

function references(result: SemanticResult): ReferenceCheck[] {
  return [...(result.reference_checks ?? [])].sort((left, right) => left.dependency.localeCompare(right.dependency));
}

export function topologicalOrder(results: SemanticResult[]): SemanticResult[] {
  const ids = new Set<string>(results.map((result) => result.id));
  const byId = new Map<string, SemanticResult>(results.map((result) => [result.id, result]));
  const pending = new Map<string, Set<string>>(results.map((result) => [
    result.id,
    new Set(result.dependencies.filter((dependency) => ids.has(dependency)))
  ]));
  const dependents = new Map<string, string[]>(results.map((result) => [result.id, []]));
  for (const result of results) {
    for (const dependency of pending.get(result.id) ?? []) dependents.get(dependency)?.push(result.id);
  }
  for (const values of dependents.values()) values.sort();
  const ready = [...pending].filter(([, dependencies]) => dependencies.size === 0).map(([id]) => id).sort();
  const scheduled = new Set<string>(ready);
  const ordered: SemanticResult[] = [];
  while (ready.length) {
    const id = ready.shift();
    if (!id) continue;
    const selected = byId.get(id);
    if (!selected) continue;
    ordered.push(selected);
    for (const dependent of dependents.get(id) ?? []) {
      pending.get(dependent)?.delete(id);
      if (pending.get(dependent)?.size === 0 && !scheduled.has(dependent)) {
        ready.push(dependent);
        scheduled.add(dependent);
        ready.sort();
      }
    }
  }
  const seen = new Set(ordered.map((result) => result.id));
  ordered.push(...results.filter((result) => !seen.has(result.id)).sort((left, right) => left.id.localeCompare(right.id)));
  return ordered;
}

/**
 * Machine analysis, local conditional verification, and global composition for the
 * whole project (or the dependency closure of the selected facts). Mutates the
 * indexed results' status, local_verification, global_verification, and disproof.
 *
 * Data dependencies between the stages (each name is a `const` below):
 *
 *   selection   {requestedIds, verificationIds}
 *       │   verificationIds also scopes localVerification, composition, counts, and `selected`
 *       ▼
 *   baseline   {previousById, diagnostics}   —— mutates results in place
 *       │ diagnostics                          │ previousById
 *       ▼                                      │
 *   mechanicalDiagnostics                      │
 *       │  (read by the references /           │
 *       │   relevantErrors toolkit)            │
 *       ├──────────────── toolkit ──────┐      │
 *       │ toolkit                       ▼      ▼
 *       │                          localVerification   {outcomes, tally}
 *       │                               │             │
 *       ▼                               │ outcomes    └─ outcomes ─▶ aiDiagnostics
 *   composition   ◄──── outcomes ───────┘
 *   {facts}
 *       │
 *       ▼
 *   counts
 *
 *   verification = {...localVerification.tally, ...counts}
 *   diagnostics  = sort(mechanicalDiagnostics ++ aiDiagnostics)
 *   return { verification, facts: composition.facts, diagnostics, selected: verificationIds }
 */
export async function verifyFacts(compilation: Compilation, context: VerificationContext, options: SelectionOptions = {}): Promise<VerificationRun> {
  const root = compilation.root;
  const config = compilation.config;
  const results = compilation.manifest.results;
  const resultById = new Map<string, SemanticResult>(results.map((result) => [result.id, result]));
  const externalBasis = context.externalBasis;
  const verifierAvailable = configured(config);

  // Stage: which facts this run actually re-verifies — everything, or the
  // dependency closure of the explicitly requested ids.
  const { requestedIds, verificationIds } = (() => {
    const requestedIds = options.selectedIds
      ? new Set([...options.selectedIds].map((selected) => String(selected).replace(/^@/, '')))
      : null;
    const verificationIds = requestedIds ? new Set<string>() : new Set(results.map((result) => result.id));
    const selectDependencyClosure = (selected: string): void => {
      if (verificationIds.has(selected)) return;
      const result = resultById.get(selected);
      if (!result) return;
      verificationIds.add(selected);
      for (const dependency of result.dependencies) if (resultById.has(dependency)) selectDependencyClosure(dependency);
    };
    for (const selected of requestedIds ?? []) selectDependencyClosure(selected);
    return { requestedIds, verificationIds };
  })();

  // Stage: fold the last published snapshot into the live results (carrying
  // unchanged prior verdicts forward), and surface the prior AI diagnostics
  // that fall outside the current selection. The carry-over mutates `results`,
  // which is this function's documented contract.
  const baseline = await (async () => {
    const previousSnapshot = await readPublishedSnapshot(compilation, context.contextHash);
    const previousById = new Map((previousSnapshot?.manifest.results ?? []).map((result) => [result.id, result]));
    for (const result of results) {
      const previous = previousById.get(result.id);
      if (!previous || previous.statement_hash !== result.statement_hash || previous.proof_hash !== result.proof_hash
        || stableJson(previous.dependencies, 0) !== stableJson(result.dependencies, 0)) continue;
      if (previous.global_verification) {
        result.status = previous.status;
        result.global_verification = previous.global_verification;
        if (previous.disproof) result.disproof = previous.disproof;
      }
    }
    const diagnostics = (requestedIds && previousSnapshot)
      ? previousSnapshot.diagnostics.filter((item) => (
          item.id !== undefined && !verificationIds.has(item.id) && item.code.startsWith('AI_')
        ))
      : [];
    return { previousById, diagnostics };
  })();
  const previousById = baseline.previousById;

  // The mechanical baseline: compilation errors plus carried-over AI diagnostics.
  // The verification toolkit reads exactly this set; AI verdicts raised later in
  // this run are appended only to the final diagnostics, never to this base.
  const mechanicalDiagnostics = [...compilation.diagnostics, ...baseline.diagnostics];
  function relevantErrors(result: SemanticResult): Diagnostic[] {
    return factErrors(result, mechanicalDiagnostics);
  }

  // Stage: the `mechanical` field for every fact — is it well formed? Computed before any verifier
  // runs, because it decides what may be sent: only unbroken facts are checked at all.
  const mechanicalByFact = new Map<string, FactMechanicalCheck>(results.map((result) => {
    const checks = references(result);
    const errors = relevantErrors(result);
    const reason = !compilation.complete
      ? 'semantic-parse-incomplete'
      : errors.length
        ? 'mechanical-check-failed'
        : checks.some((check) => check.existence !== 'pass' || check.scope !== 'pass' || check.cycle !== 'pass')
          ? 'reference-check-failed'
          : null;
    return [result.id, {
      status: reason ? 'fail' : 'pass',
      verification_mode: result.kind === 'definition'
        ? 'definition-construction'
        : result.refutation ? 'refutation' : 'proof',
      references: checks,
      diagnostics: errors.map((item) => item.code).sort(),
      ...(reason ? { reason } : {})
    }];
  }));
  const mechanicalOf = (result: SemanticResult): FactMechanicalCheck =>
    mechanicalByFact.get(result.id) ?? { status: 'pass', verification_mode: 'proof', references: [], diagnostics: [] };

  /**
   * Why this fact carries no verifier verdict, or null when it is ready to be sent. This is the
   * `ready` set of docs/designs/design-status.md: unbroken, not abandoned, not draft, and with content to
   * check. The returned reason is what the global composition reads to pick `open` vs `unverified`.
   */
  function notRunReason(result: SemanticResult): LocalNotRunReason | null {
    if (result.abandon || mechanicalOf(result).status !== 'pass') return 'not-eligible';
    if (result.draft) return 'draft';
    if (!hasCheckableContent(result)) return 'nothing-to-check';
    return null;
  }

  /** The human sentence shown beside a `not-run` reason code. */
  const NOT_RUN_DETAIL: Record<LocalNotRunReason, string> = {
    'nothing-to-check': 'No proof content is present, so there is nothing to check yet.',
    draft: 'The proof is marked .draft: deliberately unfinished, so it is not sent to the verifier.',
    'not-eligible': 'The fact is broken or abandoned, so it is not sent to the verifier.',
    'out-of-scope': 'The proof is ready but fell outside the selected fact or path closure.',
    'no-backend': 'No verifier is configured; the machine dependency analysis remains available.',
    'verifier-error': 'The verifier failed, timed out, or returned an unusable report.'
  };
  const notRun = (reason: LocalNotRunReason): LocalOutcome => ({ status: 'not-run', reason, detail: NOT_RUN_DETAIL[reason] });

  // Stage: local conditional verification. Walks the graph in dependency order,
  // producing one LocalOutcome per fact plus the run-cost tally. Verifier cache
  // writes and the `result.disproof` updates are the side effects kept local to
  // this stage.
  const localVerification = await (async () => {
    const outcomes = new Map<string, LocalOutcome>();
    const tally = {
      available: verifierAvailable,
      eligible: 0,
      verifier_calls: 0,
      cache_hits: 0,
      cache_misses: 0,
      unusable_cache_entries: 0,
      verifier_duration_ms: 0,
      verifier_tokens: 0,
      stopped_after: null as string | null
    };
    let fatal: LocalOutcome | null = null;
    const initialSourceSignature = projectSourceSignature(compilation, context.contextHash);

    // Source blocks read for the verifier packets, memoised for this stage only.
    const locatedBlocks = new Map<string, LocatedBlock>();
    const located = async (result: SemanticResult): Promise<LocatedBlock> => {
      const key = `${result.id}:${result.file}`;
      const cached = locatedBlocks.get(key);
      if (cached) return cached;
      const value = await readLocatedBlock(path.join(root, result.file), result.id);
      if (!value) throw Object.assign(new Error(`Source block for @${result.id} disappeared during inspection`), { code: 'SOURCE_STALE' });
      locatedBlocks.set(key, value);
      return value;
    };

    for (const result of topologicalOrder(results)) {
      // A fact the author has not made checkable, or that is malformed, never reaches the verifier —
      // whether or not this run selected it. Its reason decides `open` vs `broken` vs `abandoned`.
      const blocked = notRunReason(result);
      if (blocked) { outcomes.set(result.id, notRun(blocked)); continue; }

      if (!verificationIds.has(result.id)) {
        const previous = previousById.get(result.id);
        outcomes.set(result.id, previous?.local_verification ?? notRun('out-of-scope'));
        continue;
      }
      tally.eligible += 1;

      if (!verifierAvailable) { outcomes.set(result.id, notRun('no-backend')); continue; }

      let packet;
      try {
        packet = await (async (): Promise<VerifierPacket> => {
          const block = await located(result);
          const statement = blockText(block.statement?.text);
          const proof = await (async () => {
            if (result.proof_file && result.proof_file !== result.file) {
              const proofBlock = await readLocatedProof(path.join(root, result.proof_file), result.id);
              if (!proofBlock) throw Object.assign(new Error(`Linked proof of @${result.id} disappeared during inspection`), { code: 'SOURCE_STALE' });
              return blockText(proofBlock.proof?.text);
            }
            return blockText(block.proof?.text);
          })();

          const dependencies = await (async () => {
            const collected: JsonObject[] = [];
            for (const dependency of [...new Set(result.dependencies)].sort()) {
              const dependencyResult = resultById.get(dependency);
              // Unresolved @IDs are rejected mechanically. Permitted outside mathematics
              // is supplied only through externalBasis, never as an implicit graph fact.
              if (!dependencyResult) continue;
              const dependencyBlock = await located(dependencyResult);
              const dependencyStatement = blockText(dependencyBlock.statement?.text);
              collected.push({
                id: dependency,
                kind: dependencyResult.kind,
                title: dependencyResult.title,
                statement: dependencyStatement,
                origin: dependencyResult.origin === 'user' ? 'main-goal' : 'fact',
                identity: {
                  statement_hash: dependencyResult.statement_hash
                },
                source: { file: dependencyResult.file }
              });
            }
            return collected;
          })();

          // The definition entries in `dependencies` are the semantic context (see reviewPrompt);
          // scope states the frontier as a flat id list rather than re-embedding those bodies.
          const scope = {
            type: 'local-conditional-check',
            source_file: result.file,
            direct_dependency_ids: dependencies.map((dependency) => dependency.id)
          };
          return buildVerifierPacket({
            target: {
              id: result.id,
              kind: result.kind,
              title: result.title,
              ...(result.kind === 'definition' ? { construction: statement } : { statement }),
              proof,
              identity: { statement_hash: result.statement_hash, proof_hash: result.proof_hash },
              source: { file: result.file },
              verification_mode: result.refutation ? 'refutation' : result.kind === 'definition' ? 'definition-construction' : 'proof'
            },
            dependencies,
            externalBasis,
            scope,
            config
          });
        })();
      }
      catch (error) {
        const failure = verifierFailure(error, result.id);
        failure.code = String(asErrorLike(error).code ?? 'SOURCE_STALE');
        failure.failed_target = result.id;
        outcomes.set(result.id, failure);
        continue;
      }
      const key = verificationKey(packet);
      const cached = await cachedDecision(root, result.id, key, packet);
      if (cached.invalid) tally.unusable_cache_entries += 1;
      let report: VerifierReport;
      let source: string;
      let cachedResult = false;
      let metrics: VerifierMetrics | undefined;
      if (cached.record) {
        report = cached.record.report;
        source = 'verification-cache';
        cachedResult = true;
        tally.cache_hits += 1;
        // Surface the originally-recorded cost, flagged as cached (this run did no verifier work).
        const recorded = (cached.record as { metrics?: VerifierMetrics }).metrics;
        metrics = recorded ? { ...recorded, cached: true } : { duration_ms: 0, cached: true };
      } else if (fatal) {
        outcomes.set(result.id, fatal.failed_target
          ? verifierFailure(fatal, fatal.failed_target, true)
          : { ...fatal, inherited: true });
        continue;
      } else {
        tally.cache_misses += 1;
        tally.verifier_calls += 1;
        try { ({ report, metrics } = await invokeVerifier(packet, config)); }
        catch (error) {
          const failure = verifierFailure(error, result.id);
          failure.failed_target = result.id;
          const now = new Date().toISOString();
          const failureFile = auxLayout(root).failure(key, now.replace(/[-:.TZ]/g, ''));
          try {
            await atomicJson(failureFile, {
              schema_version: 1,
              operation: 'local-conditional-verification-failed',
              target: result.id,
              failed_at: now,
              verification_key: key,
              checker_contract: checkerContract(config),
              error: failure.details ?? { code: failure.code, message: failure.error },
              remediation: failure.remediation
            });
            failure.failure_report = relativePosix(root, failureFile);
          } catch { /* The structured command error remains the primary result. */ }
          fatal = failure;
          outcomes.set(result.id, failure);
          tally.stopped_after = result.id;
          continue;
        }

        let contextCurrent = false;
        try {
          const currentCompilation = await compileProject(root, { ...options, write: false });
          const currentContext = await verificationContext(currentCompilation);
          contextCurrent = projectSourceSignature(currentCompilation, currentContext.contextHash) === initialSourceSignature;
        } catch { contextCurrent = false; }
        if (!contextCurrent) {
          fatal = verifierFailure(Object.assign(new Error(`Project sources or verification context changed while @${result.id} was being checked`), { code: 'SOURCE_STALE' }), result.id);
          fatal.failed_target = result.id;
          outcomes.set(result.id, fatal);
          tally.stopped_after = result.id;
          continue;
        }

        if (metrics) {
          tally.verifier_duration_ms += metrics.duration_ms;
          tally.verifier_tokens += metrics.usage?.total_tokens ?? 0;
        }
        const record = {
          schema_version: SCHEMA_VERSION,
          operation: 'local-conditional-verification',
          target: result.id,
          verified_at: new Date().toISOString(),
          outcome: verificationOutcome(report, packet),
          accepted: verificationOutcome(report, packet) !== 'rejected',
          report,
          ...(metrics ? { metrics } : {}),
          statement_hash: result.statement_hash,
          proof_hash: result.proof_hash,
          dependency_snapshot: Object.fromEntries(packet.dependencies.map((dependency) => [String(dependency.id), {
            origin: dependency.origin,
            identity: dependency.identity
          }])),
          scope: packet.scope,
          external_basis_hash: externalPolicyHash(externalBasis),
          checker_contract: checkerContract(config),
          verification_key: key,
          packet_hash: sha256(stableJson(packet, 0)),
          packet
        };
        try { await atomicJson(cached.location.file, record); }
        catch (error) {
          fatal = verifierFailure(Object.assign(new Error(`Verifier result for @${result.id} could not be cached safely: ${asErrorLike(error).message}`), { code: 'CACHE_WRITE_FAILED' }), result.id);
          fatal.failed_target = result.id;
          outcomes.set(result.id, fatal);
          tally.stopped_after = result.id;
          continue;
        }
        source = 'independent-verifier';
      }

      const decision = verificationOutcome(report, packet);
      const outcome: LocalOutcome = {
        status: decision,
        source,
        cached: cachedResult,
        verification_key: key,
        report,
        ...(metrics ? { metrics } : {})
      };
      outcomes.set(result.id, outcome);
      if (decision === 'disproved') {
        result.disproof = {
          status: 'conditional',
          summary: report.summary,
          refutation: report.refutation,
          source: 'local-verifier-evidence',
          verification_key: key
        };
      } else delete result.disproof;
    }
    return { outcomes, tally };
  })();
  const outcomes = localVerification.outcomes;

  // Stage: the AI diagnostics implied by the local outcomes — a rejected proof
  // becomes a warning, a checker failure an error. Produced as data rather than
  // pushed into a shared array, and kept separate from `mechanicalDiagnostics`.
  const aiDiagnostics = (() => {
    const items: Diagnostic[] = [];
    for (const result of results) {
      const outcome = outcomes.get(result.id);
      if (!outcome) throw new Error(`Verification outcome for @${result.id} was not recorded`);
      if (outcome.status === 'rejected') items.push({
        severity: 'warning', code: result.refutation ? 'AI_DISPROOF_REJECTED' : 'AI_CHECK_REJECTED',
        message: result.refutation
          ? `Local conditional verification did not confirm the proposed refutation of @${result.id}: ${outcome.report?.summary || 'critical errors or gaps remain'}`
          : `Local conditional verification rejected the submitted proof of @${result.id}: ${outcome.report?.summary || 'critical errors or gaps remain'}`,
        file: result.file, line: result.proof_line ?? result.line, id: result.id,
        repair_hints: outcome.report?.repair_hints ?? ''
      });
      if (outcome.reason === 'verifier-error') items.push({
        severity: 'error', code: outcome.code ?? 'AI_CHECK_FAILED',
        message: `Local conditional verification could not check @${result.id}: ${outcome.error}`,
        file: result.file, line: result.proof_line ?? result.line, id: result.id,
        remediation: outcome.remediation
      });
    }
    return items;
  })();

  // Stage: global composition. Combines the mechanical check and the local
  // outcome for each fact, walking in dependency order so a fact can read its
  // dependencies' already-computed global verdicts. Writing the composed verdict
  // and status back onto `results` is this function's documented contract.
  const composition = (() => {
    const globalById = new Map<string, GlobalVerification>();
    const facts: VerifiedFact[] = [];
    for (const result of topologicalOrder(results)) {
      const mechanical = mechanicalOf(result);
      const local = outcomes.get(result.id) ?? notRun('out-of-scope');
      // The seven rules of docs/designs/design-status.md, in order. First match wins, the values are
      // disjoint, and rule 2 keeps cycles out of rules 6-7 so this always terminates.
      const global = ((): GlobalVerification => {
        if (result.abandon) return { status: 'abandoned', blockers: [], reason: 'author-abandoned' };
        if (mechanical.status !== 'pass') {
          const blockers = references(result)
            .filter((check) => check.existence !== 'pass' || check.scope !== 'pass' || check.cycle !== 'pass')
            .map((check) => check.dependency).sort();
          return { status: 'broken', blockers, reason: mechanical.reason ?? 'mechanical-check-failed' };
        }
        if (local.status === 'not-run') {
          const reason = local.reason ?? 'out-of-scope';
          return reason === 'nothing-to-check' || reason === 'draft'
            ? { status: 'open', blockers: [], reason }
            : { status: 'unverified', blockers: [], reason };
        }
        if (local.status === 'rejected') return { status: 'rejected', blockers: [], reason: 'local-verification-rejected' };
        const blockers = result.dependencies.filter((dependency) => (
          resultById.has(dependency) && globalById.get(dependency)?.status !== 'verified'
        )).sort();
        return blockers.length
          ? { status: 'blocked', blockers, reason: 'dependency-closure-not-verified' }
          : { status: local.status, blockers: [] };
      })();
      globalById.set(result.id, global);
      result.intent = factIntent(result);
      result.mechanical = mechanical.status === 'pass' ? 'ok' : 'broken';
      result.global_verification = global;
      result.local_verification = local.status === 'not-run'
        ? local
        : {
            status: local.status,
            source: 'local-verifier-evidence',
            verification_key: local.verification_key,
            report: local.report,
            ...(local.metrics ? { metrics: local.metrics } : {})
          };
      result.status = global.status;
      if (verificationIds.has(result.id) && local.status !== 'disproved') delete result.disproof;
      if (result.disproof) result.disproof.status = global.status === 'disproved' ? 'global' : 'conditional';
      facts.push({
        id: result.id,
        kind: result.kind,
        status: result.status,
        file: result.file,
        line: result.line,
        mechanical,
        local_verification: local,
        global_verification: global
      });
    }
    facts.sort((left, right) => left.id.localeCompare(right.id));
    return { facts };
  })();

  // Stage: the per-status counts over the facts inside the current selection.
  const counts = (() => {
    const scopedFacts = composition.facts.filter((fact) => verificationIds.has(fact.id));
    const countLocal = (status: LocalVerificationStatus): number =>
      scopedFacts.filter((fact) => fact.local_verification.status === status).length;
    const countGlobal = (status: GlobalVerificationStatus): number =>
      scopedFacts.filter((fact) => fact.global_verification.status === status).length;
    return {
      local_verified: countLocal('verified'),
      local_disproved: countLocal('disproved'),
      local_rejected: countLocal('rejected'),
      local_not_run: countLocal('not-run'),
      global_verified: countGlobal('verified'),
      global_disproved: countGlobal('disproved'),
      global_rejected: countGlobal('rejected'),
      global_blocked: countGlobal('blocked'),
      global_unverified: countGlobal('unverified'),
      global_open: countGlobal('open'),
      global_broken: countGlobal('broken'),
      global_abandoned: countGlobal('abandoned')
    };
  })();

  const verification: InspectionVerificationSummary = { ...localVerification.tally, ...counts };
  const diagnostics = [...mechanicalDiagnostics, ...aiDiagnostics]
    .sort((left, right) => `${left.file ?? ''}:${left.line ?? 0}:${left.code}:${left.id ?? ''}`.localeCompare(`${right.file ?? ''}:${right.line ?? 0}:${right.code}:${right.id ?? ''}`));
  return { verification, facts: composition.facts, diagnostics, selected: verificationIds };
}

/**
 * The `status` value a checked fact's local verdict projects to, or null to clear it. It carries
 * the verdict itself — what the verifier concluded about the statement — so an accepted refutation
 * writes `disproved`, never `verified`. A fact not conclusively checked carries no status.
 */
function projectedStatus(outcome: LocalOutcome): FactStatusValue | null {
  return outcome.status === 'not-run' ? null : outcome.status;
}

/**
 * Project each freshly checked fact's local verdict into a display-only `status` attribute on its
 * source div — the linked proof div for a theorem-like result, the result div for a definition.
 * The attribute is excluded from every content hash, the verifier packet, the cache key, and the
 * snapshot identity, and is never read back, so writing it can never invalidate a cached decision.
 * Only facts re-checked this run (`run.selected`) are touched; a fact not conclusively checked has
 * any prior status cleared. A no-op when write mode is off.
 */
export async function writeStatusProjection(compilation: Compilation, run: VerificationRun, options: CompilerOptions = {}): Promise<void> {
  if (options.write === false) return;
  const root = compilation.root;
  const resultById = new Map(compilation.manifest.results.map((result) => [result.id, result]));
  const factById = new Map(run.facts.map((fact) => [fact.id, fact]));
  interface FactEdit { file: string; kind: ResultKind; id: string; proofLine?: number; status: FactStatusValue | null }
  const perFact: FactEdit[] = [];
  for (const id of run.selected) {
    const result = resultById.get(id);
    const fact = factById.get(id);
    if (!result || !fact) continue;
    // A theorem-like carries status on its proof div (wherever it lives); a definition on its own div.
    const file = result.kind === 'definition' ? result.file : result.proof_file ?? result.file;
    perFact.push({ file, kind: result.kind, id, proofLine: result.proof_line, status: projectedStatus(fact.local_verification) });
  }
  for (const file of new Set(perFact.map((entry) => entry.file))) {
    const absolute = path.join(root, file);
    let source: string;
    try { source = await readFile(absolute, 'utf8'); }
    catch { continue; }
    const edits: Array<{ div: LocatedDiv; status: FactStatusValue | null }> = [];
    // Every fact in this file searches the same div list, so scan the source once for all of them.
    const divs = locateDivs(source);
    for (const entry of perFact.filter((item) => item.file === file)) {
      if (entry.kind === 'definition') {
        const div = findDiv(divs, entry.id);
        if (div) edits.push({ div, status: entry.status });
        continue;
      }
      // The active proof carries the verdict; any abandoned attempt beside it is cleared.
      const proofs = findProofs(divs, entry.id);
      const active = proofs.find((div) => div.startLine === entry.proofLine) ?? proofs[0];
      for (const div of proofs) edits.push({ div, status: div === active ? entry.status : null });
    }
    // Apply from the bottom of the file up so each fence edit leaves earlier offsets valid.
    let next = source;
    for (const { div, status } of edits.sort((left, right) => right.div.start - left.div.start)) {
      next = setStatusAttribute(next, div, status);
    }
    if (next !== source) await atomicWrite(absolute, next);
  }
}
