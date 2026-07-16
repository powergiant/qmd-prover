import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { AUX, atomicJson, atomicWrite, cleanId, exists, readJson, relativePosix, scaffoldAuxGitignore, sha256, stableJson } from '../infrastructure/files.js';
import { loadConfig, pandocCommand } from '../infrastructure/config.js';
import { inlineText, normalizedAst, readAst, references, walk } from './pandoc.js';
import { locateDiv, locateProof } from './source.js';
import {
  KIND_BY_PREFIX, RESULT_KINDS, SCHEMA_VERSION, SEMANTIC_ID_PATTERN, SEMANTIC_PREFIX_PATTERN, isControlMarker
} from '../shared/core.js';
import type { ControlMarker, ResultKind } from '../shared/core.js';
import { asArray, asRecord, asString, errorMessage, isRecord, uniqueSorted } from '../shared/core.js';
import type { PandocDocument, PandocNode } from './pandoc.js';
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
  proofs?: number;
  errors: number;
  warnings: number;
  statuses?: Record<string, number>;
  kinds?: Record<string, number>;
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


interface PandocAttributes { id: string; classes: string[]; values: Record<string, unknown> }
interface SemanticEntry { type: 'proof' | 'result'; attribute: PandocAttributes; blocks: PandocNode[]; kind?: ResultKind }
interface MarkerEntry { marker: ControlMarker; index: number }
interface ParsedProof extends ProofRecord {
  marker: ControlMarker | null;
  marker_index: number | null;
  markers: MarkerEntry[];
  blocks: PandocNode[];
}

function attrs(value: unknown = ['', [], []]): PandocAttributes {
  const tuple = asArray(value);
  const pairs = asArray(tuple[2]).filter((item): item is [unknown, unknown] => Array.isArray(item) && item.length >= 2);
  return {
    id: asString(tuple[0]),
    classes: asArray(tuple[1]).map(String),
    values: Object.fromEntries(pairs.map(([key, item]) => [String(key), item]))
  };
}

function metaValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const record = asRecord(value);
  if (record.t === 'MetaMap') return Object.fromEntries(Object.entries(asRecord(record.c)).map(([key, item]) => [key, metaValue(item)]));
  if (record.t === 'MetaList') return asArray(record.c).map(metaValue);
  if (record.t === 'MetaString' || record.t === 'MetaBool') return record.c;
  if (record.t === 'MetaInlines') return inlineText(record.c);
  if (record.t === 'MetaBlocks') return inlineText(record.c);
  return record.c ?? value;
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
  walk(ast.blocks ?? [], (node) => {
    if (node.t !== 'Div') return;
    const content = asArray(node.c);
    const attribute = attrs(content[0]);
    const blocks = asArray(content[1]).filter((block): block is PandocNode => isRecord(block) && typeof block.t === 'string');
    const kind = RESULT_KINDS.find((candidate) => attribute.classes.includes(candidate));
    if (attribute.classes.includes('proof')) entries.push({ type: 'proof', attribute, blocks });
    else if (attribute.id && (SEMANTIC_PREFIX_PATTERN.test(attribute.id) || kind)) entries.push({ type: 'result', attribute, blocks, kind });
  });
  return entries;
}

function markerParagraph(block: PandocNode | undefined): ControlMarker | null {
  if (!block || !['Para', 'Plain'].includes(block.t)) return null;
  const marker = inlineText(block.c ?? []);
  return isControlMarker(marker) ? marker : null;
}

function proofContent(blocks: PandocNode[]): { marker: ControlMarker | null; marker_index: number | null; markers: MarkerEntry[]; blocks: PandocNode[] } {
  const index = blocks.findIndex((block) => block.t !== 'Null');
  const markers = blocks.map((block, blockIndex) => ({ marker: markerParagraph(block), index: blockIndex }))
    .filter((entry): entry is MarkerEntry => entry.marker !== null);
  const marker = index >= 0 ? markerParagraph(blocks[index]) : null;
  return {
    marker,
    marker_index: marker ? index : null,
    markers,
    blocks: marker ? blocks.filter((_, blockIndex) => blockIndex !== index) : blocks
  };
}

