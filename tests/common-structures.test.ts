import assert from 'node:assert/strict';
import test from 'node:test';
import {
  asErrorLike, STATUS_VALUES, errorMessage, hasErrorCode, indexBy,
  KIND_BY_PREFIX, pushToMap, SEMANTIC_ID_PATTERN, uniqueSorted
} from '../skills/qmd-prover/src/core/shared/core.js';
import { stableJson } from '../skills/qmd-prover/src/core/infrastructure/files.js';
import { factStatus } from '../skills/qmd-prover/src/core/semantic/compiler.js';
import type { SemanticResult } from '../skills/qmd-prover/src/core/semantic/model.js';

test('shared semantic constants keep IDs, result kinds, and status vocabulary aligned', () => {
  assert.deepEqual(STATUS_VALUES, ['verified', 'rejected']);
  assert.equal(SEMANTIC_ID_PATTERN.test('thm-main-uniform-index'), true);
  assert.equal(SEMANTIC_ID_PATTERN.test('theorem-uniform-index'), false);
  assert.deepEqual(KIND_BY_PREFIX, {
    def: 'definition', lem: 'lemma', thm: 'theorem', prp: 'proposition', cor: 'corollary'
  });
  // A refutation proof that is present but unverified is a disproof-candidate.
  assert.equal(factStatus({ kind: 'lemma', proof_present: true, refutation: true, abandon: false } as SemanticResult), 'disproof-candidate');
  assert.equal(factStatus({ kind: 'lemma', proof_present: true, refutation: false, abandon: false } as SemanticResult), 'candidate');
  assert.equal(factStatus({ kind: 'lemma', proof_present: false, refutation: false, abandon: false } as SemanticResult), 'open');
  assert.equal(factStatus({ kind: 'lemma', proof_present: true, refutation: false, abandon: true } as SemanticResult), 'abandoned');
});

test('shared collection and error helpers preserve deterministic runtime behavior', () => {
  assert.deepEqual(uniqueSorted(['b', 'a', 'b']), ['a', 'b']);
  assert.equal(indexBy([{ id: 'a', value: 1 }], (item) => item.id).get('a')?.value, 1);
  const grouped = new Map<string, number[]>();
  pushToMap(grouped, 'x', 1);
  pushToMap(grouped, 'x', 2);
  assert.deepEqual(grouped.get('x'), [1, 2]);
  assert.equal(stableJson({ b: 2, a: 1 }, 0), '{"a":1,"b":2}\n');

  const failure = Object.assign(new Error('missing'), { code: 'ENOENT' });
  assert.equal(errorMessage(failure), 'missing');
  assert.equal(hasErrorCode(failure, 'ENOENT'), true);
  assert.deepEqual(asErrorLike('failure'), { message: 'failure' });
});
