import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySourceRevisionChange } from '../../dist/migration/changeClassification.js';

const base = {
  operationType: 'Расход',
  sourceDate: '2026-09-06',
  expenseAccount: 'Карта Credit',
  expenseCategory: 'Synthetic category',
  expenseAmountMinor: 120000,
  incomeAccount: null,
  incomeCategory: null,
  incomeAmountMinor: null,
  description: 'Synthetic description',
  vikaFlag: 'Да',
  note: null,
};

const noContext = {
  preCloseObservationProven: false,
  inJustClosedWorkingSetProven: false,
  closeClusterDetected: false,
  observedAfterClose: false,
  batchCleanupPatternConfirmed: false,
};

const fullContext = {
  preCloseObservationProven: true,
  inJustClosedWorkingSetProven: true,
  closeClusterDetected: true,
  observedAfterClose: true,
  batchCleanupPatternConfirmed: true,
};

test('same revision is NO_CHANGE', () => {
  assert.deepEqual(classifySourceRevisionChange(base, { ...base }, noContext), {
    changeClass: 'NO_CHANGE',
    changedFields: [],
    preservePreviousFields: [],
  });
});

test('Credit→Visa before close evidence is OWNER_CORRECTION', () => {
  const result = classifySourceRevisionChange(
    base,
    { ...base, expenseAccount: 'Карта Visa' },
    noContext,
  );
  assert.equal(result.changeClass, 'OWNER_CORRECTION');
  assert.deepEqual(result.preservePreviousFields, []);
});

test('Credit→Visa with full proven close context is WORKFLOW_TRANSFORM', () => {
  const result = classifySourceRevisionChange(
    base,
    { ...base, expenseAccount: 'Карта Visa' },
    fullContext,
  );
  assert.equal(result.changeClass, 'WORKFLOW_TRANSFORM');
  assert.deepEqual(result.preservePreviousFields, ['expenseAccount']);
});

test('Cash→Visa with full proven close context is WORKFLOW_TRANSFORM', () => {
  const previous = { ...base, expenseAccount: 'Наличка', vikaFlag: null };
  const result = classifySourceRevisionChange(
    previous,
    { ...previous, expenseAccount: 'Карта Visa' },
    fullContext,
  );
  assert.equal(result.changeClass, 'WORKFLOW_TRANSFORM');
  assert.deepEqual(result.preservePreviousFields, ['expenseAccount']);
});

test('Vika Да→blank with full proven close context preserves observed member fact', () => {
  const previous = { ...base, expenseAccount: 'Наличка' };
  const result = classifySourceRevisionChange(
    previous,
    { ...previous, vikaFlag: null },
    fullContext,
  );
  assert.equal(result.changeClass, 'WORKFLOW_TRANSFORM');
  assert.deepEqual(result.preservePreviousFields, ['vikaFlag']);
});

test('account and Vika cleanup may be one proven workflow transform', () => {
  const result = classifySourceRevisionChange(
    base,
    { ...base, expenseAccount: 'Карта Visa', vikaFlag: null },
    fullContext,
  );
  assert.equal(result.changeClass, 'WORKFLOW_TRANSFORM');
  assert.deepEqual(result.preservePreviousFields, ['expenseAccount', 'vikaFlag']);
});

test('partial close evidence makes cleanup-like transition AMBIGUOUS_CHANGE', () => {
  const result = classifySourceRevisionChange(
    base,
    { ...base, expenseAccount: 'Карта Visa' },
    { ...noContext, closeClusterDetected: true },
  );
  assert.equal(result.changeClass, 'AMBIGUOUS_CHANGE');
});

test('missing pre-close observation blocks sticky preservation', () => {
  const result = classifySourceRevisionChange(
    base,
    { ...base, vikaFlag: null },
    { ...fullContext, preCloseObservationProven: false },
  );
  assert.equal(result.changeClass, 'AMBIGUOUS_CHANGE');
  assert.deepEqual(result.preservePreviousFields, []);
});

test('mixed cleanup plus ordinary correction during close context is AMBIGUOUS_CHANGE', () => {
  const result = classifySourceRevisionChange(
    base,
    { ...base, expenseAccount: 'Карта Visa', expenseAmountMinor: 125000 },
    fullContext,
  );
  assert.equal(result.changeClass, 'AMBIGUOUS_CHANGE');
});

test('ordinary positive amount correction remains OWNER_CORRECTION', () => {
  const result = classifySourceRevisionChange(
    base,
    { ...base, expenseAmountMinor: 125000 },
    fullContext,
  );
  assert.equal(result.changeClass, 'OWNER_CORRECTION');
});

test('ordinary category/date/description/note correction remains OWNER_CORRECTION', () => {
  const result = classifySourceRevisionChange(
    base,
    {
      ...base,
      sourceDate: '2026-09-05',
      expenseCategory: 'Synthetic corrected category',
      description: 'Synthetic corrected description',
      note: 'Synthetic note',
    },
    noContext,
  );
  assert.equal(result.changeClass, 'OWNER_CORRECTION');
});

test('unsupported account direction is not invented as workflow cleanup', () => {
  const result = classifySourceRevisionChange(
    { ...base, expenseAccount: 'Карта Visa' },
    { ...base, expenseAccount: 'Карта Credit' },
    fullContext,
  );
  assert.equal(result.changeClass, 'OWNER_CORRECTION');
});

test('blank→Vika is an owner correction, never reverse cleanup', () => {
  const previous = { ...base, vikaFlag: null };
  const result = classifySourceRevisionChange(
    previous,
    { ...previous, vikaFlag: 'Да' },
    fullContext,
  );
  assert.equal(result.changeClass, 'OWNER_CORRECTION');
});

test('EXPENSE→INCOME is structurally ambiguous', () => {
  const result = classifySourceRevisionChange(
    base,
    { ...base, operationType: 'Доход' },
    noContext,
  );
  assert.equal(result.changeClass, 'AMBIGUOUS_CHANGE');
});

test('positive expense amount→zero is structurally ambiguous', () => {
  const result = classifySourceRevisionChange(
    base,
    { ...base, expenseAmountMinor: 0 },
    noContext,
  );
  assert.equal(result.changeClass, 'AMBIGUOUS_CHANGE');
});
