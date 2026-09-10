import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createPreviewExpenseEditController,
  createSyntheticPreviewExpenseEditPorts,
  previewExpenseEditContract,
} from '../../web/preview-expense-edit.mjs';
import { syntheticPreviewEvidence } from '../../web/preview-transport.mjs';

const TX_ID = '40000000-0000-0000-0000-000000000001';
const ACCOUNT_ID = syntheticPreviewEvidence.accounts[0].id;
const OTHER_ACCOUNT_ID = syntheticPreviewEvidence.accounts[1].id;
const CATEGORY_ID = syntheticPreviewEvidence.categories.find((item) => item.kind === 'EXPENSE').id;
const OTHER_CATEGORY_ID = syntheticPreviewEvidence.categories.filter((item) => item.kind === 'EXPENSE')[1].id;
const MEMBER = syntheticPreviewEvidence.operations.find((item) => item.paidByMember !== null).paidByMember;
const MEMBER_ID = MEMBER.id;
const REFERENCES = Object.freeze({
  accounts: syntheticPreviewEvidence.accounts,
  categories: syntheticPreviewEvidence.categories,
  members: Object.freeze([MEMBER]),
});

function transaction(overrides = {}) {
  return Object.freeze({
    type: 'EXPENSE',
    occurredOn: '2026-09-08',
    recordGranularity: 'TRANSACTION',
    datePrecision: 'DAY',
    aggregatePeriodMonth: null,
    financialPeriodId: null,
    periodAssignmentQuality: 'UNASSIGNED',
    amountMinor: 428750,
    currency: 'RUB',
    fromAccountId: ACCOUNT_ID,
    toAccountId: null,
    categoryId: CATEGORY_ID,
    paidByMemberId: MEMBER_ID,
    description: 'Синтетический расход',
    note: null,
    status: 'POSTED',
    analyticsState: 'INCLUDED',
    flowKind: null,
    ...overrides,
  });
}

function versioned({ id = TX_ID, version = 1, tx = transaction() } = {}) {
  return Object.freeze({ id, version, transaction: tx });
}

function dependencies({ submit, read, initial = versioned() } = {}) {
  const calls = { submit: [], read: [] };
  return {
    calls,
    controller: createPreviewExpenseEditController({
      initial,
      references: REFERENCES,
      submitExpenseEdit: submit ?? (async (request) => {
        calls.submit.push(request);
        return Object.freeze({ apiVersion: 1, outcome: 'UPDATED', transactionId: TX_ID, version: request.expectedVersion + 1 });
      }),
      readCurrentExpense: read ?? (async (id) => {
        calls.read.push(id);
        return versioned({ version: 2 });
      }),
    }),
  };
}

function makeConflictCurrent(version = 2, overrides = {}) {
  return versioned({
    version,
    tx: transaction({
      occurredOn: '2026-09-09',
      amountMinor: 500000,
      fromAccountId: OTHER_ACCOUNT_ID,
      categoryId: OTHER_CATEGORY_ID,
      paidByMemberId: null,
      description: 'Актуальная синтетическая версия',
      note: 'Изменено в другом окне',
      ...overrides,
    }),
  });
}

test('R3A preview edit initializes from exact ordinary EXPENSE and exposes exact editable field set', () => {
  const { controller } = dependencies();
  const state = controller.getState();
  assert.equal(state.status, 'READY');
  assert.equal(state.transactionId, TX_ID);
  assert.equal(state.expectedVersion, 1);
  assert.equal(state.values.amount, '4287,50');
  assert.equal(state.values.paidByMemberId, MEMBER_ID);
  assert.deepEqual(previewExpenseEditContract.editableFields, [
    'occurredOn', 'amount', 'fromAccountId', 'categoryId', 'paidByMemberId', 'description', 'note',
  ]);
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.values));
});

