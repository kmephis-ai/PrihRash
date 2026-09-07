import test from 'node:test';
import assert from 'node:assert/strict';
import { IncrementalSemanticTransitionError } from '../../dist/migration/incrementalSemanticTransition.js';
import {
  create, id, outcome, previous, revise, revision, runPlan, touch, transaction,
} from './incremental-semantic-transition-fixtures.mjs';

for (const [name, invoke, code] of [
  [
    'missing previous semantic evidence',
    () => runPlan(
      [touch(id(60), 60)],
      [outcome({ currentRowHint: 60, sourceRecordId: id(60), lineageKind: 'TOUCH', classification: 'NON_FINANCIAL', projection: { status: 'NOT_EVALUATED', reason: 'TOUCH_NO_REVISION' } })],
    ),
    'MISSING_PREVIOUS_SEMANTIC_EVIDENCE',
  ],
  [
    'malformed previous transaction link',
    () => runPlan(
      [touch(id(61), 61)],
      [outcome({ currentRowHint: 61, sourceRecordId: id(61), lineageKind: 'TOUCH', classification: 'NON_FINANCIAL', projection: { status: 'NOT_EVALUATED', reason: 'TOUCH_NO_REVISION' } })],
      [],
      [previous(id(61), 'NON_FINANCIAL', 'not-a-uuid', 1)],
    ),
    'INVALID_PREVIOUS_TRANSACTION_LINK',
  ],
  [
    'revision metadata mismatch',
    () => runPlan(
      [revise(id(62), 62)],
      [outcome({ currentRowHint: 62, sourceRecordId: id(62), lineageKind: 'REVISE', classification: 'FINANCIAL_RECORD', projection: { status: 'CANDIDATE', transaction: transaction() } })],
      [revision(id(62), 999, 'OWNER_CORRECTION')],
      [previous(id(62), 'FINANCIAL_RECORD', id(162), 1)],
    ),
    'REVISION_INTENT_MISMATCH',
  ],
  [
    'invalid revised change class runtime value',
    () => runPlan(
      [revise(id(63), 63)],
      [outcome({ currentRowHint: 63, sourceRecordId: id(63), lineageKind: 'REVISE', classification: 'FINANCIAL_RECORD', projection: { status: 'CANDIDATE', transaction: transaction() } })],
      [revision(id(63), 63, 'NO_CHANGE')],
      [previous(id(63), 'FINANCIAL_RECORD', id(163), 1)],
    ),
    'INVALID_REVISED_CHANGE_CLASS',
  ],
  [
    'observation source identity mismatch',
    () => runPlan(
      [create(id(64), 64)],
      [outcome({ currentRowHint: 64, sourceRecordId: id(999), lineageKind: 'CREATE', classification: 'NON_FINANCIAL' })],
    ),
    'OBSERVATION_INTENT_MISMATCH',
  ],
  [
    'unresolved evidence mismatch',
    () => runPlan(
      [],
      [outcome({ currentRowHint: 65, sourceRecordId: null, lineageKind: 'UNRESOLVED', classification: 'AMBIGUOUS' })],
    ),
    'UNRESOLVED_OBSERVATION_MISMATCH',
  ],
]) {
  test(`fails closed for ${name}`, () => {
    assert.throws(
      invoke,
      (error) => error instanceof IncrementalSemanticTransitionError && error.code === code,
    );
  });
}
