import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { AUX, atomicJson, atomicWrite, cleanId, exists, readJson, relativePosix, sha256, stableJson } from './files.mjs';
import { loadConfig } from './config.mjs';
import { inlineText, normalizedAst, readAst, references, walk } from './pandoc.mjs';
import { locateDiv, locateProof } from './source.mjs';

const semanticPrefixes = /^(def|lem|thm|prp|cor)-/;
const semanticId = /^(def|lem|thm|prp|cor)-[A-Za-z0-9._:-]+$/;
const kindClasses = ['definition', 'lemma', 'theorem', 'proposition', 'corollary'];
const expectedKind = { def: 'definition', lem: 'lemma', thm: 'theorem', prp: 'proposition', cor: 'corollary' };
const controlMarkers = new Set(['OPEN', 'REJECTED', 'VERIFIED', 'REVOKED']);

function diagnostic(severity, code, message, file, line, id) {
  return { severity, code, message, ...(file ? { file } : {}), ...(line ? { line } : {}), ...(id ? { id } : {}) };
}

function excluded(relative, exclusions) {
  let ignored = false;
  for (const entry of exclusions) {
    const rooted = entry.pattern.startsWith('/');
    const pattern = entry.pattern.replace(/^\//, '').replace(/\/$/, '');
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replaceAll('**', '\0')
      .replaceAll('*', '[^/]*')
      .replaceAll('?', '[^/]')
      .replaceAll('\0', '.*');
    const prefix = rooted || pattern.includes('/') ? '^' : '(?:^|/)';
    if (new RegExp(`${prefix}${escaped}(?:/|$)`).test(relative)) ignored = !entry.negate;
  }
  return ignored;
}

function mayReincludeDescendant(relative, exclusions) {
  return exclusions.some((entry) => {
    if (!entry.negate) return false;
    const pattern = entry.pattern.replace(/^\//, '').replace(/\/$/, '');
    if (!pattern.includes('/')) return true;
    const wildcard = [pattern.indexOf('*'), pattern.indexOf('?')].filter((index) => index >= 0).sort((left, right) => left - right)[0] ?? pattern.length;
    const prefix = pattern.slice(0, wildcard).replace(/\/$/, '');
    return prefix === relative || prefix.startsWith(`${relative}/`);
  });
}

async function discoveryExclusions(root, config) {
  let ignored = [];
  try {
    ignored = (await readFile(path.join(root, '.gitignore'), 'utf8')).split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => ({ pattern: line.replace(/^!/, ''), negate: line.startsWith('!') }))
      .filter((entry) => entry.pattern !== '');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const protectedExclusions = unique([
    AUX,
    '.git',
    'node_modules',
    ...(Array.isArray(config.project.exclude) ? config.project.exclude : []),
    config.render['output-dir']
  ].filter(Boolean).map((entry) => String(entry).replace(/^\.\//, '').replace(/\/$/, '')))
    .map((pattern) => ({ pattern, negate: false }));
  return [...ignored, ...protectedExclusions];
}

async function discover(directory, root, exclusions, output = []) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    const relative = relativePosix(root, absolute);
    if (excluded(relative, exclusions) && !(entry.isDirectory() && mayReincludeDescendant(relative, exclusions))) continue;
    if (entry.isDirectory()) await discover(absolute, root, exclusions, output);
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

function unique(values) {
  return [...new Set(values)].sort();
}

function proofContent(blocks) {
  const index = blocks.findIndex((block) => block.t !== 'Null');
  const marker = index >= 0 && ['Para', 'Plain'].includes(blocks[index].t)
    ? inlineText(blocks[index].c ?? [])
    : '';
  if (!controlMarkers.has(marker)) return { marker: null, blocks };
  return { marker, blocks: blocks.filter((_, blockIndex) => blockIndex !== index) };
}

function resolveImport(importer, imported) {
  const candidate = path.posix.normalize(path.posix.join(path.posix.dirname(importer), imported));
  return candidate.startsWith('../') || path.posix.isAbsolute(candidate) ? null : candidate;
}

export function findCycles(adjacency) {
  const cycles = [];
  const state = new Map();
  const stack = [];
  const seen = new Set();
  function canonical(cycle) {
    const open = cycle.slice(0, -1);
    const rotations = open.map((_, index) => [...open.slice(index), ...open.slice(0, index)]);
    const selected = rotations.sort((left, right) => left.join('\0').localeCompare(right.join('\0')))[0];
    return [...selected, selected[0]];
  }
  function visit(node) {
    state.set(node, 'visiting');
    stack.push(node);
    for (const next of [...(adjacency.get(node) ?? [])].sort()) {
      if (state.get(next) === 'visiting') {
        const cycle = canonical([...stack.slice(stack.indexOf(next)), next]);
        const key = cycle.join('\0');
        if (!seen.has(key)) { seen.add(key); cycles.push(cycle); }
      } else if (!state.has(next)) visit(next);
    }
    stack.pop();
    state.set(node, 'visited');
  }
  for (const node of [...adjacency.keys()].sort()) if (!state.has(node)) visit(node);
  return cycles.sort((left, right) => left.join('\0').localeCompare(right.join('\0')));
}

function verificationStatus(result, verification, evidence) {
  const record = verification[result.id];
  const identityMatches = record?.statement_hash === result.statement_hash && record.proof_hash === result.proof_hash;
  if (result.marker === 'REVOKED' && record?.status === 'revoked' && identityMatches && record.reason?.trim()) return 'revoked';
  if (result.marker === 'VERIFIED' && record?.status === 'verified' && identityMatches && evidence.get(result.id)?.valid) return 'verified';
  if (result.marker === 'REJECTED' || (record?.status === 'rejected' && record.statement_hash === result.statement_hash && record.canonical_proof_hash === result.proof_hash)) return 'rejected';
  if (result.marker === 'OPEN' || !result.proof_present) return 'open';
  return 'candidate';
}

async function verificationEvidence(root, verification) {
  const evidence = new Map();
  const verificationRoot = path.join(root, AUX, 'verification');
  function evidencePath(relative) {
    if (typeof relative !== 'string') return null;
    const absolute = path.resolve(root, relative);
    return absolute.startsWith(`${verificationRoot}${path.sep}`) ? absolute : null;
  }
  await Promise.all(Object.entries(verification).map(async ([id, entry]) => {
    if (entry.status !== 'verified') return;
    let record = null;
    let cache = null;
    const recordFile = evidencePath(entry.record);
    const cacheFile = evidencePath(entry.cache);
    try { if (recordFile) record = await readJson(recordFile); } catch { /* Invalid evidence fails closed below. */ }
    try { if (cacheFile) cache = await readJson(cacheFile); } catch { /* Invalid evidence fails closed below. */ }
    const valid = record?.accepted === true
      && record.submission_id === entry.submission_id
      && record.statement_hash === entry.statement_hash
      && record.proof_hash === entry.proof_hash
      && cache?.id === id
      && cache.statement_hash === entry.statement_hash
      && cache.proof_hash === entry.proof_hash
      && stableJson(cache.dependency_snapshot ?? {}, 0) === stableJson(entry.dependency_snapshot ?? {}, 0);
    evidence.set(id, { valid, record, cache });
  }));
  return evidence;
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
  const exclusions = await discoveryExclusions(root, config);
  let discovered = options.files
    ? options.files.map((absolute) => ({ absolute: path.resolve(absolute), relative: relativePosix(root, path.resolve(absolute)) }))
    : await discover(root, root, exclusions);
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
          const content = proofContent(entry.blocks);
          const proof = {
            target, file: file.relative, line,
            marker: content.marker,
            proof_hash: sha256(stableJson(normalizedAst(content.blocks), 0)),
            proof_present: inlineText(content.blocks).length > 0 || content.blocks.some((block) => block.t !== 'Null'),
            proof_text: inlineText(content.blocks),
            dependencies: references(content.blocks),
            blocks: content.blocks
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
          statement_text: inlineText(entry.blocks),
          statement_hash: sha256(stableJson(normalizedAst(entry.blocks), 0)),
          title_hash: sha256(title),
          proof_hash: sha256(stableJson(normalizedAst([]), 0)),
          proof_present: false,
          proof_text: '',
          marker: null,
          construction_dependencies: kind === 'definition' ? references(entry.blocks) : [],
          dependencies: kind === 'definition' ? references(entry.blocks) : [],
          uses: kind === 'definition' ? references(entry.blocks) : []
        };
        results.push(result);
        allResults.push(result);
        if (!semanticId.test(id)) diagnostics.push(diagnostic('error', 'INVALID_SEMANTIC_ID', `Semantic ID ${id} must use a reserved prefix followed by letters, digits, dot, underscore, colon, or hyphen`, file.relative, line, id));
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
  const idCounts = new Map();
  const byExport = new Map();
  for (const result of allResults) {
    idCounts.set(result.id, (idCounts.get(result.id) ?? 0) + 1);
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
      result.proof_text = proof.proof_text;
      result.marker = proof.marker;
      result.dependencies = unique([...result.construction_dependencies, ...proof.dependencies]);
      result.uses = result.dependencies;
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
      if (!result || result.file !== file.path) continue;
      result.reference_checks = [];
      for (const dependency of result.dependencies) {
        const count = idCounts.get(dependency) ?? 0;
        const existsCheck = count === 1 ? 'pass' : 'fail';
        const scopeCheck = count === 1 && available.has(dependency) ? 'pass' : 'fail';
        result.reference_checks.push({ dependency, existence: existsCheck, scope: scopeCheck, status: 'pending', ai_sufficiency: 'not-run' });
        if (count === 0) diagnostics.push(diagnostic('error', 'DEPENDENCY_UNKNOWN', `@${dependency} cited by @${result.id} does not exist`, result.file, result.proof_line ?? result.line, result.id));
        else if (count > 1) diagnostics.push(diagnostic('error', 'DEPENDENCY_AMBIGUOUS', `@${dependency} cited by @${result.id} is ambiguous`, result.file, result.proof_line ?? result.line, result.id));
        else if (!available.has(dependency)) diagnostics.push(diagnostic('error', 'DEPENDENCY_UNAVAILABLE', `@${dependency} cited by @${result.id} is not local or explicitly imported`, result.file, result.proof_line ?? result.line, result.id));
      }
    }
  }
  const importCycles = findCycles(importAdjacency);
  for (const cycle of importCycles) diagnostics.push(diagnostic('error', 'IMPORT_CYCLE', `Import cycle: ${cycle.join(' -> ')}`, cycle[0]));
  const dependencyAdjacency = new Map(allResults.map((result) => [result.id, result.dependencies.filter((id) => byId.has(id))]));
  const dependencyCycles = findCycles(dependencyAdjacency);
  const cycleEdges = new Set();
  for (const cycle of dependencyCycles) {
    for (let index = 0; index < cycle.length - 1; index += 1) cycleEdges.add(`${cycle[index]}\0${cycle[index + 1]}`);
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
  const evidence = await verificationEvidence(root, verification);
  for (const result of allResults) result.status = verificationStatus(result, verification, evidence);
  const compiledFiles = new Map(files.map((file) => [file.path, file]));
  let statusChanged = true;
  while (statusChanged) {
    statusChanged = false;
    for (const result of allResults.filter((item) => item.status === 'verified')) {
      const entry = verification[result.id];
      const cache = evidence.get(result.id)?.cache;
      const dependencyChanged = Object.entries(entry.dependency_snapshot ?? {}).some(([id, identity]) => {
        const dependency = byId.get(id);
        return !dependency || sha256(`${dependency.statement_hash}:${dependency.proof_hash}:${dependency.status}`) !== identity;
      });
      const scopeChanged = stableJson(cache?.scope ?? [], 0) !== stableJson(compiledFiles.get(result.file)?.imports ?? [], 0);
      const sourceChanged = cache?.source?.file !== result.file;
      const checkerChanged = cache?.verification?.backend !== config.verification.backend || cache?.verification?.model !== config.verification.model;
      if (dependencyChanged || scopeChanged || sourceChanged || checkerChanged) {
        result.status = 'candidate';
        result.stale_reasons = [
          ...(dependencyChanged ? ['dependency-snapshot-changed'] : []),
          ...(scopeChanged ? ['scope-changed'] : []),
          ...(sourceChanged ? ['source-association-changed'] : []),
          ...(checkerChanged ? ['checker-contract-changed'] : [])
        ];
        statusChanged = true;
      }
    }
  }
  for (const result of allResults) {
    const record = verification[result.id];
    if (result.marker === 'VERIFIED' && result.status !== 'verified') diagnostics.push(diagnostic('error', 'VERIFIED_RECORD_INVALID', `${result.id} has VERIFIED without a matching current record`, result.file, result.proof_line ?? result.line, result.id));
    if (result.marker === 'REVOKED' && result.status !== 'revoked') diagnostics.push(diagnostic('error', 'REVOKED_RECORD_INVALID', `${result.id} has REVOKED without a matching revocation record and reason`, result.file, result.proof_line ?? result.line, result.id));
    if (record?.status === 'verified' && result.marker !== 'VERIFIED') diagnostics.push(diagnostic('error', 'VERIFIED_MARKER_MISSING', `${result.id} has a verification record but no matching VERIFIED marker`, result.file, result.proof_line ?? result.line, result.id));
    for (const check of result.reference_checks ?? []) {
      const premise = idCounts.get(check.dependency) === 1 ? byId.get(check.dependency) : null;
      check.status = premise?.status === 'verified' ? 'pass' : 'fail';
      check.cycle = cycleEdges.has(`${result.id}\0${check.dependency}`) ? 'fail' : 'pass';
      check.ai_sufficiency = result.status === 'verified' ? 'pass' : 'not-run';
      if (check.existence === 'pass' && check.scope === 'pass' && check.cycle === 'pass' && check.status === 'fail') {
        diagnostics.push(diagnostic('error', 'DEPENDENCY_STATUS_INSUFFICIENT', `${result.id} cites @${check.dependency}, whose current status is ${premise.status}`, result.file, result.proof_line ?? result.line, result.id));
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
  const manifest = { schema_version: 2, files, results: allResults, proofs: allProofs.map(({ blocks, ...proof }) => proof) };
  const missingIds = unique(allResults.flatMap((result) => result.dependencies).filter((id) => !byId.has(id)));
  const graph = {
    schema_version: 2,
    nodes: [
      ...allResults.map(({ id, title, kind, status, file, line, origin, statement_hash, proof_hash }) => ({
        id, title, kind, status, file, line, origin: 'canonical', ownership: origin,
        identity: { statement_hash, proof_hash }
      })),
      ...missingIds.map((id) => ({ id, title: '', kind: 'unknown', status: 'missing', origin: 'unresolved' }))
    ],
    edges: allResults.flatMap((result) => result.dependencies.map((dependency) => {
      const check = result.reference_checks?.find((item) => item.dependency === dependency);
      return { from: result.id, to: dependency, checks: check ?? { existence: 'fail', scope: 'fail', status: 'fail', cycle: 'pass', ai_sufficiency: 'not-run' } };
    })).sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`)),
    cycles: dependencyCycles
  };
  graph.snapshot_id = sha256(stableJson(graph, 0));
  manifest.snapshot_id = graph.snapshot_id;
  const summary = {
    files: files.length,
    results: allResults.length,
    goals: allResults.filter((result) => result.origin === 'user').map(({ id, status, file, line }) => ({ id, status, file, line })),
    errors: diagnostics.filter((item) => item.severity === 'error').length,
    warnings: diagnostics.filter((item) => item.severity === 'warning').length
  };
  const ok = summary.errors === 0;
  const complete = diagnostics.every((item) => item.code !== 'PARSE_ERROR');
  if (options.write !== false) {
    await atomicJson(path.join(root, AUX, 'diagnostics.json'), diagnostics);
    if (complete) {
      const snapshot = { schema_version: 2, snapshot_id: graph.snapshot_id, manifest, graph, summary, diagnostics };
      const snapshotFile = path.join(root, AUX, 'graphs', `${graph.snapshot_id.slice('sha256:'.length)}.json`);
      await Promise.all([
        atomicJson(snapshotFile, snapshot),
        atomicJson(path.join(root, AUX, 'manifest.json'), manifest),
        atomicJson(path.join(root, AUX, 'graph.json'), graph),
        ...(protectStatements && ok ? [atomicJson(locksFile, locks)] : [])
      ]);
      await atomicJson(path.join(root, AUX, 'graphs', 'latest.json'), {
        schema_version: 2,
        snapshot_id: graph.snapshot_id,
        file: relativePosix(root, snapshotFile)
      });
    }
  }
  return { root, config, manifest, graph, diagnostics, summary, ok, complete };
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