test('R3A preview edit sends one immutable full request and promotes version only on exact UPDATED ACK', async () => {
  const requests = [];
  const { controller } = dependencies({
    submit: async (request) => {
      requests.push(request);
      return Object.freeze({ apiVersion: 1, outcome: 'UPDATED', transactionId: TX_ID, version: 2 });
    },
  });
  controller.updateValue('amount', '123,45');
  controller.updateValue('paidByMemberId', null);
  controller.updateValue('description', 'Мои изменения');
  const state = await controller.save();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    transactionId: TX_ID,
    expectedVersion: 1,
    occurredOn: '2026-09-08',
    amountMinor: 12345,
    currency: 'RUB',
    fromAccountId: ACCOUNT_ID,
    categoryId: CATEGORY_ID,
    paidByMemberId: null,
    description: 'Мои изменения',
    note: null,
  });
  assert.ok(Object.isFrozen(requests[0]));
  assert.equal(state.status, 'UPDATED');
  assert.equal(state.expectedVersion, 2);
  assert.equal(state.conflict, null);
});

test('VERSION_CONFLICT triggers exactly one current-read and never auto-resubmits', async () => {
  const calls = { submit: 0, read: 0 };
  const current = makeConflictCurrent();
  const controller = createPreviewExpenseEditController({
    initial: versioned(),
    references: REFERENCES,
    submitExpenseEdit: async () => {
      calls.submit += 1;
      return Object.freeze({ apiVersion: 1, outcome: 'VERSION_CONFLICT', transactionId: TX_ID, currentVersion: 2 });
    },
    readCurrentExpense: async () => {
      calls.read += 1;
      return current;
    },
  });
  controller.updateValue('amount', '123,45');
  const state = await controller.save();
  assert.equal(calls.submit, 1);
  assert.equal(calls.read, 1);
  assert.equal(state.status, 'CONFLICT');
  assert.equal(state.expectedVersion, 1);
  assert.match(state.message, /Ничего не перезаписано/u);
});

test('conflict state preserves local values and exposes exact current values for all editable fields', async () => {
  const current = makeConflictCurrent();
  const controller = createPreviewExpenseEditController({
    initial: versioned(),
    references: REFERENCES,
    submitExpenseEdit: async () => Object.freeze({ apiVersion: 1, outcome: 'VERSION_CONFLICT', transactionId: TX_ID, currentVersion: 2 }),
    readCurrentExpense: async () => current,
  });
  controller.updateValue('amount', '123,45');
  controller.updateValue('description', 'Мои синтетические изменения');
  const state = await controller.save();
  assert.equal(state.conflict.currentVersion, 2);
  assert.equal(state.conflict.localValues.amount, '123,45');
  assert.equal(state.conflict.localValues.description, 'Мои синтетические изменения');
  assert.deepEqual(state.conflict.currentValues, {
    occurredOn: '2026-09-09',
    amount: '5000,00',
    fromAccountId: OTHER_ACCOUNT_ID,
    categoryId: OTHER_CATEGORY_ID,
    paidByMemberId: null,
    description: 'Актуальная синтетическая версия',
    note: 'Изменено в другом окне',
  });
});

test('explicit accept current replaces form values and baseline version without submit', async () => {
  let submitCalls = 0;
  const controller = createPreviewExpenseEditController({
    initial: versioned(),
    references: REFERENCES,
    submitExpenseEdit: async () => {
      submitCalls += 1;
      return Object.freeze({ apiVersion: 1, outcome: 'VERSION_CONFLICT', transactionId: TX_ID, currentVersion: 2 });
    },
    readCurrentExpense: async () => makeConflictCurrent(),
  });
  controller.updateValue('amount', '123,45');
  await controller.save();
  const accepted = controller.acceptCurrent();
  assert.equal(submitCalls, 1);
  assert.equal(accepted.status, 'READY');
  assert.equal(accepted.expectedVersion, 2);
  assert.equal(accepted.values.amount, '5000,00');
  assert.equal(accepted.conflict, null);
});

