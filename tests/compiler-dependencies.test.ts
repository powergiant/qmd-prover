import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { readJson } from '../skills/qmd-prover/src/lib/infrastructure/files.js';
import { analyzeDependencies, inspectFact, inspectPath, inspectProject } from '../skills/qmd-prover/src/lib/inspection/operations.js';
import { compileProject, theoremBundle } from '../skills/qmd-prover/src/lib/semantic/compiler.js';
import { initializeWorkspace } from '../skills/qmd-prover/src/lib/workspace/initialize.js';
import { document, must, options, project, result, proof } from './support.js';

test('compiler reads metadata imports, linked proofs, and deterministic semantic indexes', async () => {
  const root = await project();
  await mkdir(path.join(root, 'foundations'));
  await writeFile(path.join(root, 'foundations', 'base.qmd'), result('lem-base', 'For every x, x equals x.', { proofText: 'This follows by reflexivity.', exported: true }));
  await writeFile(path.join(root, 'goal.qmd'), document(
    [{ from: 'foundations/base.qmd', use: ['lem-base'] }],
    `Unrestricted prose.\n\n${result('thm-main-goal', 'For every x, x equals x.', { proofText: 'Apply @lem-base.' })}`
  ));
  const first = await compileProject(root, options);
  const firstManifest = await readFile(path.join(root, '.qmd-prover', 'manifest.json'), 'utf8');
  const second = await compileProject(root, options);
  const secondManifest = await readFile(path.join(root, '.qmd-prover', 'manifest.json'), 'utf8');
  assert.equal(first.ok, false);
  assert.equal(first.complete, true);
  assert.equal(second.ok, false);
  assert.equal(firstManifest, secondManifest);
  assert.deepEqual(must(first.summary.goals).map((goal) => goal.id), ['thm-main-goal']);
  assert.deepEqual(first.graph.edges.map(({ from, to }) => ({ from, to })), [{ from: 'thm-main-goal', to: 'lem-base' }]);
  assert.deepEqual(must(first.manifest.results.find((item) => item.id === 'thm-main-goal')).dependencies, ['lem-base']);
  assert.ok(first.diagnostics.some((item) => item.code === 'DEPENDENCY_STATUS_INSUFFICIENT' && item.severity === 'error'));
  assert.equal(must(first.graph.edges[0]?.checks).status, 'fail');
  assert.equal(must(theoremBundle(first, '@thm-main-goal').dependencies[0]).id, 'lem-base');
});

test('source discovery honors configured exclusions and gitignore reinclusions deterministically', async () => {
  const root = await project();
  await Promise.all([mkdir(path.join(root, 'generated')), mkdir(path.join(root, 'ignored'))]);
  await writeFile(path.join(root, '.qmd-prover', 'config.yml'), 'project:\n  exclude: [generated]\nrender:\n  output-dir: rendered\n');
  await writeFile(path.join(root, '.gitignore'), 'ignored/\n!ignored/keep.qmd\n');
  await writeFile(path.join(root, 'visible.qmd'), result('lem-visible', 'Visible.'));
  await writeFile(path.join(root, 'generated', 'excluded.qmd'), result('lem-config-excluded', 'Excluded.'));
  await writeFile(path.join(root, 'ignored', 'excluded.qmd'), result('lem-git-excluded', 'Excluded.'));
  await writeFile(path.join(root, 'ignored', 'keep.qmd'), result('lem-git-reincluded', 'Reincluded.'));
  const compilation = await compileProject(root, options);
  assert.deepEqual(compilation.manifest.files.map((file) => file.path), ['ignored/keep.qmd', 'visible.qmd']);
  assert.deepEqual(compilation.manifest.results.map((item) => item.id), ['lem-git-reincluded', 'lem-visible']);
});

