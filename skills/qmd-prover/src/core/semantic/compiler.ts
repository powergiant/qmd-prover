import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson, cleanId, readJson, relativePosix, sha256, stableJson } from '../infrastructure/files.js';
import { auxLayout, scaffoldAux } from '../infrastructure/aux.js';
import { loadConfig, pandocCommand } from '../infrastructure/config.js';
import { divContent, inlineText, metaValue, normalizedAst, readAst, references, walk } from './pandoc.js';
import { findDiv, findProofs, locateDivs } from './source.js';
import {
  ABANDON_CLASS, DISPROOF_CLASS, DRAFT_CLASS, KIND_BY_PREFIX, RESULT_KINDS, SCHEMA_VERSION,
  SEMANTIC_ID_PATTERN, SEMANTIC_PREFIX_PATTERN
} from '../shared/core.js';
import type { ResultKind } from '../shared/core.js';
import type { FactIntent, GlobalVerificationStatus } from '../shared/verdicts.js';
import { asArray, asRecord, errorMessage, uniqueSorted } from '../shared/core.js';
import type { PandocAttributes, PandocDocument, PandocNode } from './pandoc.js';
import type { CompilerOptions, Diagnostic, DiagnosticSeverity, UnknownRecord } from '../shared/types.js';
import type { QmdProverConfig } from '../infrastructure/config.js';
import type {
  ImportDeclaration, Manifest, ProofRecord, SemanticResult, SourceFileRecord
} from './model.js';
import { discover, discoveryExclusions } from './discovery.js';
import { findCycles } from './dependency-graph.js';
import type { DependencyGraph } from './dependency-graph.js';
export { findCycles } from './dependency-graph.js';

export interface CompilationSummary {
  files: number;
  results: number;
  errors: number;
  warnings: number;
  goals?: Array<{ id: string; status: string; file: string; line?: number }>;
}

export interface Compilation {
  root: string;
  config: QmdProverConfig;
  manifest: Manifest;
  graph: DependencyGraph;
  diagnostics: Diagnostic[];
  summary: CompilationSummary;
  /** User-owned main goals (the `origin === 'user'` results), a view of the manifest. */
  goals: SemanticResult[];
  /** Per-file listing of which goals each source file declares. */
  notes: Array<{ path: string; goals: string[] }>;
  ok: boolean;
  complete: boolean;
}

function diagnostic(
  severity: DiagnosticSeverity,
  code: string,
  message: string,
  file?: string,
  line?: number,
  id?: string
): Diagnostic {
  return { severity, code, message, ...(file ? { file } : {}), ...(line ? { line } : {}), ...(id ? { id } : {}) };
}


interface SemanticEntry { type: 'proof' | 'result'; attribute: PandocAttributes; blocks: PandocNode[]; kind?: ResultKind }
interface ParsedProof extends ProofRecord {
  blocks: PandocNode[];
}

function importsFromMeta(ast: PandocDocument, file: string, diagnostics: Diagnostic[]): ImportDeclaration[] {
  const metadata = metaValue(ast.meta?.['qmd-prover']);
  if (metadata == null) return [];
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    diagnostics.push(diagnostic('error', 'IMPORT_METADATA_INVALID', 'qmd-prover metadata must be a map', file));
    return [];
  }
  const declarations = asRecord(metadata).imports ?? [];
  if (!Array.isArray(declarations)) {
    diagnostics.push(diagnostic('error', 'IMPORT_METADATA_INVALID', 'qmd-prover.imports must be a list', file));
    return [];
  }
  return declarations.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      diagnostics.push(diagnostic('error', 'IMPORT_METADATA_INVALID', 'Each qmd-prover import must be a map', file));
      return { from: '', use: [] };
    }
    const record = asRecord(entry);
    const from = typeof record.from === 'string' ? record.from : '';
    const use = Array.isArray(record.use) ? record.use.map(String).map(cleanId) : [];
    if (!from) diagnostics.push(diagnostic('error', 'IMPORT_FROM_MISSING', 'Import metadata requires a from path', file));
    if (use.length === 0) diagnostics.push(diagnostic('error', 'IMPORT_USE_MISSING', 'Import metadata requires an explicit, nonempty use list', file));
    return { from, use };
  });
}