test('explicit keep-mine rebases expectedVersion only and does not submit again', async () => {
  let submitCalls = 0;
  const controller = createPreviewExpenseEditController({
    initial: versioned(),
    references: REFERENCES,
    submitExpenseEdit: async () => {
      submitCalls += 1;
      return Object.freeze({ apiVersion: 1, outcome: 'VERSION_CONFLICT', transactionId: TX_ID, currentVersion: 2 });
    },
    readCurrentExpense: async () => makeConflictCurrent(),
  });
  controller.updateValue('amount', '123,45');
  controller.updateValue('description', 'Мои синтетические изменения');
  await controller.save();
  const rebased = controller.keepMineOnCurrent();
  assert.equal(submitCalls, 1);
  assert.equal(rebased.expectedVersion, 2);
  assert.equal(rebased.values.amount, '123,45');
  assert.equal(rebased.values.description, 'Мои синтетические изменения');
  assert.match(rebased.message, /Нажмите «Сохранить изменения» ещё раз/u);
});

test('after explicit keep-mine, a second user save is a new request with the rebased version', async () => {
  const requests = [];
  let first = true;
  const controller = createPreviewExpenseEditController({
    initial: versioned(),
    references: REFERENCES,
    submitExpenseEdit: async (request) => {
      requests.push(request);
      if (first) {
        first = false;
        return Object.freeze({ apiVersion: 1, outcome: 'VERSION_CONFLICT', transactionId: TX_ID, currentVersion: 2 });
      }
      return Object.freeze({ apiVersion: 1, outcome: 'UPDATED', transactionId: TX_ID, version: 3 });
    },
    readCurrentExpense: async () => makeConflictCurrent(),
  });
  controller.updateValue('amount', '123,45');
  await controller.save();
  controller.keepMineOnCurrent();
  assert.equal(requests.length, 1);
  const state = await controller.save();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].expectedVersion, 2);
  assert.equal(state.expectedVersion, 3);
  assert.equal(state.status, 'UPDATED');
});

test('mismatched current transaction id after conflict fails closed and preserves local form', async () => {
  const bad = createPreviewExpenseEditController({
    initial: versioned(),
    references: REFERENCES,
    submitExpenseEdit: async () => Object.freeze({ apiVersion: 1, outcome: 'VERSION_CONFLICT', transactionId: TX_ID, currentVersion: 2 }),
    readCurrentExpense: async () => versioned({ id: '40000000-0000-0000-0000-000000000009', version: 2 }),
  });
  bad.updateValue('amount', '123,45');
  const state = await bad.save();
  assert.equal(state.status, 'DEGRADED');
  assert.equal(state.values.amount, '123,45');
  assert.equal(state.conflict, null);
});

test('mismatched current version after conflict fails closed with no rebase', async () => {
  const controller = createPreviewExpenseEditController({
    initial: versioned(),
    references: REFERENCES,
    submitExpenseEdit: async () => Object.freeze({ apiVersion: 1, outcome: 'VERSION_CONFLICT', transactionId: TX_ID, currentVersion: 2 }),
    readCurrentExpense: async () => makeConflictCurrent(3),
  });
  controller.updateValue('amount', '123,45');
  const state = await controller.save();
  assert.equal(state.status, 'DEGRADED');
  assert.equal(state.expectedVersion, 1);
  assert.equal(state.values.amount, '123,45');
});

test('coarse, VOIDED and non-EXPENSE initial evidence fail closed', () => {
  for (const tx of [
    transaction({ recordGranularity: 'PERIOD_AGGREGATE', datePrecision: 'MONTH', aggregatePeriodMonth: '2026-09-01' }),
    transaction({ status: 'VOIDED' }),
    transaction({ type: 'INCOME', fromAccountId: null, toAccountId: ACCOUNT_ID }),
  ]) {
    assert.throws(() => dependencies({ initial: versioned({ tx }) }), /PREVIEW_EXPENSE_EDIT_EVIDENCE_INVALID/u);
  }
});

