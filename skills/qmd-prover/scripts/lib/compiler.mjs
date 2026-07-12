import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { AUX, atomicJson, atomicWrite, cleanId, exists, readJson, relativePosix, sha256, stableJson } from './files.mjs';
import { loadConfig } from './config.mjs';
import { inlineText, normalizedAst, readAst, references, walk } from './pandoc.mjs';
import { locateDiv, locateProof } from './source.mjs';

const semanticPrefixes = /^(def|lem|thm|prp|cor)-/;
const kindClasses = ['definition', 'lemma', 'theorem', 'proposition', 'corollary'];
const expectedKind = { def: 'definition', lem: 'lemma', thm: 'theorem', prp: 'proposition', cor: 'corollary' };

function diagnostic(severity, code, message, file, line, id) {
  return { severity, code, message, ...(file ? { file } : {}), ...(line ? { line } : {}), ...(id ? { id } : {}) };
}

async function discover(directory, root, output = []) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === AUX || entry.name === '.git' || entry.name === 'node_modules') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await discover(absolute, root, output);
    else if (entry.isFile() && entry.name.endsWith('.qmd')) output.push({ absolute, relative: relativePosix(root, absolute) });
  }
  return output;
}

function attrs(tuple = ['', [], []]) {
  return { id: tuple[0] ?? '', classes: tuple[1] ?? [], values: Object.fromEntries(tuple[2] ?? []) };
}

function metaValue(value) {
  if (!value || typeof value !== 'object') return value;
  if (value.t === 'MetaMap') return Object.fromEntries(Object.entries(value.c ?? {}).map(([key, item]) => [key, metaValue(item)]));
  if (value.t === 'MetaList') return (value.c ?? []).map(metaValue);
  if (value.t === 'MetaString' || value.t === 'MetaBool') return value.c;
  if (value.t === 'MetaInlines') return inlineText(value.c ?? []);
  if (value.t === 'MetaBlocks') return inlineText(value.c ?? []);
  return value.c ?? value;
}

function importsFromMeta(ast, file, diagnostics) {
  const metadata = metaValue(ast.meta?.['qmd-prover']);
  if (metadata == null) return [];
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    diagnostics.push(diagnostic('error', 'IMPORT_METADATA_INVALID', 'qmd-prover metadata must be a map', file));
    return [];
  }
  const declarations = metadata.imports ?? [];
  if (!Array.isArray(declarations)) {
    diagnostics.push(diagnostic('error', 'IMPORT_METADATA_INVALID', 'qmd-prover.imports must be a list', file));
    return [];
  }
  return declarations.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      diagnostics.push(diagnostic('error', 'IMPORT_METADATA_INVALID', 'Each qmd-prover import must be a map', file));
      return { from: '', use: [] };
    }
    const from = typeof entry.from === 'string' ? entry.from : '';
    const use = Array.isArray(entry.use) ? entry.use.map(String).map(cleanId) : [];
    if (!from) diagnostics.push(diagnostic('error', 'IMPORT_FROM_MISSING', 'Import metadata requires a from path', file));
    if (use.length === 0) diagnostics.push(diagnostic('error', 'IMPORT_USE_MISSING', 'Import metadata requires an explicit, nonempty use list', file));
    return { from, use };
  });
}

function semanticDivs(ast) {
  const entries = [];
  walk(ast.blocks ?? [], (node) => {
    if (node.t !== 'Div') return;
    const attribute = attrs(node.c?.[0]);
    const blocks = node.c?.[1] ?? [];
    const kind = kindClasses.find((candidate) => attribute.classes.includes(candidate));
    if (attribute.classes.includes('proof')) entries.push({ type: 'proof', attribute, blocks });
    else if (attribute.id && (semanticPrefixes.test(attribute.id) || kind)) entries.push({ type: 'result', attribute, blocks, kind });
  });
  return entries;
}