test('compiler diagnoses metadata imports, duplicates, proof shape, and cycles', async () => {
  const root = await project();
  await writeFile(path.join(root, 'a.qmd'), document(
    [{ from: 'b.qmd', use: ['lem-b'] }],
    result('lem-a', 'A.', { proofText: 'Use @lem-b.' })
  ));
  await writeFile(path.join(root, 'b.qmd'), document(
    [{ from: 'a.qmd', use: ['lem-a'] }],
    `${result('lem-b', 'B.', { exported: true })}${result('lem-a', 'Duplicate.')}`
  ));
  await writeFile(path.join(root, 'orphan.qmd'), proof('lem-missing', 'No target exists.'));
  const compilation = await compileProject(root, options);
  const codes = new Set(compilation.diagnostics.map((item) => item.code));
  assert.equal(compilation.ok, false);
  for (const code of ['DUPLICATE_ID', 'IMPORT_CYCLE', 'IMPORT_NOT_EXPORTED', 'PROOF_TARGET_UNKNOWN']) assert.ok(codes.has(code), code);
});

test('compiler rejects semantic dependency cycles and legacy section layout', async () => {
  const root = await project();
  await writeFile(path.join(root, 'cycle.qmd'), `${result('lem-left', 'Left.', { proofText: 'Apply @lem-right.' })}\n${result('lem-right', 'Right.', { proofText: 'Apply @lem-left.' })}`);
  await writeFile(path.join(root, 'legacy.qmd'), `::: {#lem-legacy .lemma name="Legacy" date="2026-07-13"}\n### Statement\nLegacy.\n### Proof\nOld.\n:::\n`);
  const compilation = await compileProject(root, options);
  const codes = new Set(compilation.diagnostics.map((item) => item.code));
  assert.ok(codes.has('DEPENDENCY_CYCLE'));
  assert.ok(codes.has('LEGACY_RESULT_SECTIONS'));
});

test('compiler validates result names, semantic kinds, and main-goal classes', async () => {
  const root = await project();
  const wrongKind = result('lem-wrong', 'Shape.').replace('.lemma', '.proposition');
  const noName = result('thm-main-no-name', 'Missing caption.').replace(' name="thm-main-no-name"', '');
  const unsafeId = result('lem-unsafe/path', 'Unsafe identifier.');
  const mismatchedExport = result('lem-export-mismatch', 'Mismatched export.', { extra: ' export="different-name"' });
  await writeFile(path.join(root, 'shape.qmd'), `${wrongKind}\n${noName}\n${unsafeId}\n${mismatchedExport}`);
  const compilation = await compileProject(root, options);
  const codes = new Set(compilation.diagnostics.map((item) => item.code));
  assert.ok(codes.has('ID_KIND_MISMATCH'));
  assert.ok(codes.has('RESULT_NAME_MISSING'));
  assert.ok(codes.has('INVALID_SEMANTIC_ID'));
  assert.ok(codes.has('EXPORT_ID_MISMATCH'));
});

test('compiler enforces introduction dates and record-backed marker placement', async () => {
  const root = await project();
  const missingDate = result('lem-date-missing', 'Missing date.').replace(' date="2026-07-13"', '');
  const invalidDate = result('lem-date-invalid', 'Invalid date.').replace('2026-07-13', '2026-02-30');
  const misplacedDefinition = result('def-marker-position', 'VERIFIED\n\nA construction.');
  const unsupportedRejected = result('lem-rejected-marker', 'A claim.', { proofText: 'REJECTED\n\nA failed proof.' });
  await writeFile(path.join(root, 'shape-details.qmd'), [missingDate, invalidDate, misplacedDefinition, unsupportedRejected].join('\n'));
  const compilation = await compileProject(root, options);
  const codes = new Set(compilation.diagnostics.map((item) => item.code));
  for (const code of ['RESULT_DATE_MISSING', 'RESULT_DATE_INVALID', 'DEFINITION_MARKER_POSITION', 'REJECTED_RECORD_INVALID']) assert.ok(codes.has(code), code);
  assert.equal(must(compilation.manifest.results.find((item) => item.id === 'def-marker-position')).status, 'candidate');
  assert.equal(must(compilation.manifest.results.find((item) => item.id === 'lem-rejected-marker')).status, 'candidate');
});