test('unknown current references fail closed rather than guessing labels', async () => {
  const unknown = '10000000-0000-0000-0000-000000000099';
  const controller = createPreviewExpenseEditController({
    initial: versioned(),
    references: REFERENCES,
    submitExpenseEdit: async () => Object.freeze({ apiVersion: 1, outcome: 'VERSION_CONFLICT', transactionId: TX_ID, currentVersion: 2 }),
    readCurrentExpense: async () => makeConflictCurrent(2, { fromAccountId: unknown }),
  });
  controller.updateValue('amount', '123,45');
  const state = await controller.save();
  assert.equal(state.status, 'DEGRADED');
  assert.equal(state.values.amount, '123,45');
});

test('invalid local amount/reference/text fails before submit', async () => {
  let submits = 0;
  for (const [field, value] of [
    ['amount', '12.345'],
    ['fromAccountId', '10000000-0000-0000-0000-000000000099'],
    ['description', '  not canonical  '],
  ]) {
    const { controller } = dependencies({ submit: async () => { submits += 1; } });
    controller.updateValue(field, value);
    await assert.rejects(controller.save(), /INVALID_PREVIEW_EXPENSE_EDIT_INPUT/u);
  }
  assert.equal(submits, 0);
});

test('malformed or inconsistent public edit ACK degrades without false success/conflict', async () => {
  for (const response of [
    { apiVersion: 1, outcome: 'UPDATED', transactionId: TX_ID, version: 9 },
    { apiVersion: 1, outcome: 'VERSION_CONFLICT', transactionId: TX_ID, currentVersion: 1 },
    { apiVersion: 1, outcome: 'UPDATED', transactionId: TX_ID, version: 2, transaction: {} },
  ]) {
    const { controller } = dependencies({ submit: async () => response });
    controller.updateValue('amount', '123,45');
    const state = await controller.save();
    assert.equal(state.status, 'DEGRADED');
    assert.equal(state.expectedVersion, 1);
  }
});

test('default synthetic ports demonstrate one conflict and require explicit rebase before successful save', async () => {
  const initial = versioned();
  const ports = createSyntheticPreviewExpenseEditPorts(initial);
  const controller = createPreviewExpenseEditController({
    initial,
    references: REFERENCES,
    ...ports,
  });
  controller.updateValue('amount', '123,45');
  const conflict = await controller.save();
  assert.equal(conflict.status, 'CONFLICT');
  controller.keepMineOnCurrent();
  const updated = await controller.save();
  assert.equal(updated.status, 'UPDATED');
  assert.equal(updated.expectedVersion, 3);
});

test('preview edit source is preview-only, transport-neutral and keeps production Reader/PWA/SW free of edit wiring', async () => {
  const [source, bootstrap, build, productionApp, productionIndex, productionSw] = await Promise.all([
    readFile(new URL('../../web/preview-expense-edit.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../web/preview-bootstrap.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../scripts/build-r2-ui-preview.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../web/app.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../web/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../../web/sw.js', import.meta.url), 'utf8'),
  ]);
  assert.match(source, /Мои изменения/u);
  assert.match(source, /Актуальная версия/u);
  assert.match(source, /Принять актуальную версию/u);
  assert.match(source, /Оставить мои изменения поверх актуальной/u);
  assert.doesNotMatch(source, /\bfetch\s*\(|YDB|ydb|oauth|cookie|Authorization|api\/v1/u);
  assert.match(bootstrap, /preview-expense-edit\.mjs/u);
  assert.match(build, /preview-expense-edit\.mjs/u);
  for (const production of [productionApp, productionIndex, productionSw]) {
    assert.doesNotMatch(production, /preview-expense-edit|submitExpenseEdit|readCurrentExpense/u);
  }
});
