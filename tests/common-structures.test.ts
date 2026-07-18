import assert from 'node:assert/strict';
import test from 'node:test';
import {
  asErrorLike, CONTROL_MARKERS, errorMessage, hasErrorCode, indexBy, isControlMarker,
  KIND_BY_PREFIX, pushToMap, SEMANTIC_ID_PATTERN, uniqueSorted
} from '../skills/qmd-prover/src/core/shared/core.js';
import { stableJson } from '../skills/qmd-prover/src/core/infrastructure/files.js';
import { factStatus } from '../skills/qmd-prover/src/core/semantic/compiler.js';
import type { SemanticResult } from '../skills/qmd-prover/src/core/semantic/model.js';

test('shared semantic constants keep IDs, result kinds, and protected markers aligned', () => {
  assert.deepEqual(CONTROL_MARKERS, ['OPEN', 'REJECTED', 'DISPROVED', 'VERIFIED', 'REVOKED']);
  assert.equal(isControlMarker('DISPROVED'), true);
  assert.equal(isControlMarker('VERIFIED'), true);
  assert.equal(isControlMarker('disproof-candidate'), false);
  assert.equal(SEMANTIC_ID_PATTERN.test('thm-main-uniform-index'), true);
  assert.equal(SEMANTIC_ID_PATTERN.test('theorem-uniform-index'), false);
  assert.deepEqual(KIND_BY_PREFIX, {
    def: 'definition', lem: 'lemma', thm: 'theorem', prp: 'proposition', cor: 'corollary'
  });
  assert.equal(factStatus({ kind: 'lemma', proof_present: true } as SemanticResult, 'DISPROVED'), 'disproof-candidate');
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