test('main statement and name baselines are immutable', async () => {
  const root = await project();
  const file = path.join(root, 'goal.qmd');
  await writeFile(file, result('thm-main-fixed', 'Original statement.', { title: 'Fixed theorem' }));
  assert.equal((await compileProject(root, options)).ok, true);
  await writeFile(file, result('thm-main-fixed', 'Changed statement.', { title: 'Changed theorem' }));
  const changed = await compileProject(root, options);
  const codes = new Set(changed.diagnostics.map((item) => item.code));
  assert.ok(codes.has('MAIN_STATEMENT_MUTATED'));
  assert.ok(codes.has('MAIN_TITLE_MUTATED'));
});

test('complete snapshot identities change with exact mathematical content', async () => {
  const root = await project();
  const file = path.join(root, 'fact.qmd');
  await writeFile(file, result('lem-snapshot-identity', 'First statement.'));
  const first = await compileProject(root, options);
  await writeFile(file, result('lem-snapshot-identity', 'Second statement.'));
  const second = await compileProject(root, options);
  assert.notEqual(first.graph.snapshot_id, second.graph.snapshot_id);
  assert.equal((await readJson<{ snapshot_id: string }>(path.join(root, '.qmd-prover', 'graphs', 'latest.json'))).snapshot_id, second.graph.snapshot_id);
});

test('definitions declare construction dependencies and unresolved graph edges retain failed checks', async () => {
  const root = await project();
  await writeFile(path.join(root, 'definitions.qmd'), [
    result('def-base', 'A base object.'),
    result('def-derived', 'Construct the derived object from @def-base.'),
    result('lem-broken', 'A broken claim.', { proofText: 'Apply @lem-absent.' })
  ].join('\n'));
  const compilation = await compileProject(root, options);
  const derived = compilation.manifest.results.find((item) => item.id === 'def-derived');
  const brokenEdge = compilation.graph.edges.find((edge) => edge.from === 'lem-broken');
  assert.deepEqual(must(derived).dependencies, ['def-base']);
  assert.equal(must(brokenEdge).to, 'lem-absent');
  assert.equal(must(must(brokenEdge).checks).existence, 'fail');
  assert.equal(must(compilation.graph.nodes.find((node) => node.id === 'lem-absent')).status, 'missing');
  assert.ok(compilation.diagnostics.some((item) => item.code === 'DEPENDENCY_UNKNOWN' && item.id === 'lem-broken'));
});

test('inspector supports fact, path, search, and lowest-frontier queries on a named snapshot', async () => {
  const root = await project();
  await writeFile(path.join(root, 'goal.qmd'), result('thm-main-frontier', 'The final claim.'));
  const created = await initializeWorkspace(root, '@thm-main-frontier', options);
  const workspace = path.join(root, created.workspace);
  await mkdir(path.join(workspace, 'foundations'));
  await writeFile(path.join(workspace, 'foundations', 'base.qmd'), result('lem-frontier-base', 'The base obligation.', { title: 'Base frontier fact', exported: true }));
  await writeFile(path.join(workspace, 'route.qmd'), document(
    [{ from: 'foundations/base.qmd', use: ['lem-frontier-base'] }],
    `${result('lem-frontier-middle', 'The middle claim.', { proofText: 'Use @lem-frontier-base.' })}\n${proof('thm-main-frontier', 'Use @lem-frontier-middle.')}`
  ));
  const projectInspection = await inspectProject(root, options);
  assert.equal(projectInspection.ok, false);
  assert.equal(projectInspection.snapshot_published, true);
  const factInspection = await inspectFact(root, '@thm-main-frontier', options);
  assert.deepEqual(factInspection.graph.nodes.map((node) => node.id).sort(), ['lem-frontier-base', 'lem-frontier-middle', 'thm-main-frontier']);
  const pathInspection = await inspectPath(root, path.relative(root, path.join(workspace, 'route.qmd')), options);
  assert.equal(must(pathInspection.graph.nodes.find((node) => node.id === 'lem-frontier-base')).scope, 'external');
  const frontier = await analyzeDependencies(root, 'frontier', ['@thm-main-frontier'], options);
  assert.deepEqual(must(frontier.frontier).map((item) => item.fact.id), ['lem-frontier-base']);
  assert.deepEqual(must(must(frontier.frontier)[0]).path, ['thm-main-frontier', 'lem-frontier-middle', 'lem-frontier-base']);
  const dependencies = await analyzeDependencies(root, 'dependencies', ['@thm-main-frontier'], options);
  assert.deepEqual(must(dependencies.direct).map((item) => item.id), ['lem-frontier-middle']);
  assert.deepEqual(must(dependencies.transitive).map((item) => item.id).sort(), ['lem-frontier-base', 'lem-frontier-middle']);
  const reverse = await analyzeDependencies(root, 'reverse-dependencies', ['@lem-frontier-base'], options);
  assert.deepEqual(must(reverse.transitive).map((item) => item.id).sort(), ['lem-frontier-middle', 'thm-main-frontier']);
  assert.deepEqual((await analyzeDependencies(root, 'path', ['@thm-main-frontier', '@lem-frontier-base'], options)).path, ['thm-main-frontier', 'lem-frontier-middle', 'lem-frontier-base']);
  assert.deepEqual((await analyzeDependencies(root, 'cycles', [], options)).cycles, []);
  const search = await analyzeDependencies(root, 'search', ['base frontier'], { ...options, kind: 'lemma' });
  assert.deepEqual(must(search.matches).map((item) => item.id), ['lem-frontier-base']);
  assert.equal(search.snapshot_id, projectInspection.snapshot_id);
});

