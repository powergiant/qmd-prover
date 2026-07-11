import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { AUX, atomicJson, atomicWrite, cleanId, exists, readJson, relativePosix, sha256, stableJson } from './files.mjs';
import { loadConfig } from './config.mjs';
import { inlineText, normalizedAst, readAst, references, walk } from './pandoc.mjs';
import { locateDiv } from './source.mjs';

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

function sectionize(blocks) {
  const sections = new Map();
  let current = '_preamble';
  sections.set(current, []);
  for (const block of blocks) {
    if (block.t === 'Header') {
      const title = inlineText(block.c?.[2] ?? []).toLowerCase();
      if (['statement', 'uses', 'proof'].includes(title)) {
        current = title;
        if (!sections.has(current)) sections.set(current, []);
        continue;
      }
    }
    sections.get(current).push(block);
  }
  return sections;
}

function titleOf(blocks) {
  const header = blocks.find((block) => block.t === 'Header');
  return header ? inlineText(header.c?.[2] ?? []) : '';
}

function parseImports(blocks) {
  const text = blocks.map((block) => inlineText(block)).join('\n');
  const from = text.match(/(?:^|\s)from:\s*([^\s]+)/i)?.[1] ?? '';
  return { from, use: references(blocks) };
}

function semanticDivs(ast) {
  const results = [];
  walk(ast.blocks ?? [], (node) => {
    if (node.t !== 'Div') return;
    const attribute = attrs(node.c?.[0]);
    const blocks = node.c?.[1] ?? [];
    const kind = kindClasses.find((candidate) => attribute.classes.includes(candidate));
    if (attribute.classes.includes('theorem-imports')) results.push({ type: 'import', attribute, blocks, ...parseImports(blocks) });
    else if (attribute.id && (semanticPrefixes.test(attribute.id) || kind)) results.push({ type: 'result', attribute, blocks, kind });
  });
  return results;
}

function resolveImport(importer, imported) {
  const candidate = path.posix.normalize(path.posix.join(path.posix.dirname(importer), imported));
  return candidate.startsWith('../') ? null : candidate;
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
  if (record?.status === 'revoked') return 'revoked';
  if (record?.status === 'verified' && record.statement_hash === result.statement_hash && record.proof_hash === result.proof_hash) return 'verified';
  if (record?.status === 'rejected' && record.statement_hash === result.statement_hash && record.canonical_proof_hash === result.proof_hash) return 'rejected';
  if (!result.proof_present) return 'open';
  return 'candidate';
}

async function initializeAux(root) {
  const directories = ['tasks', 'workers', 'proposals', 'verification', 'accepted', 'rejected', 'dead-ends', 'reports', 'graphs', 'site', 'cache'];
  await Promise.all(directories.map((directory) => mkdir(path.join(root, AUX, directory), { recursive: true })));
  const initialFiles = [
    [path.join(root, AUX, 'goal-locks.json'), {}],
    [path.join(root, AUX, 'verification', 'index.json'), {}]
  ];
  for (const [file, value] of initialFiles) if (!await exists(file)) await atomicJson(file, value);
  const configFile = path.join(root, AUX, 'config.yml');
  if (!await exists(configFile)) await atomicWrite(configFile, `project:\n  name: ${path.basename(root)}\n  root: ..\n  discover-qmd-recursively: true\n  exclude: [.qmd-prover]\n\ngoals:\n  id-prefix: thm-main-\n  protect-statements: true\n\nsemantic:\n  wildcard-imports: false\n  require-declared-uses: true\n\nverification:\n  backend: none\n  model: configurable\n  effort: high\n  fresh-context: true\n  require-zero-gaps: true\n\nrender:\n  graph-engine: builtin\n  hover-previews: true\n  output-dir: .qmd-prover/site\n`);
  const quartoFile = path.join(root, AUX, '_quarto.yml');
  if (!await exists(quartoFile)) await atomicWrite(quartoFile, `project:\n  type: website\n  output-dir: site\n`);
}

