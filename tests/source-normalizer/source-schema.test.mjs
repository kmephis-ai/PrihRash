import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPECTED_SOURCE_HEADERS,
  recognizeOperationType,
  verifySourceHeaders,
} from '../../dist/integration/google/sourceSchema.js';

test('exact current A-K header passes with the proven timestamp label', () => {
  assert.deepEqual(verifySourceHeaders([...EXPECTED_SOURCE_HEADERS]), {
    ok: true,
    errorCode: null,
    mismatches: [],
  });
});

test('previous v2 first header fails closed instead of acting as an alias', () => {
  const headers = [...EXPECTED_SOURCE_HEADERS];
  headers[0] = ' Дата';
  const result = verifySourceHeaders(headers);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'SOURCE_SCHEMA_MISMATCH');
  assert.deepEqual(result.mismatches[0], {
    position: 1,
    expected: 'Отметка времени',
    actual: ' Дата',
  });
});

test('duplicate physical headers are position-sensitive', () => {
  const headers = [...EXPECTED_SOURCE_HEADERS];
  [headers[2], headers[6]] = [headers[6], headers[2]];
  assert.equal(verifySourceHeaders(headers).ok, true);
});

test('operation type recognition is explicit and does not guess aliases', () => {
  assert.equal(recognizeOperationType('Расход'), 'EXPENSE');
  assert.equal(recognizeOperationType('Доход'), 'INCOME');
  assert.equal(recognizeOperationType('расход'), null);
  assert.equal(recognizeOperationType('TRANSFER'), null);
  assert.equal(recognizeOperationType(null), null);
});