function resolveImport(importer, imported) {
  const candidate = path.posix.normalize(path.posix.join(path.posix.dirname(importer), imported));
  return candidate.startsWith('../') || path.posix.isAbsolute(candidate) ? null : candidate;
}

function findCycles(adjacency) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  function visit(node, chain) {
    if (visiting.has(node)) {
      const index = chain.indexOf(node);
      cycles.push(chain.slice(index));
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    for (const next of adjacency.get(node) ?? []) visit(next, [...chain, next]);
    visiting.delete(node);
    visited.add(node);
  }
  for (const node of [...adjacency.keys()].sort()) visit(node, [node]);
  return cycles;
}

function verificationStatus(result, verification) {
  const record = verification[result.id];
  if (record?.status === 'revoked' && record.statement_hash === result.statement_hash && record.proof_hash === result.proof_hash) return 'revoked';
  if (record?.status === 'verified' && record.statement_hash === result.statement_hash && record.proof_hash === result.proof_hash) return 'verified';
  if (record?.status === 'rejected' && record.statement_hash === result.statement_hash && record.canonical_proof_hash === result.proof_hash) return 'rejected';
  if (!result.proof_present) return 'open';
  return 'candidate';
}

async function initializeAux(root) {
  const directories = ['workspaces', 'proposals', 'verification', 'accepted', 'rejected', 'reports', 'graphs', 'generated', 'cache'];
  await Promise.all(directories.map((directory) => mkdir(path.join(root, AUX, directory), { recursive: true })));
  const indexFile = path.join(root, AUX, 'verification', 'index.json');
  if (!await exists(indexFile)) await atomicJson(indexFile, {});
  const configFile = path.join(root, AUX, 'config.yml');
  if (!await exists(configFile)) await atomicWrite(configFile, `project:\n  name: ${path.basename(root)}\n  root: ..\n  discover-qmd-recursively: true\n  exclude: [.qmd-prover]\n\ngoals:\n  id-prefix: thm-main-\n  protect-statements: true\n\nsemantic:\n  wildcard-imports: false\n\nverification:\n  backend: none\n  model: configurable\n  effort: high\n  fresh-context: true\n  require-zero-gaps: true\n\nrender:\n  graph-engine: builtin\n  output-dir: .qmd-prover/generated\n`);
}