export async function compileProject(root = process.cwd(), options = {}) {
  root = path.resolve(root);
  if (options.write !== false) await initializeAux(root);
  const config = await loadConfig(root);
  const discovered = options.files
    ? options.files.map((absolute) => ({ absolute: path.resolve(absolute), relative: relativePosix(root, path.resolve(absolute)) }))
    : await discover(root, root);
  const diagnostics = [];
  const files = [];
  const allResults = [];
  for (const file of discovered) {
    try {
      const [ast, source] = await Promise.all([readAst(file.absolute, options), readFile(file.absolute, 'utf8')]);
      const entries = semanticDivs(ast);
      const imports = [];
      const results = [];
      for (const entry of entries) {
        if (entry.type === 'import') {
          imports.push({ from: entry.from, use: entry.use });
          if (!entry.from) diagnostics.push(diagnostic('error', 'IMPORT_FROM_MISSING', 'Import block requires a from path', file.relative));
          if (entry.use.length === 0) diagnostics.push(diagnostic('error', 'IMPORT_USE_MISSING', 'Import block requires an explicit, nonempty use list', file.relative));
          continue;
        }
        const { id, classes, values } = entry.attribute;
        const located = locateDiv(source, id);
        const line = located?.startLine;
        const sections = sectionize(entry.blocks);
        const statement = sections.get('statement') ?? [];
        const proof = sections.get('proof') ?? [];
        const uses = references(sections.get('uses') ?? []);
        const proofRefs = references(proof);
        const title = titleOf(sections.get('_preamble') ?? entry.blocks);
        const statementHash = sha256(stableJson(normalizedAst(statement), 0));
        const proofHash = sha256(stableJson(normalizedAst(proof), 0));
        const semanticKinds = classes.filter((item) => kindClasses.includes(item));
        const kind = entry.kind ?? 'unknown';
        const result = {
          id, file: file.relative, line, kind, classes: [...classes].sort(), title,
          origin: id.startsWith(config.goals['id-prefix']) ? 'user' : 'agent',
          export: values.export ?? null,
          statement_hash: statementHash,
          title_hash: sha256(title),
          proof_hash: proofHash,
          proof_present: inlineText(proof).length > 0 || proof.some((block) => !['Null'].includes(block.t)),
          uses, proof_references: proofRefs
        };
        results.push(result);
        allResults.push(result);
        if (!semanticPrefixes.test(id)) diagnostics.push(diagnostic('error', 'INVALID_ID_PREFIX', `Semantic ID ${id} uses an unreserved prefix`, file.relative, line, id));
        if (semanticKinds.length === 0) diagnostics.push(diagnostic('error', 'SEMANTIC_KIND_MISSING', `${id} requires one semantic kind class`, file.relative, line, id));
        if (semanticKinds.length > 1) diagnostics.push(diagnostic('error', 'SEMANTIC_KIND_MULTIPLE', `${id} has multiple semantic kind classes`, file.relative, line, id));
        const prefix = id.match(semanticPrefixes)?.[1];
        if (prefix && entry.kind && expectedKind[prefix] !== entry.kind) diagnostics.push(diagnostic('error', 'ID_KIND_MISMATCH', `${id} requires class .${expectedKind[prefix]}, not .${entry.kind}`, file.relative, line, id));
        if (id.startsWith(config.goals['id-prefix']) && (!classes.includes('goal') || entry.kind !== 'theorem')) diagnostics.push(diagnostic('error', 'MAIN_GOAL_SHAPE', `${id} requires both .theorem and .goal classes`, file.relative, line, id));
        if (statement.length === 0) diagnostics.push(diagnostic('error', 'STATEMENT_MISSING', `${id} requires a nonempty Statement section`, file.relative, line, id));
        if (!sections.has('proof')) diagnostics.push(diagnostic('error', 'PROOF_SECTION_MISSING', `${id} requires a Proof section`, file.relative, line, id));
        const undeclared = proofRefs.filter((ref) => !uses.includes(ref));
        const unused = uses.filter((ref) => !proofRefs.includes(ref));
        if (config.semantic['require-declared-uses'] && undeclared.length) diagnostics.push(diagnostic('error', 'UNDECLARED_PROOF_REFERENCE', `${id} cites undeclared dependencies: ${undeclared.map((x) => `@${x}`).join(', ')}`, file.relative, line, id));
        if (config.semantic['require-declared-uses'] && unused.length && result.proof_present) diagnostics.push(diagnostic('error', 'UNUSED_DECLARED_USE', `${id} declares dependencies not cited in its proof: ${unused.map((x) => `@${x}`).join(', ')}`, file.relative, line, id));
      }
      files.push({ path: file.relative, imports, results: results.map((result) => result.id) });
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
      for (const dependency of result.uses) {
        if (!available.has(dependency)) diagnostics.push(diagnostic('error', 'DEPENDENCY_UNAVAILABLE', `@${dependency} is neither local nor explicitly imported`, result.file, result.line, result.id));
      }
    }
  }
  for (const cycle of findCycles(importAdjacency)) diagnostics.push(diagnostic('error', 'IMPORT_CYCLE', `Import cycle: ${cycle.join(' -> ')}`, cycle[0]));
  const dependencyAdjacency = new Map(allResults.map((result) => [result.id, result.uses.filter((id) => byId.has(id))]));
  for (const cycle of findCycles(dependencyAdjacency)) {
    const result = byId.get(cycle[0]);
    diagnostics.push(diagnostic('error', 'DEPENDENCY_CYCLE', `Semantic dependency cycle: ${cycle.map((id) => `@${id}`).join(' -> ')}`, result?.file, result?.line, result?.id));
  }

  const locksFile = path.join(root, AUX, 'statement-locks.json');
  const locks = await readJson(locksFile, {});
  for (const result of allResults.filter((item) => item.origin === 'user')) {
    const prior = locks[result.id];
    if (!prior) locks[result.id] = { statement_hash: result.statement_hash, title_hash: result.title_hash, file: result.file };
    else {
      if (prior.statement_hash !== result.statement_hash) diagnostics.push(diagnostic('error', 'MAIN_STATEMENT_MUTATED', `${result.id} statement differs from its user-owned baseline`, result.file, result.line, result.id));
      if (prior.title_hash !== result.title_hash) diagnostics.push(diagnostic('error', 'MAIN_TITLE_MUTATED', `${result.id} title differs from its user-owned baseline`, result.file, result.line, result.id));
    }
  }
  if (options.write !== false) await atomicJson(locksFile, locks);

  const verification = await readJson(path.join(root, AUX, 'verification', 'index.json'), {});
  const goalState = await readJson(path.join(root, AUX, 'goal-locks.json'), {});
  for (const result of allResults) {
    result.status = verificationStatus(result, verification);
    const persisted = goalState[result.id]?.status;
    if (['open', 'in-progress', 'blocked', 'refuted', 'cancelled'].includes(persisted) && !['verified', 'revoked', 'rejected'].includes(result.status)) result.status = persisted;
  }
  for (const result of allResults) {
    if (result.status === 'verified') {
      for (const dependency of result.uses) {
        if (byId.get(dependency)?.status !== 'verified') diagnostics.push(diagnostic('error', 'VERIFIED_DEPENDENCY_INVALID', `${result.id} depends on unverified @${dependency}`, result.file, result.line, result.id));
      }
    }
  }

  allResults.sort((a, b) => a.id.localeCompare(b.id));
  files.sort((a, b) => a.path.localeCompare(b.path));
  diagnostics.sort((a, b) => `${a.file ?? ''}:${a.line ?? 0}:${a.code}`.localeCompare(`${b.file ?? ''}:${b.line ?? 0}:${b.code}`));
  const manifest = { schema_version: 1, files, results: allResults };
  const graph = {
    schema_version: 1,
    nodes: allResults.map(({ id, title, kind, status, file, line }) => ({ id, title, kind, status, file, line })),
    edges: allResults.flatMap((result) => result.uses.map((dependency) => ({ from: result.id, to: dependency }))).sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`))
  };
  const summary = {
    files: files.length,
    results: allResults.length,
    goals: allResults.filter((result) => result.origin === 'user').map(({ id, status, file, line }) => ({ id, status, file, line })),
    errors: diagnostics.filter((item) => item.severity === 'error').length,
    warnings: diagnostics.filter((item) => item.severity === 'warning').length
  };
  if (options.write !== false) {
    await Promise.all([
      atomicJson(path.join(root, AUX, 'manifest.json'), manifest),
      atomicJson(path.join(root, AUX, 'graph.json'), graph),
      atomicJson(path.join(root, AUX, 'diagnostics.json'), diagnostics)
    ]);
  }
  return { root, config, manifest, graph, diagnostics, summary, ok: summary.errors === 0 };
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
    for (const dependency of current.uses) {
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