function semanticDivs(ast: PandocDocument): SemanticEntry[] {
  const entries: SemanticEntry[] = [];
  walk(ast.blocks, (node) => {
    if (node.t !== 'Div') return;
    const { attr, blocks } = divContent(node);
    const kind = RESULT_KINDS.find((candidate) => attr.classes.includes(candidate));
    if (attr.classes.includes('proof')) entries.push({ type: 'proof', attribute: attr, blocks });
    else if (attr.id && (SEMANTIC_PREFIX_PATTERN.test(attr.id) || kind)) entries.push({ type: 'result', attribute: attr, blocks, kind });
  });
  return entries;
}

function validIntroductionDate(value: unknown): boolean {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function resolveImport(importer: string, imported: string): string | null {
  const candidate = path.posix.normalize(path.posix.join(path.posix.dirname(importer), imported));
  return candidate.startsWith('../') || path.posix.isAbsolute(candidate) ? null : candidate;
}

/**
 * The `intent` field of the status model: what the author declared, read off the div attributes
 * and nothing else. Never computed from proof content and never overwritten by the engine.
 * `.abandon` outranks `.draft`, which outranks `.disproof`, so a drafted refutation is a draft —
 * it is not sent either way, and the refutation reading does not matter until it is.
 */
export function factIntent(result: SemanticResult): FactIntent {
  if (result.abandon) return 'abandoned';
  if (result.draft) return 'draft';
  return result.refutation ? 'disproof' : 'normal';
}

/** True when the fact has proof content to check. A definition is discharged by its own body. */
export function hasCheckableContent(result: SemanticResult): boolean {
  return result.kind === 'definition' || result.proof_present;
}

/** The error-severity diagnostics that speak about one fact: by ID, else by the file it lives in. */
export function factErrors(result: SemanticResult, diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.filter((item) => item.severity === 'error' && (
    item.id
      ? item.id === result.id
      : item.file === result.file || (result.proof_file && item.file === result.proof_file)
  ));
}

/**
 * The `mechanical` field: is this fact well formed? Shape, ID, date, references, and cycles —
 * never proof content, and never anything upstream. A fact with no proof written is well formed;
 * a fact citing a broken lemma is well formed. Both are questions for `global`, not for this.
 */
export function isBroken(result: SemanticResult, errors: Diagnostic[]): boolean {
  if (factErrors(result, errors).length) return true;
  return (result.reference_checks ?? []).some((check) => (
    check.existence !== 'pass' || check.scope !== 'pass' || (check.cycle ?? 'pass') !== 'pass'
  ));
}

/**
 * Rules 1-5 of the global composition, for a fact with no local verdict on record. `verifyFacts`
 * re-runs all seven rules once verdicts exist. See docs/designs/design-status.md.
 */
export function preVerificationStatus(result: SemanticResult, broken: boolean): GlobalVerificationStatus {
  if (result.abandon) return 'abandoned';
  if (broken) return 'broken';
  if (result.draft || !hasCheckableContent(result)) return 'open';
  return 'unverified';
}

export async function compileProject(root = process.cwd(), options: CompilerOptions = {}): Promise<Compilation> {
  // Data-flow overview. Each stage is an IIFE that returns its complete result plus its own
  // diagnostics; the larger stages use the same trick internally (sub-stages in brackets).
  //
  //   project                                             { root, config, pandoc, discovered }
  //     |
  //     v
  //   parsed         [ parsedProof | parsedResult ]       { files, results, proofs, diagnostics }
  //     |
  //     v
  //   indexed                                             { byId, idCounts, byExport, proofsByTarget, diagnostics }
  //     |
  //     v
  //   linked         [ overlay | imports ]             --.  { availableByFile, importAdjacency, diagnostics }
  //     |                                                |  overlay + analyzed enrich the
  //     v                                                |  parse-ordered `results` in place
  //   analyzed       [ references | cycles | statuses ]--'  { dependencyCycles, diagnostics }
  //     |
  //     v
  //   resolvedDiagnostics = parsed + indexed + linked + analyzed diagnostics (execution order)
  //     |
  //     v
  //   locked         (reads resolvedDiagnostics for the per-goal clean check)  { locks, locksChanged, diagnostics }
  //     |
  //     v
  //   output         [ graph -> manifest ], on sorted copies of results/files  -> Compilation
  //
  // Resolve the environment: where we are, how we read sources, and which files are in scope.
  const project = await (async () => {
    const resolvedRoot = path.resolve(root);
    if (options.write !== false) await scaffoldAux(resolvedRoot);
    const config = await loadConfig(resolvedRoot);
    const pandoc = pandocCommand(config, options.pandoc);
    const exclusions = await discoveryExclusions(resolvedRoot, config);
    const found = options.files
      ? options.files.map((absolute) => ({ absolute: path.resolve(absolute), relative: relativePosix(resolvedRoot, path.resolve(absolute)) }))
      : await discover(resolvedRoot, resolvedRoot, exclusions);
    const excludedFiles = new Set((options.excludeFiles ?? []).map((file) => path.resolve(file)));
    const discovered = excludedFiles.size ? found.filter((file) => !excludedFiles.has(file.absolute)) : found;
    return { root: resolvedRoot, config, pandoc, discovered };
  })();

  // Parse every source into results, proofs, and per-file structure. Each result object
  // created here is enriched in place by the `linked` and `analyzed` stages below, so the
  // later stages keep reading the same objects the indexes point at.
  const parsed = await (async () => {
    const config = project.config;
    const diagnostics: Diagnostic[] = [];
    const files: SourceFileRecord[] = [];
    const results: SemanticResult[] = [];
    const proofs: ParsedProof[] = [];
    for (const file of project.discovered) {
      try {
        const [ast, source] = await Promise.all([readAst(file.absolute, { pandoc: project.pandoc }), readFile(file.absolute, 'utf8')]);
        const entries = semanticDivs(ast);
        // Line numbers come from the raw source, not the AST, so every entry needs a lookup against
        // it. Scan the file once here and search that list per entry.
        const divs = locateDivs(source);
        const imports = importsFromMeta(ast, file.relative, diagnostics);
        const fileResults: SemanticResult[] = [];
        const fileProofs: ParsedProof[] = [];
        for (const entry of entries) {
          const { id, classes, values } = entry.attribute;
          const blocks = entry.blocks;
          const target = cleanId(String(values.of ?? ''));
          const located = entry.type === 'proof' ? (target ? findProofs(divs, target)[0] ?? null : null) : findDiv(divs, id);
          const line = located?.startLine;
          const text = inlineText(blocks);
          const hash = sha256(stableJson(normalizedAst(blocks), 0));
          const present = text.length > 0 || blocks.some((block) => block.t !== 'Null');
          const dependencies = references(blocks);
          const abandon = classes.includes(ABANDON_CLASS);
          const draft = classes.includes(DRAFT_CLASS);
          const disproof = classes.includes(DISPROOF_CLASS);
          if (entry.type === 'proof') {
            // A proof entry becomes a proof record plus its own structural diagnostics.
            const parsedProof = (() => {
              const diagnostics: Diagnostic[] = [];
              const proof: ParsedProof = {
                target, file: file.relative, line,
                refutation: disproof,
                draft,
                abandon,
                proof_hash: hash,
                proof_present: present,
                proof_text: text,
                dependencies,
                blocks
              };
              if (!target) diagnostics.push(diagnostic('error', 'PROOF_TARGET_MISSING', 'A .proof block requires an of attribute', file.relative, line));
              // An empty proof block says the same thing as no proof block: the fact is open. That is a
              // legitimate state, so this is a warning — it exists only so a block emptied by a bad edit
              // stays visible. An abandoned or drafted proof is expected to be incomplete, so it is silent.
              if (!abandon && !draft && !present) diagnostics.push(diagnostic('warning', 'PROOF_EMPTY', `Proof of @${target || '?'} is empty; @${target || '?'} is open`, file.relative, line, target));
              return { proof, diagnostics };
            })();
            fileProofs.push(parsedProof.proof);
            proofs.push(parsedProof.proof);
            diagnostics.push(...parsedProof.diagnostics);
            continue;
          }

          // A result entry becomes a semantic-result record plus its own validation diagnostics.
          const parsedResult = (() => {
            const diagnostics: Diagnostic[] = [];
            const semanticKinds = classes.filter((item): item is ResultKind => RESULT_KINDS.includes(item as ResultKind));
            const kind = entry.kind ?? 'unknown';
            const title = String(values.name ?? '');
            const date = String(values.date ?? '');
            const constructionDependencies = kind === 'definition' ? dependencies : [];
            const result: SemanticResult = {
              id, file: file.relative, line, kind, classes: [...classes].sort(), title, date,
              origin: id.startsWith(config.goals['id-prefix']) ? 'user' : 'agent',
              intent: 'normal',
              mechanical: 'ok',
              status: 'open',
              export: values.export == null ? null : String(values.export),
              statement_text: text,
              statement_hash: hash,
              title_hash: sha256(title),
              proof_hash: sha256(stableJson(normalizedAst([]), 0)),
              proof_present: false,
              proof_text: '',
              refutation: false,
              // A definition carries its own `.draft`; a theorem-like inherits it from its linked proof.
              draft: kind === 'definition' && draft,
              abandon,
              construction_dependencies: constructionDependencies,
              dependencies: constructionDependencies
            };
            if (!SEMANTIC_ID_PATTERN.test(id)) diagnostics.push(diagnostic('error', 'INVALID_SEMANTIC_ID', `Semantic ID ${id} must use a reserved prefix followed by letters, digits, dot, underscore, colon, or hyphen`, file.relative, line, id));
            if (semanticKinds.length === 0) diagnostics.push(diagnostic('error', 'SEMANTIC_KIND_MISSING', `${id} requires one semantic kind class`, file.relative, line, id));
            if (semanticKinds.length > 1) diagnostics.push(diagnostic('error', 'SEMANTIC_KIND_MULTIPLE', `${id} has multiple semantic kind classes`, file.relative, line, id));
            const prefix = id.match(SEMANTIC_PREFIX_PATTERN)?.[1];
            if (prefix && entry.kind && KIND_BY_PREFIX[prefix] !== entry.kind) diagnostics.push(diagnostic('error', 'ID_KIND_MISMATCH', `${id} requires class .${KIND_BY_PREFIX[prefix]}, not .${entry.kind}`, file.relative, line, id));
            if (id.startsWith(config.goals['id-prefix']) && (!classes.includes('goal') || entry.kind !== 'theorem')) diagnostics.push(diagnostic('error', 'MAIN_GOAL_SHAPE', `${id} requires both .theorem and .goal classes`, file.relative, line, id));
            if (!title.trim()) diagnostics.push(diagnostic('error', 'RESULT_NAME_MISSING', `${id} requires a nonempty name attribute`, file.relative, line, id));
            if (!date) diagnostics.push(diagnostic('error', 'RESULT_DATE_MISSING', `${id} requires an ISO introduction date attribute in YYYY-MM-DD form`, file.relative, line, id));
            else if (!validIntroductionDate(date)) diagnostics.push(diagnostic('error', 'RESULT_DATE_INVALID', `${id} introduction date must be a real date in YYYY-MM-DD form`, file.relative, line, id));
            if (result.export !== null && result.export !== id) diagnostics.push(diagnostic('error', 'EXPORT_ID_MISMATCH', `${id} must set export="${id}" when it is imported by another file`, file.relative, line, id));
            if (!present) diagnostics.push(diagnostic('error', 'STATEMENT_MISSING', `${id} requires a nonempty statement body`, file.relative, line, id));
            // The refutation flag belongs on a linked .proof block, never on a result body; a
            // definition cannot be refuted at all (challenge a theorem-like claim about it instead).
            if (disproof) diagnostics.push(diagnostic('error', 'RESULT_DISPROOF_FORBIDDEN', `${id} must not carry .disproof on its result body; put .disproof on its linked .proof block`, file.relative, line, id));
            const legacyHeaders = blocks.filter((block) => block.t === 'Header' && ['statement', 'uses', 'proof'].includes(inlineText(asArray(block.c)[2]).toLowerCase()));
            if (legacyHeaders.length) diagnostics.push(diagnostic('error', 'LEGACY_RESULT_SECTIONS', `${id} must use a result body and a separate linked .proof block, not Statement/Uses/Proof headings`, file.relative, line, id));
            return { result, diagnostics };
          })();
          fileResults.push(parsedResult.result);
          results.push(parsedResult.result);
          diagnostics.push(...parsedResult.diagnostics);
        }
        files.push({ path: file.relative, imports, results: fileResults.map((result) => result.id), proofs: fileProofs.map((proof) => proof.target) });
      } catch (error) {
        diagnostics.push(diagnostic('error', 'PARSE_ERROR', errorMessage(error), file.relative));
      }
    }
    return { files, results, proofs, diagnostics };
  })();

  // Index results and proofs by id/export/target, reporting duplicate declarations.
  const indexed = (() => {
    const diagnostics: Diagnostic[] = [];
    const byId = new Map<string, SemanticResult>();
    const idCounts = new Map<string, number>();
    const byExport = new Map<string, SemanticResult>();
    for (const result of parsed.results) {
      idCounts.set(result.id, (idCounts.get(result.id) ?? 0) + 1);
      if (byId.has(result.id)) diagnostics.push(diagnostic('error', 'DUPLICATE_ID', `${result.id} is also defined in ${byId.get(result.id)?.file}`, result.file, result.line, result.id));
      else byId.set(result.id, result);
      if (result.export) {
        if (byExport.has(result.export)) diagnostics.push(diagnostic('error', 'DUPLICATE_EXPORT', `Export name ${result.export} is also used by @${byExport.get(result.export)?.id}`, result.file, result.line, result.id));
        else byExport.set(result.export, result);
      }
    }
    const proofsByTarget = new Map<string, ParsedProof[]>();
    for (const proof of parsed.proofs) {
      if (!proof.target) continue;
      if (!proofsByTarget.has(proof.target)) proofsByTarget.set(proof.target, []);
      proofsByTarget.get(proof.target)?.push(proof);
    }
    return { byId, idCounts, byExport, proofsByTarget, diagnostics };
  })();

  // Link proofs to their results and imports to their files. Both sub-steps run here (in
  // this order) because `analyzed` reads the proof overlay (result.dependencies/proof_file)
  // and the import scope (availableByFile/importAdjacency) that they produce.
  const linked = (() => {
    const { byId, proofsByTarget } = indexed;
    const config = project.config;

    // Overlay each single, resolvable linked proof onto its canonical result.
    const overlay = (() => {
      const diagnostics: Diagnostic[] = [];
      for (const [target, allProofs] of proofsByTarget) {
        const result = byId.get(target);
        if (!result) {
          for (const proof of allProofs) diagnostics.push(diagnostic('error', 'PROOF_TARGET_UNKNOWN', `Proof target @${target} does not exist`, proof.file, proof.line, target));
          continue;
        }
        // An abandoned proof is detached memory: it never links to its result and never
        // competes with an active proof, so a target may keep one active proof beside any
        // number of abandoned attempts.
        const proofs = allProofs.filter((proof) => !proof.abandon);
        if (proofs.length === 0) continue;
        if (proofs.length > 1) {
          for (const proof of proofs) diagnostics.push(diagnostic('error', 'PROOF_MULTIPLE', `@${target} has more than one associated proof`, proof.file, proof.line, target));
          continue;
        }
        const proof = proofs[0];
        if (!proof) continue;
        // A protected main goal keeps its statement in user notes; its linked proof may live in any project file.
        if (proof.file !== result.file && !target.startsWith(config.goals['id-prefix'])) diagnostics.push(diagnostic('error', 'PROOF_DIFFERENT_FILE', `Proof of @${target} must be in the result's source file`, proof.file, proof.line, target));
        if (result.kind === 'definition' && proof.refutation) diagnostics.push(diagnostic('error', 'DEFINITION_DISPROOF_FORBIDDEN', `@${target} is a definition and cannot carry a .disproof proof; refute a theorem-like claim about it instead`, proof.file, proof.line, target));
        result.proof_hash = proof.proof_hash;
        result.proof_present = proof.proof_present;
        result.proof_text = proof.proof_text;
        if (result.kind !== 'definition') {
          result.refutation = proof.refutation;
          result.draft = proof.draft;
        }
        result.dependencies = uniqueSorted([...result.construction_dependencies, ...proof.dependencies]);
        result.proof_file = proof.file;
        result.proof_line = proof.line;
      }
      return { diagnostics };
    })();

    // Resolve each file's imports into the set of ids available in its scope.
    const imports = (() => {
      const diagnostics: Diagnostic[] = [];
      const fileMap = new Map<string, SourceFileRecord>(parsed.files.map((file) => [file.path, file]));
      const importAdjacency = new Map<string, string[]>(parsed.files.map((file) => [file.path, []]));
      const availableByFile = new Map<string, Set<string>>();
      for (const file of parsed.files) {
        const available = new Set(file.results);
        availableByFile.set(file.path, available);
        for (const declaration of file.imports) {
          if (declaration.use.includes('*') && !config.semantic['wildcard-imports']) diagnostics.push(diagnostic('error', 'WILDCARD_IMPORT', 'Wildcard imports are forbidden', file.path));
          const importedPath = resolveImport(file.path, declaration.from);
          if (!importedPath || !fileMap.has(importedPath)) {
            diagnostics.push(diagnostic('error', 'IMPORT_FILE_MISSING', `Imported file does not exist: ${declaration.from}`, file.path));
            continue;
          }
          importAdjacency.get(file.path)?.push(importedPath);
          for (const id of declaration.use) {
            const target = byId.get(id);
            if (!target || target.file !== importedPath) diagnostics.push(diagnostic('error', 'IMPORT_ID_MISSING', `@${id} is not defined in ${importedPath}`, file.path));
            else if (!target.export) diagnostics.push(diagnostic('error', 'IMPORT_NOT_EXPORTED', `@${id} is not exported by ${importedPath}`, file.path));
            else available.add(id);
          }
        }
      }
      return { availableByFile, importAdjacency, diagnostics };
    })();

    return {
      availableByFile: imports.availableByFile,
      importAdjacency: imports.importAdjacency,
      diagnostics: [...overlay.diagnostics, ...imports.diagnostics]
    };
  })();

  // Analyze dependencies over the linked results: per-reference checks, then import and
  // semantic cycles, then final status. Runs on the parse-ordered results so the duplicate-id
  // skip and the last-wins dependency adjacency keep their original object identities.
  const analyzed = (() => {
    const { byId, idCounts } = indexed;
    const { availableByFile, importAdjacency } = linked;

    // Per-reference existence/scope checks, recorded on each canonical result.
    const references = (() => {
      const diagnostics: Diagnostic[] = [];
      for (const result of parsed.results) {
        if (byId.get(result.id) !== result) continue;
        // An abandoned fact is kept for memory only: never checked, never usable as a premise, so
        // what it cites is nobody's problem. It keeps its ID and its shape checks (an ID hidden in
        // an abandoned block would still collide with a live one) but resolves no references.
        if (result.abandon) { result.reference_checks = []; continue; }
        const declared = availableByFile.get(result.file) ?? new Set<string>();
        // Proof-contributed dependencies resolve in the proof's file scope; this only differs
        // from the declaration scope for a main-goal proof overlay living in another file.
        const proofScope = result.proof_file && result.proof_file !== result.file
          ? availableByFile.get(result.proof_file) ?? new Set<string>()
          : declared;
        const constructionDependencies = new Set(result.construction_dependencies);
        result.reference_checks = [];
        for (const dependency of result.dependencies) {
          const available = constructionDependencies.has(dependency) ? declared : proofScope;
          const count = idCounts.get(dependency) ?? 0;
          const existsCheck = count === 1 ? 'pass' : 'fail';
          const scopeCheck = count === 1 && available.has(dependency) ? 'pass' : 'fail';
          result.reference_checks.push({ dependency, existence: existsCheck, scope: scopeCheck });
          if (count === 0) diagnostics.push(diagnostic('error', 'DEPENDENCY_UNKNOWN', `@${dependency} cited by @${result.id} does not exist`, result.file, result.proof_line ?? result.line, result.id));
          else if (count > 1) diagnostics.push(diagnostic('error', 'DEPENDENCY_AMBIGUOUS', `@${dependency} cited by @${result.id} is ambiguous`, result.file, result.proof_line ?? result.line, result.id));
          else if (!available.has(dependency)) diagnostics.push(diagnostic('error', 'DEPENDENCY_UNAVAILABLE', `@${dependency} cited by @${result.id} is not local or explicitly imported`, result.file, result.proof_line ?? result.line, result.id));
        }
      }
      return { diagnostics };
    })();

    // Import cycles and semantic dependency cycles; cycleEdges feeds the status pass.
    const cycles = (() => {
      const diagnostics: Diagnostic[] = [];
      const importCycles = findCycles(importAdjacency);
      for (const cycle of importCycles) diagnostics.push(diagnostic('error', 'IMPORT_CYCLE', `Import cycle: ${cycle.join(' -> ')}`, cycle[0]));
      // Abandoned facts contribute no edges, so a dead attempt can never put a live fact in a cycle.
      const dependencyAdjacency = new Map<string, string[]>(parsed.results.map((result) => [
        result.id, result.abandon ? [] : result.dependencies.filter((id) => byId.has(id))
      ]));
      const dependencyCycles = findCycles(dependencyAdjacency);
      const cycleEdges = new Set();
      for (const cycle of dependencyCycles) {
        for (let index = 0; index < cycle.length - 1; index += 1) cycleEdges.add(`${cycle[index]}\0${cycle[index + 1]}`);
        const result = byId.get(cycle[0]);
        diagnostics.push(diagnostic('error', 'DEPENDENCY_CYCLE', `Semantic dependency cycle: ${cycle.map((id) => `@${id}`).join(' -> ')}`, result?.file, result?.line, result?.id));
      }
      return { dependencyCycles, cycleEdges, diagnostics };
    })();

    // Cycle flags, then the pre-verification status, over every result (duplicates included).
    // `verifyFacts` recomputes the status once local verdicts exist; this keeps a manifest
    // produced without any verifier truthful on its own.
    const statuses = (() => {
      const errors = [
        ...parsed.diagnostics, ...indexed.diagnostics, ...linked.diagnostics,
        ...references.diagnostics, ...cycles.diagnostics
      ].filter((item) => item.severity === 'error');
      for (const result of parsed.results) {
        for (const check of result.reference_checks ?? []) {
          check.cycle = cycles.cycleEdges.has(`${result.id}\0${check.dependency}`) ? 'fail' : 'pass';
        }
        result.intent = factIntent(result);
        result.mechanical = isBroken(result, errors) ? 'broken' : 'ok';
        result.status = preVerificationStatus(result, result.mechanical === 'broken');
      }
      return { diagnostics: [] as Diagnostic[] };
    })();

    return {
      dependencyCycles: cycles.dependencyCycles,
      diagnostics: [...references.diagnostics, ...cycles.diagnostics, ...statuses.diagnostics]
    };
  })();

  // Every diagnostic discovered before statement locking, concatenated in execution order
  // so the final stable sort resolves ties exactly as the original single-array code did.
  const resolvedDiagnostics = [
    ...parsed.diagnostics, ...indexed.diagnostics, ...linked.diagnostics, ...analyzed.diagnostics
  ];

  // A user-owned main goal's statement and title are locked against agent edits. The
  // baseline is established as soon as the goal's own declaration is clean — unrelated
  // errors elsewhere in the project must not delay protection — and any later divergence
  // from a locked baseline is a hard error. Reads the complete pre-lock error set so the
  // per-goal clean check sees every diagnostic.
  const locked = await (async () => {
    const locksFile = auxLayout(project.root).statementLocks;
    const locks = await readJson<Record<string, UnknownRecord>>(locksFile, {});
    const protectStatements = options.protectStatements ?? !options.files;
    const diagnostics: Diagnostic[] = [];
    let locksChanged = false;
    if (protectStatements) {
      for (const result of parsed.results.filter((item) => item.origin === 'user')) {
        const prior = locks[result.id];
        if (!prior) {
          const goalErrors = resolvedDiagnostics.some((item) => item.severity === 'error'
            && (item.id ? item.id === result.id : item.file === result.file));
          if (goalErrors) continue;
          locks[result.id] = { statement_hash: result.statement_hash, title_hash: result.title_hash, file: result.file };
          locksChanged = true;
        } else {
          if (prior.statement_hash !== result.statement_hash) diagnostics.push(diagnostic('error', 'MAIN_STATEMENT_MUTATED', `${result.id} statement differs from its user-owned baseline`, result.file, result.line, result.id));
          if (prior.title_hash !== result.title_hash) diagnostics.push(diagnostic('error', 'MAIN_TITLE_MUTATED', `${result.id} title differs from its user-owned baseline`, result.file, result.line, result.id));
        }
      }
    }
    return { locksFile, locks, locksChanged, diagnostics };
  })();

  // Assemble the compilation from deterministically ordered copies of the enriched data.
  const output = await (async () => {
    const { byId } = indexed;
    const results = [...parsed.results].sort((a, b) => a.id.localeCompare(b.id));
    const files = [...parsed.files].sort((a, b) => a.path.localeCompare(b.path));
    const diagnostics = [...resolvedDiagnostics, ...locked.diagnostics]
      .sort((a, b) => `${a.file ?? ''}:${a.line ?? 0}:${a.code}`.localeCompare(`${b.file ?? ''}:${b.line ?? 0}:${b.code}`));
    // The dependency graph is a self-contained derived structure; its hash also identifies
    // the manifest snapshot, so build it first and reuse the id.
    const graph = (() => {
      // An abandoned fact is kept for memory only: it resolves no references and contributes no
      // edges, so a dead attempt can neither create a dangling node nor be walked as a dependency.
      const live = results.filter((result) => !result.abandon);
      const missingIds = uniqueSorted(live.flatMap((result) => result.dependencies).filter((id) => !byId.has(id)));
      const value: DependencyGraph = {
        schema_version: SCHEMA_VERSION,
        nodes: [
          ...results.map(({ id, title, kind, intent, mechanical, status, file, line, origin }) => ({
            id, title, kind, intent, mechanical, status, file, line,
            origin: origin === 'user' ? 'main-goal' as const : 'fact' as const,
            ownership: origin
          })),
          ...missingIds.map((id) => ({ id, title: '', kind: 'unknown' as const, status: 'missing' as const, origin: 'unresolved' as const }))
        ],
        edges: live.flatMap((result) => result.dependencies.map((dependency) => {
          const check = result.reference_checks?.find((item) => item.dependency === dependency);
          return {
            from: result.id,
            to: dependency,
            checks: check
              ? { existence: check.existence, scope: check.scope, cycle: check.cycle }
              : { existence: 'fail' as const, scope: 'fail' as const, cycle: 'pass' as const }
          };
        })).sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`)),
        cycles: analyzed.dependencyCycles
      };
      value.snapshot_id = sha256(stableJson(value, 0));
      return value;
    })();
    const manifest: Manifest = {
      schema_version: SCHEMA_VERSION, snapshot_id: graph.snapshot_id, files, results,
      proofs: parsed.proofs.map(({ blocks, ...proof }) => proof)
    };
    const goals = results.filter((result) => result.origin === 'user');
    const goalIds = new Set(goals.map((goal) => goal.id));
    const notes = files.map((file) => ({
      path: file.path,
      goals: file.results.filter((id) => goalIds.has(id)).sort()
    }));
    const summary = {
      files: files.length,
      results: results.length,
      goals: goals.map(({ id, status, file, line }) => ({ id, status, file, line })),
      errors: diagnostics.filter((item) => item.severity === 'error').length,
      warnings: diagnostics.filter((item) => item.severity === 'warning').length
    };
    const ok = summary.errors === 0;
    const complete = diagnostics.every((item) => item.code !== 'PARSE_ERROR');
    // Snapshot publishing is owned by the inspection layer; the compiler persists only
    // diagnostics and newly established statement locks when invoked in write mode.
    if (options.write !== false) {
      await atomicJson(auxLayout(project.root).diagnostics, diagnostics);
      if (complete && locked.locksChanged) await atomicJson(locked.locksFile, locked.locks);
    }
    return { manifest, graph, diagnostics, summary, goals, notes, ok, complete };
  })();

  return {
    root: project.root, config: project.config,
    manifest: output.manifest, graph: output.graph, diagnostics: output.diagnostics,
    summary: output.summary, goals: output.goals, notes: output.notes,
    ok: output.ok, complete: output.complete
  };
}

export function theoremBundle(compilation: Compilation, requested: string): { target: SemanticResult; dependencies: SemanticResult[]; truncated: boolean; diagnostics: Diagnostic[] } {
  const id = cleanId(requested);
  const byId = new Map(compilation.manifest.results.map((result) => [result.id, result]));
  const target = byId.get(id);
  if (!target) throw new Error(`Unknown theorem: @${id}`);
  const closure: SemanticResult[] = [];
  const seen = new Set<string>();
  const limit = 100;
  function visit(current: SemanticResult): void {
    for (const dependency of current.dependencies) {
      if (closure.length >= limit) return;
      if (seen.has(dependency)) continue;
      seen.add(dependency);
      const result = byId.get(dependency);
      if (result) { closure.push(result); visit(result); }
    }
  }
  visit(target);
  return { target, dependencies: closure, truncated: closure.length >= limit, diagnostics: compilation.diagnostics.filter((item) => item.id === id) };
}