export async function compileProject(root = process.cwd(), options = {}) {
  root = path.resolve(root);
  if (options.write !== false) await initializeAux(root);
  const config = await loadConfig(root);
  let discovered = options.files
    ? options.files.map((absolute) => ({ absolute: path.resolve(absolute), relative: relativePosix(root, path.resolve(absolute)) }))
    : await discover(root, root);
  const excludedFiles = new Set((options.excludeFiles ?? []).map((file) => path.resolve(file)));
  if (excludedFiles.size) discovered = discovered.filter((file) => !excludedFiles.has(file.absolute));
  const diagnostics = [];
  const files = [];
  const allResults = [];
  const allProofs = [];

  for (const file of discovered) {
    try {
      const [ast, source] = await Promise.all([readAst(file.absolute, options), readFile(file.absolute, 'utf8')]);
      const imports = importsFromMeta(ast, file.relative, diagnostics);
      const entries = semanticDivs(ast);
      const results = [];
      const proofs = [];
      for (const entry of entries) {
        const { id, classes, values } = entry.attribute;
        if (entry.type === 'proof') {
          const target = cleanId(String(values.of ?? ''));
          const located = target ? locateProof(source, target) : null;
          const line = located?.startLine;
          const proof = {
            target, file: file.relative, line,
            proof_hash: sha256(stableJson(normalizedAst(entry.blocks), 0)),
            proof_present: inlineText(entry.blocks).length > 0 || entry.blocks.some((block) => block.t !== 'Null'),
            dependencies: references(entry.blocks),
            blocks: entry.blocks
          };
          proofs.push(proof);
          allProofs.push(proof);
          if (!target) diagnostics.push(diagnostic('error', 'PROOF_TARGET_MISSING', 'A .proof block requires an of attribute', file.relative, line));
          if (!proof.proof_present) diagnostics.push(diagnostic('error', 'PROOF_EMPTY', `Proof of @${target || '?'} is empty`, file.relative, line, target));
          continue;
        }

        const located = locateDiv(source, id);
        const line = located?.startLine;
        const semanticKinds = classes.filter((item) => kindClasses.includes(item));
        const kind = entry.kind ?? 'unknown';
        const title = String(values.name ?? '');
        const result = {
          id, file: file.relative, line, kind, classes: [...classes].sort(), title,
          origin: id.startsWith(config.goals['id-prefix']) ? 'user' : 'agent',
          export: values.export ?? null,
          statement_hash: sha256(stableJson(normalizedAst(entry.blocks), 0)),
          title_hash: sha256(title),
          proof_hash: sha256(stableJson(normalizedAst([]), 0)),
          proof_present: false,
          dependencies: [],
          uses: []
        };
        results.push(result);
        allResults.push(result);
        if (!semanticPrefixes.test(id)) diagnostics.push(diagnostic('error', 'INVALID_ID_PREFIX', `Semantic ID ${id} uses an unreserved prefix`, file.relative, line, id));
        if (semanticKinds.length === 0) diagnostics.push(diagnostic('error', 'SEMANTIC_KIND_MISSING', `${id} requires one semantic kind class`, file.relative, line, id));
        if (semanticKinds.length > 1) diagnostics.push(diagnostic('error', 'SEMANTIC_KIND_MULTIPLE', `${id} has multiple semantic kind classes`, file.relative, line, id));
        const prefix = id.match(semanticPrefixes)?.[1];
        if (prefix && entry.kind && expectedKind[prefix] !== entry.kind) diagnostics.push(diagnostic('error', 'ID_KIND_MISMATCH', `${id} requires class .${expectedKind[prefix]}, not .${entry.kind}`, file.relative, line, id));
        if (id.startsWith(config.goals['id-prefix']) && (!classes.includes('goal') || entry.kind !== 'theorem')) diagnostics.push(diagnostic('error', 'MAIN_GOAL_SHAPE', `${id} requires both .theorem and .goal classes`, file.relative, line, id));
        if (!title.trim()) diagnostics.push(diagnostic('error', 'RESULT_NAME_MISSING', `${id} requires a nonempty name attribute`, file.relative, line, id));
        if (inlineText(entry.blocks).length === 0 && entry.blocks.every((block) => block.t === 'Null')) diagnostics.push(diagnostic('error', 'STATEMENT_MISSING', `${id} requires a nonempty statement body`, file.relative, line, id));
        const legacyHeaders = entry.blocks.filter((block) => block.t === 'Header' && ['statement', 'uses', 'proof'].includes(inlineText(block.c?.[2] ?? []).toLowerCase()));
        if (legacyHeaders.length) diagnostics.push(diagnostic('error', 'LEGACY_RESULT_SECTIONS', `${id} must use a result body and a separate linked .proof block, not Statement/Uses/Proof headings`, file.relative, line, id));
      }
      files.push({ path: file.relative, imports, results: results.map((result) => result.id), proofs: proofs.map((proof) => proof.target) });
    } catch (error) {
      diagnostics.push(diagnostic('error', 'PARSE_ERROR', error.message, file.relative));
    }
  }

  const byId = new Map();
  const byExport = new Map();
  for (const result of allResults) {
    if (byId.has(result.id)) diagnostics.push(diagnostic('error', 'DUPLICATE_ID', `${result.id} is also defined in ${byId.get(result.id).file}`, result.file, result.line, result.id));
    else byId.set(result.id, result);
    if (result.export) {
      if (byExport.has(result.export)) diagnostics.push(diagnostic('error', 'DUPLICATE_EXPORT', `Export name ${result.export} is also used by @${byExport.get(result.export).id}`, result.file, result.line, result.id));
      else byExport.set(result.export, result);
    }
  }

  const externalTargets = new Set((options.externalTargets ?? []).map(cleanId));
  const proofsByTarget = new Map();
  for (const proof of allProofs) {
    if (!proof.target) continue;
    if (!proofsByTarget.has(proof.target)) proofsByTarget.set(proof.target, []);
    proofsByTarget.get(proof.target).push(proof);
  }
  for (const [target, proofs] of proofsByTarget) {
    const result = byId.get(target);
    if (!result && !externalTargets.has(target)) {
      for (const proof of proofs) diagnostics.push(diagnostic('error', 'PROOF_TARGET_UNKNOWN', `Proof target @${target} does not exist`, proof.file, proof.line, target));
      continue;
    }
    if (proofs.length > 1) {
      for (const proof of proofs) diagnostics.push(diagnostic('error', 'PROOF_MULTIPLE', `@${target} has more than one associated proof`, proof.file, proof.line, target));
      continue;
    }
    const proof = proofs[0];
    if (result) {
      if (proof.file !== result.file) diagnostics.push(diagnostic('error', 'PROOF_DIFFERENT_FILE', `Proof of @${target} must be in the result's source file`, proof.file, proof.line, target));
      result.proof_hash = proof.proof_hash;
      result.proof_present = proof.proof_present;
      result.dependencies = proof.dependencies;
      result.uses = proof.dependencies;
      result.proof_file = proof.file;
      result.proof_line = proof.line;
    }
  }

  const fileMap = new Map(files.map((file) => [file.path, file]));
  const importAdjacency = new Map(files.map((file) => [file.path, []]));
  for (const file of files) {
    const available = new Set(file.results);
    for (const declaration of file.imports) {
      if (declaration.use.includes('*') && !config.semantic['wildcard-imports']) diagnostics.push(diagnostic('error', 'WILDCARD_IMPORT', 'Wildcard imports are forbidden', file.path));
      const importedPath = resolveImport(file.path, declaration.from);
      if (!importedPath || !fileMap.has(importedPath)) {
        diagnostics.push(diagnostic('error', 'IMPORT_FILE_MISSING', `Imported file does not exist: ${declaration.from}`, file.path));
        continue;
      }
      importAdjacency.get(file.path).push(importedPath);
      for (const id of declaration.use) {
        const target = byId.get(id);
        if (!target || target.file !== importedPath) diagnostics.push(diagnostic('error', 'IMPORT_ID_MISSING', `@${id} is not defined in ${importedPath}`, file.path));
        else if (!target.export) diagnostics.push(diagnostic('error', 'IMPORT_NOT_EXPORTED', `@${id} is not exported by ${importedPath}`, file.path));
        else available.add(id);
      }
    }
    for (const id of file.results) {
      const result = byId.get(id);
      for (const dependency of result.dependencies) {
        if (!byId.has(dependency)) diagnostics.push(diagnostic('error', 'DEPENDENCY_UNKNOWN', `@${dependency} cited by the proof does not exist`, result.file, result.proof_line ?? result.line, result.id));
        else if (!available.has(dependency)) diagnostics.push(diagnostic('error', 'DEPENDENCY_UNAVAILABLE', `@${dependency} is cited by the proof but is not local or imported`, result.file, result.proof_line ?? result.line, result.id));
      }
    }
  }
  for (const cycle of findCycles(importAdjacency)) diagnostics.push(diagnostic('error', 'IMPORT_CYCLE', `Import cycle: ${cycle.join(' -> ')}`, cycle[0]));
  const dependencyAdjacency = new Map(allResults.map((result) => [result.id, result.dependencies.filter((id) => byId.has(id))]));
  for (const cycle of findCycles(dependencyAdjacency)) {
    const result = byId.get(cycle[0]);
    diagnostics.push(diagnostic('error', 'DEPENDENCY_CYCLE', `Semantic dependency cycle: ${cycle.map((id) => `@${id}`).join(' -> ')}`, result?.file, result?.line, result?.id));
  }

  const locksFile = path.join(root, AUX, 'statement-locks.json');
  const locks = await readJson(locksFile, {});
  const protectStatements = options.protectStatements ?? !options.files;
  if (protectStatements) {
    for (const result of allResults.filter((item) => item.origin === 'user')) {
      const prior = locks[result.id];
      if (!prior) locks[result.id] = { statement_hash: result.statement_hash, title_hash: result.title_hash, file: result.file };
      else {
        if (prior.statement_hash !== result.statement_hash) diagnostics.push(diagnostic('error', 'MAIN_STATEMENT_MUTATED', `${result.id} statement differs from its user-owned baseline`, result.file, result.line, result.id));
        if (prior.title_hash !== result.title_hash) diagnostics.push(diagnostic('error', 'MAIN_TITLE_MUTATED', `${result.id} title differs from its user-owned baseline`, result.file, result.line, result.id));
      }
    }
  }

  const verification = await readJson(path.join(root, AUX, 'verification', 'index.json'), {});
  for (const result of allResults) result.status = verificationStatus(result, verification);
  for (const result of allResults) {
    if (result.proof_present && result.status !== 'verified') {
      for (const dependency of result.dependencies) {
        const premise = byId.get(dependency);
        if (premise && premise.status !== 'verified') diagnostics.push(diagnostic('warning', 'DEPENDENCY_STATUS_INSUFFICIENT', `${result.id} cites @${dependency}, whose current status is ${premise.status}`, result.file, result.proof_line ?? result.line, result.id));
      }
    }
    if (result.status === 'verified') {
      for (const dependency of result.dependencies) {
        if (byId.get(dependency)?.status !== 'verified') diagnostics.push(diagnostic('error', 'VERIFIED_DEPENDENCY_INVALID', `${result.id} depends on unverified @${dependency}`, result.file, result.proof_line ?? result.line, result.id));
      }
    }
  }

  allResults.sort((a, b) => a.id.localeCompare(b.id));
  files.sort((a, b) => a.path.localeCompare(b.path));
  diagnostics.sort((a, b) => `${a.file ?? ''}:${a.line ?? 0}:${a.code}`.localeCompare(`${b.file ?? ''}:${b.line ?? 0}:${b.code}`));
  const manifest = { schema_version: 1, files, results: allResults, proofs: allProofs.map(({ blocks, ...proof }) => proof) };
  const graph = {
    schema_version: 1,
    nodes: allResults.map(({ id, title, kind, status, file, line }) => ({ id, title, kind, status, file, line })),
    edges: allResults.flatMap((result) => result.dependencies.map((dependency) => ({ from: result.id, to: dependency }))).sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`))
  };
  const summary = {
    files: files.length,
    results: allResults.length,
    goals: allResults.filter((result) => result.origin === 'user').map(({ id, status, file, line }) => ({ id, status, file, line })),
    errors: diagnostics.filter((item) => item.severity === 'error').length,
    warnings: diagnostics.filter((item) => item.severity === 'warning').length
  };
  const ok = summary.errors === 0;
  if (options.write !== false) {
    await atomicJson(path.join(root, AUX, 'diagnostics.json'), diagnostics);
    if (ok) {
      await Promise.all([
        atomicJson(path.join(root, AUX, 'manifest.json'), manifest),
        atomicJson(path.join(root, AUX, 'graph.json'), graph),
        ...(protectStatements ? [atomicJson(locksFile, locks)] : [])
      ]);
    }
  }
  return { root, config, manifest, graph, diagnostics, summary, ok };
}

export function theoremBundle(compilation, requested) {
  const id = cleanId(requested);
  const byId = new Map(compilation.manifest.results.map((result) => [result.id, result]));
  const target = byId.get(id);
  if (!target) throw new Error(`Unknown theorem: @${id}`);
  const closure = [];
  const seen = new Set();
  const limit = 100;
  function visit(current) {
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