test('dependency findings expose unused declarations, reachability, reuse, and deterministic alternative paths', async () => {
  const root = await project();
  await writeFile(path.join(root, 'main.qmd'), result('thm-main-paths', 'Both routes reach the goal.'));
  const created = await initializeWorkspace(root, '@thm-main-paths', options);
  const workspace = path.join(root, created.workspace);
  await writeFile(path.join(workspace, 'foundations.qmd'), [
    result('def-path-base', 'A base construction.', { exported: true }),
    result('lem-unused-export', 'An unused exported fact.', { exported: true }),
    result('lem-never-imported', 'An export no file imports.', { exported: true }),
    result('lem-isolated', 'An isolated fact.')
  ].join('\n'));
  await writeFile(path.join(workspace, 'goal.qmd'), document(
    [{ from: 'foundations.qmd', use: ['def-path-base', 'lem-unused-export'] }],
    [
      result('lem-path-left', 'The left route.', { proofText: 'Use @def-path-base.' }),
      result('lem-path-right', 'The right route.', { proofText: 'Use @def-path-base.' }),
      proof('thm-main-paths', 'Use @lem-path-left and @lem-path-right.')
    ].join('\n')
  ));
  await writeFile(path.join(workspace, 'invalid-metadata.qmd'), document(
    [{ from: 'missing.qmd', use: ['lem-missing-export'] }],
    result('def-file-error', 'A candidate blocked by a file-level error.')
  ));
  const findings = must((await analyzeDependencies(root, 'findings', [], options)).findings);
  assert.deepEqual(findings.unused_imports.map((item) => item.id), ['lem-unused-export']);
  assert.deepEqual(findings.unused_exports.map((item) => item.id), ['lem-never-imported']);
  assert.ok(findings.isolated_facts.some((item) => item.id === 'lem-isolated'));
  assert.ok(findings.unreachable.facts.some((item) => item.id === 'lem-isolated'));
  assert.equal(findings.heavily_reused[0].fact.id, 'def-path-base');
  assert.equal(findings.heavily_reused[0].transitive_dependents, 3);
  assert.ok(!findings.candidate_ready_for_ai.some((item) => item.id === 'def-file-error'));
  const paths = await analyzeDependencies(root, 'alternative-paths', ['@thm-main-paths', '@def-path-base'], options);
  assert.deepEqual(paths.paths, [
    ['thm-main-paths', 'lem-path-left', 'def-path-base'],
    ['thm-main-paths', 'lem-path-right', 'def-path-base']
  ]);
});