function definitionContent(blocks: PandocNode[]): { marker: ControlMarker | null; marker_index: number | null; markers: MarkerEntry[]; blocks: PandocNode[] } {
  const nonempty = blocks.map((block, index) => ({ block, index })).filter(({ block }) => block.t !== 'Null');
  const last = nonempty.at(-1)?.index ?? -1;
  const markers = blocks.map((block, index) => ({ marker: markerParagraph(block), index }))
    .filter((entry): entry is MarkerEntry => entry.marker !== null);
  const marker = last >= 0 ? markerParagraph(blocks[last]) : null;
  return {
    marker,
    marker_index: marker ? last : null,
    markers,
    blocks: marker ? blocks.filter((_, index) => index !== last) : blocks
  };
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

/** Marker- and proof-derived status before any verification overlay. */
export function factStatus(result: SemanticResult, marker = result.marker): string {
  if (marker === 'OPEN') return 'open';
  if (marker === 'REJECTED') return 'rejected';
  if (marker === 'DISPROVED') return 'disproof-candidate';
  if (marker === 'REVOKED') return 'revoked';
  return result.kind === 'definition' || result.proof_present ? 'candidate' : 'open';
}


async function initializeAux(root: string): Promise<void> {
  const directories = ['verification', 'reports', 'graphs', 'generated', 'cache'];
  await Promise.all(directories.map((directory) => mkdir(path.join(root, AUX, directory), { recursive: true })));
  const configFile = path.join(root, AUX, 'config.yml');
  if (!await exists(configFile)) await atomicWrite(configFile, [
    `project:`,
    `  name: ${path.basename(root)}`,
    `  root: ..`,
    `  discover-qmd-recursively: true`,
    `  exclude: [.qmd-prover]`,
    ``,
    `goals:`,
    `  id-prefix: thm-main-`,
    `  protect-statements: true`,
    ``,
    `semantic:`,
    `  wildcard-imports: false`,
    ``,
    `tools:`,
    `  # Optional explicit paths, used when the tool is not on PATH.`,
    `  pandoc: ""`,
    `  quarto: ""`,
    ``,
    `verification:`,
    `  # backend selects the independent verifier: none | claude | codex | command`,
    `  backend: none`,
    `  # For claude/codex: path to the CLI executable (defaults to the backend name on PATH).`,
    `  executable: ""`,
    `  model: configurable`,
    `  # effort: reasoning effort forwarded to the backend: low | medium | high | xhigh | max`,
    `  effort: high`,
    `  fresh-context: true`,
    `  # citations: how strictly an uncited non-standard term is flagged: lenient | standard | strict`,
    `  citations: standard`,
    `  # rigor: how completely a valid step must be spelled out (strict also makes gaps block): lenient | standard | strict`,
    `  rigor: standard`,
    `  # tools: capabilities the verifier is TOLD (in the prompt) it may use; any of [file-read, web-search, code]`,
    `  tools: []`,
    ``,
    `render:`,
    `  graph-engine: builtin`,
    `  output-dir: .qmd-prover/generated`,
    ``
  ].join('\n'));
  await scaffoldAuxGitignore(root);
}

export async function compileProject(root = process.cwd(), options: CompilerOptions = {}): Promise<Compilation> {
  root = path.resolve(root);
  if (options.write !== false) await initializeAux(root);
  const config = await loadConfig(root);
  const pandoc = pandocCommand(config, options.pandoc);
  const exclusions = await discoveryExclusions(root, config);
  let discovered = options.files
    ? options.files.map((absolute) => ({ absolute: path.resolve(absolute), relative: relativePosix(root, path.resolve(absolute)) }))
    : await discover(root, root, exclusions);
  const excludedFiles = new Set((options.excludeFiles ?? []).map((file) => path.resolve(file)));
  if (excludedFiles.size) discovered = discovered.filter((file) => !excludedFiles.has(file.absolute));
  const diagnostics: Diagnostic[] = [];
  const files: SourceFileRecord[] = [];
  const allResults: SemanticResult[] = [];
  const allProofs: ParsedProof[] = [];

  for (const file of discovered) {
    try {
      const [ast, source] = await Promise.all([readAst(file.absolute, { pandoc }), readFile(file.absolute, 'utf8')]);
      const entries = semanticDivs(ast);
      const imports = importsFromMeta(ast, file.relative, diagnostics);
      const results: SemanticResult[] = [];
      const proofs: ParsedProof[] = [];
      for (const entry of entries) {
        const { id, classes, values } = entry.attribute;
        if (entry.type === 'proof') {
          const target = cleanId(String(values.of ?? ''));
          const located = target ? locateProof(source, target) : null;
          const line = located?.startLine;
          const content = proofContent(entry.blocks);
          const proof: ParsedProof = {
            target, file: file.relative, line,
            marker: content.marker,
            proof_hash: sha256(stableJson(normalizedAst(content.blocks), 0)),
            proof_present: inlineText(content.blocks).length > 0 || content.blocks.some((block) => block.t !== 'Null'),
            proof_text: inlineText(content.blocks),
            dependencies: references(content.blocks),
            blocks: content.blocks,
            markers: content.markers,
            marker_index: content.marker_index
          };
          proofs.push(proof);
          allProofs.push(proof);
          if (!target) diagnostics.push(diagnostic('error', 'PROOF_TARGET_MISSING', 'A .proof block requires an of attribute', file.relative, line));
          if (!proof.proof_present) diagnostics.push(diagnostic('error', 'PROOF_EMPTY', `Proof of @${target || '?'} is empty`, file.relative, line, target));
          if (content.markers.some((marker) => marker.index !== content.marker_index)) diagnostics.push(diagnostic('error', 'PROOF_MARKER_POSITION', `A reserved proof marker must be the first nonempty proof paragraph`, file.relative, line, target));
          continue;
        }

        const located = locateDiv(source, id);
        const line = located?.startLine;
        const semanticKinds = classes.filter((item): item is ResultKind => RESULT_KINDS.includes(item as ResultKind));
        const kind = entry.kind ?? 'unknown';
        const title = String(values.name ?? '');
        const date = String(values.date ?? '');
        const content = kind === 'definition'
          ? definitionContent(entry.blocks)
          : { marker: null, marker_index: null, markers: entry.blocks.map((block, index) => ({ marker: markerParagraph(block), index })).filter((item) => item.marker), blocks: entry.blocks };
        const statementText = inlineText(content.blocks);
        const statementHash = sha256(stableJson(normalizedAst(content.blocks), 0));
        const constructionDependencies = kind === 'definition' ? references(content.blocks) : [];
        const result: SemanticResult = {
          id, file: file.relative, line, kind, classes: [...classes].sort(), title, date,
          origin: id.startsWith(config.goals['id-prefix']) ? 'user' : 'agent',
          status: 'candidate',
          export: values.export == null ? null : String(values.export),
          statement_text: statementText,
          statement_hash: statementHash,
          title_hash: sha256(title),
          proof_hash: sha256(stableJson(normalizedAst([]), 0)),
          proof_present: false,
          proof_text: '',
          marker: kind === 'definition' ? content.marker : null,
          marker_valid: kind === 'definition'
            ? content.markers.length <= 1 && content.markers.every((marker) => marker.index === content.marker_index)
            : content.markers.length === 0,
          ...(kind === 'definition' ? { construction_text: statementText, construction_hash: statementHash } : {}),
          construction_dependencies: constructionDependencies,
          dependencies: constructionDependencies,
          uses: constructionDependencies
        };
        results.push(result);
        allResults.push(result);
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
        if (statementText.length === 0 && content.blocks.every((block) => block.t === 'Null')) diagnostics.push(diagnostic('error', 'STATEMENT_MISSING', `${id} requires a nonempty statement body`, file.relative, line, id));
        if (kind === 'definition') {
          if (content.markers.length > 1) diagnostics.push(diagnostic('error', 'DEFINITION_MARKER_MULTIPLE', `${id} has more than one reserved control marker`, file.relative, line, id));
          if (content.markers.some((marker) => marker.index !== content.marker_index)) diagnostics.push(diagnostic('error', 'DEFINITION_MARKER_POSITION', `${id} must put its reserved marker in the last nonempty paragraph of the definition block`, file.relative, line, id));
          if (content.marker === 'DISPROVED') diagnostics.push(diagnostic('error', 'DEFINITION_DISPROVED_FORBIDDEN', `${id} is a definition and cannot be marked DISPROVED; state a theorem-like well-definedness claim and refute that claim instead`, file.relative, line, id));
        } else if (content.markers.length > 0) diagnostics.push(diagnostic('error', 'RESULT_MARKER_LOCATION', `${id} must put its reserved marker in the first nonempty paragraph of its linked proof`, file.relative, line, id));
        const legacyHeaders = content.blocks.filter((block) => block.t === 'Header' && ['statement', 'uses', 'proof'].includes(inlineText(asArray(block.c)[2]).toLowerCase()));
        if (legacyHeaders.length) diagnostics.push(diagnostic('error', 'LEGACY_RESULT_SECTIONS', `${id} must use a result body and a separate linked .proof block, not Statement/Uses/Proof headings`, file.relative, line, id));
      }
      files.push({ path: file.relative, imports, results: results.map((result) => result.id), proofs: proofs.map((proof) => proof.target) });
    } catch (error) {
      diagnostics.push(diagnostic('error', 'PARSE_ERROR', errorMessage(error), file.relative));
    }
  }

  const byId = new Map<string, SemanticResult>();
  const idCounts = new Map<string, number>();
  const byExport = new Map<string, SemanticResult>();
  for (const result of allResults) {
    idCounts.set(result.id, (idCounts.get(result.id) ?? 0) + 1);
    if (byId.has(result.id)) diagnostics.push(diagnostic('error', 'DUPLICATE_ID', `${result.id} is also defined in ${byId.get(result.id)?.file}`, result.file, result.line, result.id));
    else byId.set(result.id, result);
    if (result.export) {
      if (byExport.has(result.export)) diagnostics.push(diagnostic('error', 'DUPLICATE_EXPORT', `Export name ${result.export} is also used by @${byExport.get(result.export)?.id}`, result.file, result.line, result.id));
      else byExport.set(result.export, result);
    }
  }

  const proofsByTarget = new Map<string, ParsedProof[]>();
  for (const proof of allProofs) {
    if (!proof.target) continue;
    if (!proofsByTarget.has(proof.target)) proofsByTarget.set(proof.target, []);
    proofsByTarget.get(proof.target)?.push(proof);
  }
  for (const [target, proofs] of proofsByTarget) {
    const result = byId.get(target);
    if (!result) {
      for (const proof of proofs) diagnostics.push(diagnostic('error', 'PROOF_TARGET_UNKNOWN', `Proof target @${target} does not exist`, proof.file, proof.line, target));
      continue;
    }
    if (proofs.length > 1) {
      for (const proof of proofs) diagnostics.push(diagnostic('error', 'PROOF_MULTIPLE', `@${target} has more than one associated proof`, proof.file, proof.line, target));
      continue;
    }
    const proof = proofs[0];
    if (!proof) continue;
    if (result) {
      // A protected main goal keeps its statement in user notes; its linked proof may live in any project file.
      if (proof.file !== result.file && !target.startsWith(config.goals['id-prefix'])) diagnostics.push(diagnostic('error', 'PROOF_DIFFERENT_FILE', `Proof of @${target} must be in the result's source file`, proof.file, proof.line, target));
      if (result.kind === 'definition' && proof.markers.length > 0) diagnostics.push(diagnostic('error', 'DEFINITION_PROOF_MARKER', `@${target} must put its reserved marker at the end of the definition block, not in its linked proof`, proof.file, proof.line, target));
      result.marker_valid = result.marker_valid
        && proof.markers.every((marker) => marker.index === proof.marker_index)
        && (result.kind !== 'definition' || proof.markers.length === 0);
      result.proof_hash = proof.proof_hash;
      result.proof_present = proof.proof_present;
      result.proof_text = proof.proof_text;
      if (result.kind !== 'definition') result.marker = proof.marker;
      result.dependencies = uniqueSorted([...result.construction_dependencies, ...proof.dependencies]);
      result.uses = result.dependencies;
      result.proof_file = proof.file;
      result.proof_line = proof.line;
    }
  }

  const fileMap = new Map<string, SourceFileRecord>(files.map((file) => [file.path, file]));
  const importAdjacency = new Map<string, string[]>(files.map((file) => [file.path, []]));
  const availableByFile = new Map<string, Set<string>>();
  for (const file of files) {
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
  for (const result of allResults) {
    if (byId.get(result.id) !== result) continue;
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
  const importCycles = findCycles(importAdjacency);
  for (const cycle of importCycles) diagnostics.push(diagnostic('error', 'IMPORT_CYCLE', `Import cycle: ${cycle.join(' -> ')}`, cycle[0]));
  const dependencyAdjacency = new Map<string, string[]>(allResults.map((result) => [result.id, result.dependencies.filter((id) => byId.has(id))]));
  const dependencyCycles = findCycles(dependencyAdjacency);
  const cycleEdges = new Set();
  for (const cycle of dependencyCycles) {
    for (let index = 0; index < cycle.length - 1; index += 1) cycleEdges.add(`${cycle[index]}\0${cycle[index + 1]}`);
    const result = byId.get(cycle[0]);
    diagnostics.push(diagnostic('error', 'DEPENDENCY_CYCLE', `Semantic dependency cycle: ${cycle.map((id) => `@${id}`).join(' -> ')}`, result?.file, result?.line, result?.id));
  }

  for (const result of allResults) {
    result.status = factStatus(result);
    if (result.marker === 'VERIFIED' || result.marker === 'REVOKED') diagnostics.push(diagnostic(
      'error', 'PROTECTED_MARKER_FORBIDDEN',
      `${result.id} must not carry the reserved ${result.marker} marker; verification state is recorded by inspection, never in QMD`,
      result.file, result.proof_line ?? result.line, result.id
    ));
    for (const check of result.reference_checks ?? []) {
      check.cycle = cycleEdges.has(`${result.id}\0${check.dependency}`) ? 'fail' : 'pass';
    }
  }

  // A user-owned main goal's statement and title are locked against agent edits. The
  // baseline is established as soon as the goal's own declaration is clean — unrelated
  // errors elsewhere in the project must not delay protection — and any later divergence
  // from a locked baseline is a hard error. Runs after every diagnostic is known so the
  // per-goal clean check sees the complete error set.
  const locksFile = path.join(root, AUX, 'statement-locks.json');
  const locks = await readJson<Record<string, UnknownRecord>>(locksFile, {});
  const protectStatements = options.protectStatements ?? !options.files;
  let locksChanged = false;
  if (protectStatements) {
    for (const result of allResults.filter((item) => item.origin === 'user')) {
      const prior = locks[result.id];
      if (!prior) {
        const goalErrors = diagnostics.some((item) => item.severity === 'error'
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

  allResults.sort((a, b) => a.id.localeCompare(b.id));
  files.sort((a, b) => a.path.localeCompare(b.path));
  diagnostics.sort((a, b) => `${a.file ?? ''}:${a.line ?? 0}:${a.code}`.localeCompare(`${b.file ?? ''}:${b.line ?? 0}:${b.code}`));
  const manifest: Manifest = { schema_version: SCHEMA_VERSION, files, results: allResults, proofs: allProofs.map(({ blocks, markers, marker_index, ...proof }) => proof) };
  const missingIds = uniqueSorted(allResults.flatMap((result) => result.dependencies).filter((id) => !byId.has(id)));
  const graph: DependencyGraph = {
    schema_version: SCHEMA_VERSION,
    nodes: [
      ...allResults.map(({ id, title, kind, status, file, line, origin, statement_hash, proof_hash }) => ({
        id, title, kind, status, file, line,
        origin: origin === 'user' ? 'main-goal' as const : 'fact' as const,
        ownership: origin,
        identity: { statement_hash, proof_hash }
      })),
      ...missingIds.map((id) => ({ id, title: '', kind: 'unknown' as const, status: 'missing', origin: 'unresolved' as const }))
    ],
    edges: allResults.flatMap((result) => result.dependencies.map((dependency) => {
      const check = result.reference_checks?.find((item) => item.dependency === dependency);
      return {
        from: result.id,
        to: dependency,
        checks: check
          ? { existence: check.existence, scope: check.scope, cycle: check.cycle }
          : { existence: 'fail' as const, scope: 'fail' as const, cycle: 'pass' as const }
      };
    })).sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`)),
    cycles: dependencyCycles
  };
  graph.snapshot_id = sha256(stableJson(graph, 0));
  manifest.snapshot_id = graph.snapshot_id;
  const goals = allResults.filter((result) => result.origin === 'user');
  const goalIds = new Set(goals.map((goal) => goal.id));
  const notes = files.map((file) => ({
    path: file.path,
    goals: file.results.filter((id) => goalIds.has(id)).sort()
  }));
  const summary = {
    files: files.length,
    results: allResults.length,
    goals: goals.map(({ id, status, file, line }) => ({ id, status, file, line })),
    errors: diagnostics.filter((item) => item.severity === 'error').length,
    warnings: diagnostics.filter((item) => item.severity === 'warning').length
  };
  const ok = summary.errors === 0;
  const complete = diagnostics.every((item) => item.code !== 'PARSE_ERROR');
  // Snapshot publishing is owned by the inspection layer; the compiler persists only
  // diagnostics and newly established statement locks when invoked in write mode.
  if (options.write !== false) {
    await atomicJson(path.join(root, AUX, 'diagnostics.json'), diagnostics);
    if (complete && locksChanged) await atomicJson(locksFile, locks);
  }
  return { root, config, manifest, graph, diagnostics, summary, goals, notes, ok, complete };
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
