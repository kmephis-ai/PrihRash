import assert from 'node:assert/strict';
import { access, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { createSyntheticPreviewFetch, syntheticPreviewEvidence } from '../../web/preview-transport.mjs';
import { sanitizeReaderResponse, toOperationPresentation } from '../../web/presentation.mjs';
import { sanitizeReaderFilterOptions } from '../../web/reader-filters.mjs';
import { sanitizeReaderSyncStatus } from '../../web/reader-sync-status.mjs';
import {
  createPreviewExpenseCreateApiRequest,
  deliverPreviewExpenseIntent,
  parsePreviewExpenseCreateAck,
} from '../../web/preview-writer-delivery.mjs';
import {
  createIndexedDbPreviewDraftStore,
  createIndexedDbPreviewIncomeDraftStore,
  createIndexedDbPreviewOutbox,
  createPreviewExpenseDraft,
  createPreviewExpenseIntent,
  createPreviewIncomeDraft,
  createPreviewIncomeIntent,
  enqueuePreviewExpenseThenClearDraft,
  enqueuePreviewIncomeThenClearDraft,
  parsePreviewExpenseAmountMinor,
  parsePreviewExpenseDraft,
  parsePreviewExpenseIntent,
  parsePreviewIncomeAmountMinor,
  parsePreviewIncomeDraft,
  parsePreviewIncomeIntent,
  parsePreviewIntent,
  previewOutboxContract,
  restorePreviewExpenseDraft,
  restorePreviewIncomeDraft,
} from '../../web/preview-writer-outbox.mjs';

function createTransport() {
  const outbound = [];
  const nativeFetch = async (input) => {
    outbound.push(String(input));
    return new Response('static');
  };
  return { outbound, fetch: createSyntheticPreviewFetch({ nativeFetch, baseUrl: 'https://preview.example/PrihRash/' }) };
}

test('synthetic preview evidence contains no private/provider data and covers current Reader UX', () => {
  assert.equal(syntheticPreviewEvidence.operations.length >= 8, true);
  assert.equal(syntheticPreviewEvidence.operations.some((item) => item.type === 'EXPENSE'), true);
  assert.equal(syntheticPreviewEvidence.operations.some((item) => item.type === 'INCOME'), true);
  assert.equal(syntheticPreviewEvidence.operations.some((item) => item.type === 'TRANSFER'), true);
  const ownFundsTransfer = syntheticPreviewEvidence.operations.find((item) => item.flowKind === 'OWN_FUNDS_TRANSFER');
  assert.equal(toOperationPresentation(ownFundsTransfer).typeLabel, 'Перевод · Между своими счетами');
  const withPayer = syntheticPreviewEvidence.operations.find((item) => item.paidByMember !== null);
  assert.match(toOperationPresentation(withPayer).meta, /Плательщик: Владелец · демо/u);
  assert.equal(syntheticPreviewEvidence.operations.some((item) => item.status === 'VOIDED'), true);
  const ambiguous = syntheticPreviewEvidence.operations.find((item) => item.periodAssignmentQuality === 'LEGACY_AMBIGUOUS');
  assert.equal(ambiguous?.recordGranularity, 'PERIOD_AGGREGATE');
  assert.equal(ambiguous?.datePrecision, 'MONTH');
  assert.equal(ambiguous?.aggregatePeriodMonth, '2024-11-01');
  assert.equal(toOperationPresentation(ambiguous).dateLabel, '2024-11');
  assert.equal(ambiguous?.capturedAt, null);
  assert.equal(toOperationPresentation(ambiguous).quality.includes('Расчётный период неоднозначен'), true);
  assert.equal(syntheticPreviewEvidence.operations.some((item) => item.note?.includes('https://example.invalid/')), true);
  assert.equal(JSON.stringify(syntheticPreviewEvidence).includes('mepnet'), false);
  assert.equal(JSON.stringify(syntheticPreviewEvidence).includes('89.125.'), false);
});

test('preview serves valid Reader v1 responses and never sends API requests to native network', async () => {
  const transport = createTransport();
  const first = await transport.fetch('/api/v1/operations/recent?limit=50');
  assert.equal(first.status, 200);
  const page = sanitizeReaderResponse(await first.json());
  assert.equal(page.items.length, syntheticPreviewEvidence.pageSize);
  assert.equal(page.nextCursor, 'demoPage_2');

  const second = await transport.fetch(`/api/v1/operations/recent?limit=50&cursor=${page.nextCursor}`);
  assert.equal(second.status, 200);
  assert.equal(sanitizeReaderResponse(await second.json()).nextCursor, null);

  const options = await transport.fetch('/api/v1/reader/filter-options');
  sanitizeReaderFilterOptions(await options.json());
  const sync = await transport.fetch('/api/v1/reader/sync-status');
  sanitizeReaderSyncStatus(await sync.json());
  assert.deepEqual(transport.outbound, []);
});

test('preview applies all four Reader filters using canonical stable ids', async () => {
  const transport = createTransport();
  const accountId = syntheticPreviewEvidence.accounts[1].id;
  const categoryId = syntheticPreviewEvidence.categories[1].id;
  const response = await transport.fetch(`/api/v1/operations/recent?limit=50&type=EXPENSE&status=POSTED&accountId=${accountId}&categoryId=${categoryId}`);
  const safe = sanitizeReaderResponse(await response.json());
  assert.equal(safe.items.length > 0, true);
  for (const item of safe.items) {
    assert.equal(item.type, 'EXPENSE');
    assert.equal(item.status, 'POSTED');
    assert.equal(item.fromAccount?.id === accountId || item.toAccount?.id === accountId, true);
    assert.equal(item.category?.id, categoryId);
  }
});

test('preview fails closed for unknown API endpoints/mutations but permits static asset fetch', async () => {
  const transport = createTransport();
  assert.equal((await transport.fetch('/api/v1/not-real')).status, 404);
  assert.equal((await transport.fetch('/api/v1/reader/sync-status', { method: 'POST' })).status, 405);
  assert.equal((await transport.fetch('./styles.css')).status, 200);
  assert.deepEqual(transport.outbound, ['./styles.css']);
});

test('preview bootstrap reuses canonical index markup instead of duplicating product UI', async () => {
  const preview = await readFile(new URL('../../web/preview.html', import.meta.url), 'utf8');
  const bootstrap = await readFile(new URL('../../web/preview-bootstrap.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(preview, /data-operations-cards/u);
  assert.match(bootstrap, /fetch\('\.\/index\.html'/u);
  assert.match(bootstrap, /document\.body\.replaceWith\(body\)/u);
  assert.match(bootstrap, /installSyntheticPreviewTransport/u);
  assert.match(bootstrap, /только синтетические данные/u);
});

test('preview build emits static root without service worker or manifest deployment coupling', async () => {
  await rm(new URL('../../.artifacts/r2-ui-preview', import.meta.url), { recursive: true, force: true });
  const result = spawnSync(process.execPath, ['scripts/build-r2-ui-preview.mjs'], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const index = await readFile(new URL('../../.artifacts/r2-ui-preview/index.html', import.meta.url), 'utf8');
  const shell = await readFile(new URL('../../.artifacts/r2-ui-preview/app-shell.html', import.meta.url), 'utf8');
  const bootstrap = await readFile(new URL('../../.artifacts/r2-ui-preview/preview-bootstrap.mjs', import.meta.url), 'utf8');
  assert.match(index, /preview-bootstrap\.mjs/u);
  assert.match(shell, /data-operations-cards/u);
  assert.match(shell, />Только чтение</u);
  assert.match(shell, /data-state class="state" role="status" aria-live="polite" aria-atomic="true"/u);
  assert.doesNotMatch(shell, /Добавить операцию|>＋</u);
  assert.match(shell, /aria-label="Главная — скоро"/u);
  assert.doesNotMatch(shell, /href="#(?:home|analytics|more)"/u);
  assert.match(bootstrap, /fetch\('\.\/app-shell\.html'/u);
  assert.match(bootstrap, /preview-writer\.mjs/u);
  await access(new URL('../../.artifacts/r2-ui-preview/preview-writer.mjs', import.meta.url));
  await access(new URL('../../.artifacts/r2-ui-preview/preview-writer-outbox.mjs', import.meta.url));
  await access(new URL('../../.artifacts/r2-ui-preview/preview-writer.css', import.meta.url));
  assert.doesNotMatch(shell, /Новый расход|data-preview-writer|Сохранить локально/u);
  assert.doesNotMatch(index, /manifest\.webmanifest/u);
  await assert.rejects(access(new URL('../../.artifacts/r2-ui-preview/manifest.webmanifest', import.meta.url)));
  await assert.rejects(access(new URL('../../.artifacts/r2-ui-preview/icons/app-192.png', import.meta.url)));
  await assert.rejects(access(new URL('../../.artifacts/r2-ui-preview/icons/app-512.png', import.meta.url)));
});


function createPreviewWriterFakeIndexedDb({ version = 0, outboxRows = [], draftRows = [] } = {}) {
  let currentVersion = version;
  const stores = new Map();
  if (version >= 1) stores.set(previewOutboxContract.storeName, new Map(outboxRows.map((row) => [row.intentId, row])));
  if (version >= 2) stores.set(previewOutboxContract.draftStoreName, new Map(draftRows.map((row) => [row.draftKey, row])));
  const createdStores = [];
  const objectStoreNames = { contains: (name) => stores.has(name) };

  function makeRequest(run, transaction) {
    const request = {};
    queueMicrotask(() => {
      try {
        request.result = run();
        request.onsuccess?.();
        queueMicrotask(() => transaction.oncomplete?.());
      } catch {
        request.onerror?.();
        queueMicrotask(() => transaction.onerror?.());
      }
    });
    return request;
  }

  const db = {
    objectStoreNames,
    createObjectStore(name, options) {
      assert.equal(stores.has(name), false);
      assert.equal(options?.keyPath, name === previewOutboxContract.storeName ? 'intentId' : 'draftKey');
      stores.set(name, new Map());
      createdStores.push(name);
    },
    close() {},
    transaction(name) {
      assert.equal(stores.has(name), true);
      const transaction = {};
      transaction.objectStore = () => {
        const rows = stores.get(name);
        const keyFor = (value) => name === previewOutboxContract.storeName ? value.intentId : value.draftKey;
        return {
          add: (value) => makeRequest(() => {
            const key = keyFor(value);
            if (rows.has(key)) throw new Error('duplicate');
            rows.set(key, value);
            return key;
          }, transaction),
          put: (value) => makeRequest(() => {
            const key = keyFor(value);
            rows.set(key, value);
            return key;
          }, transaction),
          get: (key) => makeRequest(() => rows.get(key), transaction),
          getAll: () => makeRequest(() => [...rows.values()], transaction),
          delete: (key) => makeRequest(() => rows.delete(key), transaction),
        };
      };
      return transaction;
    },
  };

  return {
    indexedDb: {
      open(name, requestedVersion) {
        assert.equal(name, previewOutboxContract.dbName);
        assert.equal(requestedVersion, previewOutboxContract.dbVersion);
        const request = { result: db, oldVersion: currentVersion };
        queueMicrotask(() => {
          if (requestedVersion > currentVersion) {
            request.onupgradeneeded?.();
            currentVersion = requestedVersion;
          }
          request.onsuccess?.();
        });
        return request;
      },
    },
    createdStores,
    stores,
    version: () => currentVersion,
  };
}

function createPreviewOutboxFakeIndexedDb(initialRows = []) {
  return createPreviewWriterFakeIndexedDb({ version: 1, outboxRows: initialRows });
}

function previewExpenseInput(overrides = {}) {
  return {
    amount: '125,40',
    occurredOn: '2026-09-09',
    accountId: syntheticPreviewEvidence.accounts[0].id,
    categoryId: syntheticPreviewEvidence.categories.find((item) => item.kind === 'EXPENSE').id,
    description: 'Кофе · демо',
    note: '',
    ...overrides,
  };
}

function previewExpenseIntent(overrides = {}) {
  return createPreviewExpenseIntent(previewExpenseInput(), {
    accounts: syntheticPreviewEvidence.accounts,
    categories: syntheticPreviewEvidence.categories,
    randomUuid: () => '50000000-0000-0000-0000-000000000001',
    now: () => '2026-09-09T12:00:00.000Z',
    ...overrides,
  });
}

function previewIncomeInput(overrides = {}) {
  return {
    amount: '2500,75',
    occurredOn: '2026-09-10',
    accountId: syntheticPreviewEvidence.accounts[0].id,
    categoryId: syntheticPreviewEvidence.categories.find((item) => item.kind === 'INCOME').id,
    description: 'Доход · демо',
    note: '',
    ...overrides,
  };
}

function previewIncomeIntent(overrides = {}) {
  return createPreviewIncomeIntent(previewIncomeInput(), {
    accounts: syntheticPreviewEvidence.accounts,
    categories: syntheticPreviewEvidence.categories,
    randomUuid: () => '51000000-0000-0000-0000-000000000001',
    now: () => '2026-09-10T05:30:00.000Z',
    ...overrides,
  });
}

test('R3A preview amount parser uses exact RUB minor units without float rounding', () => {
  assert.equal(parsePreviewExpenseAmountMinor('1'), 100);
  assert.equal(parsePreviewExpenseAmountMinor('1,2'), 120);
  assert.equal(parsePreviewExpenseAmountMinor('1.23'), 123);
  assert.equal(parsePreviewExpenseAmountMinor('0,01'), 1);
  for (const value of ['0', '0.00', '-1', '1.234', '1e2', ' 1', '01']) {
    assert.throws(() => parsePreviewExpenseAmountMinor(value), /INVALID_PREVIEW_EXPENSE_INPUT/u);
  }
});

test('R3A preview creates one immutable PENDING EXPENSE intent from exact synthetic references', () => {
  const intent = previewExpenseIntent();
  assert.equal(intent.schemaVersion, 1);
  assert.equal(intent.kind, 'CREATE_EXPENSE');
  assert.equal(intent.state, 'PENDING');
  assert.equal(intent.payload.type, 'EXPENSE');
  assert.equal(intent.payload.amountMinor, 12540);
  assert.equal(intent.payload.currency, 'RUB');
  assert.equal(intent.payload.fromAccount.id, syntheticPreviewEvidence.accounts[0].id);
  assert.equal(intent.payload.category.kind, 'EXPENSE');
  assert.equal(intent.payload.note, null);
  assert.equal(Object.isFrozen(intent), true);
  assert.equal(Object.isFrozen(intent.payload), true);
});

test('R3A preview accepts only the selected EXPENSE category and required canonical input', () => {
  const income = syntheticPreviewEvidence.categories.find((item) => item.kind === 'INCOME');
  assert.throws(() => previewExpenseIntent({ categories: undefined }), /INVALID_PREVIEW_EXPENSE_INPUT/u);
  assert.throws(
    () => createPreviewExpenseIntent(previewExpenseInput({ categoryId: income.id }), {
      accounts: syntheticPreviewEvidence.accounts,
      categories: syntheticPreviewEvidence.categories,
      randomUuid: () => '50000000-0000-0000-0000-000000000002',
      now: () => '2026-09-09T12:00:00.000Z',
    }),
    /INVALID_PREVIEW_EXPENSE_INPUT/u,
  );
  assert.throws(() => createPreviewExpenseIntent(previewExpenseInput({ occurredOn: '2026-02-31' }), {
    accounts: syntheticPreviewEvidence.accounts,
    categories: syntheticPreviewEvidence.categories,
    randomUuid: () => '50000000-0000-0000-0000-000000000003',
    now: () => '2026-09-09T12:00:00.000Z',
  }), /INVALID_PREVIEW_EXPENSE_INPUT/u);
  assert.throws(() => createPreviewExpenseIntent(previewExpenseInput({ accountId: 'not-a-uuid' }), {
    accounts: syntheticPreviewEvidence.accounts,
    categories: syntheticPreviewEvidence.categories,
    randomUuid: () => '50000000-0000-0000-0000-000000000004',
    now: () => '2026-09-09T12:00:00.000Z',
  }), /INVALID_PREVIEW_EXPENSE_INPUT/u);
});

test('R3A preview INCOME amount parser reuses exact RUB minor-unit semantics', () => {
  assert.equal(parsePreviewIncomeAmountMinor('1'), 100);
  assert.equal(parsePreviewIncomeAmountMinor('1,2'), 120);
  assert.equal(parsePreviewIncomeAmountMinor('2500.75'), 250075);
  assert.equal(parsePreviewIncomeAmountMinor('0,01'), 1);
  for (const value of ['0', '0.00', '-1', '1.234', '1e2', ' 1', '01']) {
    assert.throws(() => parsePreviewIncomeAmountMinor(value), /INVALID_PREVIEW_INCOME_INPUT/u);
  }
});

test('R3A preview creates one immutable PENDING INCOME intent with destination account and INCOME category', () => {
  const intent = previewIncomeIntent();
  assert.equal(intent.schemaVersion, 1);
  assert.equal(intent.kind, 'CREATE_INCOME');
  assert.equal(intent.state, 'PENDING');
  assert.equal(intent.payload.type, 'INCOME');
  assert.equal(intent.payload.amountMinor, 250075);
  assert.equal(intent.payload.currency, 'RUB');
  assert.equal(intent.payload.toAccount.id, syntheticPreviewEvidence.accounts[0].id);
  assert.equal(intent.payload.category.kind, 'INCOME');
  assert.equal(intent.payload.note, null);
  assert.equal('fromAccount' in intent.payload, false);
  assert.equal(Object.isFrozen(intent), true);
  assert.equal(Object.isFrozen(intent.payload), true);
});

test('R3A preview INCOME accepts only exact destination account and INCOME category', () => {
  const expense = syntheticPreviewEvidence.categories.find((item) => item.kind === 'EXPENSE');
  assert.throws(
    () => createPreviewIncomeIntent(previewIncomeInput({ categoryId: expense.id }), {
      accounts: syntheticPreviewEvidence.accounts,
      categories: syntheticPreviewEvidence.categories,
      randomUuid: () => '51000000-0000-0000-0000-000000000002',
      now: () => '2026-09-10T05:30:00.000Z',
    }),
    /INVALID_PREVIEW_INCOME_INPUT/u,
  );
  assert.throws(() => createPreviewIncomeIntent(previewIncomeInput({ accountId: 'not-a-uuid' }), {
    accounts: syntheticPreviewEvidence.accounts,
    categories: syntheticPreviewEvidence.categories,
    randomUuid: () => '51000000-0000-0000-0000-000000000003',
    now: () => '2026-09-10T05:30:00.000Z',
  }), /INVALID_PREVIEW_INCOME_INPUT/u);
  assert.throws(() => createPreviewIncomeIntent(previewIncomeInput({ occurredOn: '2026-02-31' }), {
    accounts: syntheticPreviewEvidence.accounts,
    categories: syntheticPreviewEvidence.categories,
    randomUuid: () => '51000000-0000-0000-0000-000000000004',
    now: () => '2026-09-10T05:30:00.000Z',
  }), /INVALID_PREVIEW_INCOME_INPUT/u);
});

test('R3A preview strict outbox union accepts EXPENSE and INCOME while unknown kinds fail closed', async () => {
  const expense = previewExpenseIntent();
  const income = previewIncomeIntent();
  assert.equal(parsePreviewIntent(expense).kind, 'CREATE_EXPENSE');
  assert.equal(parsePreviewIntent(income).kind, 'CREATE_INCOME');
  assert.equal(parsePreviewIncomeIntent(income).payload.toAccount.id, income.payload.toAccount.id);
  assert.throws(() => parsePreviewIncomeIntent({ ...income, unexpected: true }), /INVALID_PREVIEW_OUTBOX_RECORD/u);
  assert.throws(() => parsePreviewIncomeIntent({ ...income, payload: { ...income.payload, category: { ...income.payload.category, kind: 'EXPENSE' } } }), /INVALID_PREVIEW_OUTBOX_RECORD/u);
  assert.throws(() => parsePreviewIntent({ ...income, kind: 'CREATE_TRANSFER' }), /INVALID_PREVIEW_OUTBOX_RECORD/u);

  const unknown = { ...income, intentId: '51000000-0000-0000-0000-000000000099', kind: 'CREATE_TRANSFER' };
  const fake = createPreviewOutboxFakeIndexedDb([unknown]);
  const outbox = createIndexedDbPreviewOutbox(fake.indexedDb);
  assert.equal(await outbox.countPending(), 0);
  await outbox.enqueue(expense);
  await outbox.enqueue(income);
  assert.equal(await outbox.countPending(), 2);
  assert.deepEqual((await outbox.listPending()).map((item) => item.kind).sort(), ['CREATE_EXPENSE', 'CREATE_INCOME']);
});

test('R3A preview preserves literal optional text while empty form values become null', () => {
  const literal = createPreviewExpenseIntent(previewExpenseInput({ description: '  literal  ', note: 'заметка' }), {
    accounts: syntheticPreviewEvidence.accounts,
    categories: syntheticPreviewEvidence.categories,
    randomUuid: () => '50000000-0000-0000-0000-000000000005',
    now: () => '2026-09-09T12:00:00.000Z',
  });
  assert.equal(literal.payload.description, '  literal  ');
  assert.equal(literal.payload.note, 'заметка');
  const absent = previewExpenseIntent();
  assert.equal(absent.payload.note, null);
});

test('R3A preview durable record validation fails closed on malformed evidence', () => {
  const valid = previewExpenseIntent();
  assert.equal(parsePreviewExpenseIntent(valid).intentId, valid.intentId);
  assert.throws(() => parsePreviewExpenseIntent({ ...valid, unexpected: true }), /INVALID_PREVIEW_OUTBOX_RECORD/u);
  assert.throws(() => parsePreviewExpenseIntent({ ...valid, intentId: 'NOT-CANONICAL' }), /INVALID_PREVIEW_OUTBOX_RECORD/u);
  assert.throws(() => parsePreviewExpenseIntent({ ...valid, payload: { ...valid.payload, amountMinor: 0 } }), /INVALID_PREVIEW_OUTBOX_RECORD/u);
  assert.throws(() => parsePreviewExpenseIntent({ ...valid, payload: { ...valid.payload, occurredOn: '2026-02-31' } }), /INVALID_PREVIEW_OUTBOX_RECORD/u);
  assert.throws(() => parsePreviewExpenseIntent({ ...valid, payload: { ...valid.payload, note: '   ' } }), /INVALID_PREVIEW_OUTBOX_RECORD/u);
  assert.throws(() => parsePreviewExpenseIntent({ ...valid, payload: { ...valid.payload, category: { ...valid.payload.category, kind: 'INCOME' } } }), /INVALID_PREVIEW_OUTBOX_RECORD/u);
});

test('R3A preview IndexedDB outbox is separate, durable, and excludes malformed rows from pending count', async () => {
  const malformed = { ...previewExpenseIntent(), intentId: 'bad-id' };
  const fake = createPreviewOutboxFakeIndexedDb([malformed]);
  const outbox = createIndexedDbPreviewOutbox(fake.indexedDb);
  assert.equal(previewOutboxContract.dbName, 'prihrash-r3a-preview');
  assert.notEqual(previewOutboxContract.dbName, 'prihrash-reader');
  assert.equal(await outbox.countPending(), 0);
  const intent = previewExpenseIntent();
  await outbox.enqueue(intent);
  assert.equal(await outbox.countPending(), 1);
  assert.equal((await outbox.listPending())[0].intentId, intent.intentId);
});

test('R3A preview enqueue is local-only and contains no network/provider write path', async () => {
  const outboxSource = await readFile(new URL('../../web/preview-writer-outbox.mjs', import.meta.url), 'utf8');
  const writerSource = await readFile(new URL('../../web/preview-writer.mjs', import.meta.url), 'utf8');
  for (const source of [outboxSource, writerSource]) {
    assert.doesNotMatch(source, /\bfetch\s*\(/u);
    assert.doesNotMatch(source, /\/api\//u);
    assert.doesNotMatch(source, /YDB_WRITE_ENABLED|@ydb|ydbjs|google-auth-library|spreadsheets\./iu);
  }
  assert.match(writerSource, /Сохранено локально · демо · не отправлено/u);
});

test('R3A Writer is injected by synthetic preview only; production Reader stays read-only', async () => {
  const bootstrap = await readFile(new URL('../../web/preview-bootstrap.mjs', import.meta.url), 'utf8');
  const productionShell = await readFile(new URL('../../web/index.html', import.meta.url), 'utf8');
  const productionApp = await readFile(new URL('../../web/app.mjs', import.meta.url), 'utf8');
  assert.match(bootstrap, /preview-writer\.mjs/u);
  assert.match(bootstrap, /mountSyntheticPreviewIncomeWriter/u);
  assert.match(productionShell, />Только чтение</u);
  assert.doesNotMatch(productionShell, /Новый расход|Новый доход|data-preview-writer|Сохранить локально/u);
  assert.doesNotMatch(productionApp, /preview-writer|CREATE_EXPENSE|Сохранить локально/u);
  const productionStyles = await readFile(new URL('../../web/styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(productionStyles, /preview-writer/u);
});


test('R3A preview draft preserves incomplete literal fields without promoting them to a transaction', () => {
  const draft = createPreviewExpenseDraft({
    amount: 'not-yet-valid',
    occurredOn: '2026-0',
    accountId: '',
    categoryId: '',
    description: '  literal draft  ',
    note: 'unfinished',
  }, { now: () => '2026-09-10T03:00:00.000Z' });
  assert.equal(draft.schemaVersion, previewOutboxContract.draftSchemaVersion);
  assert.equal(draft.draftKey, previewOutboxContract.draftKey);
  assert.equal(draft.amount, 'not-yet-valid');
  assert.equal(draft.occurredOn, '2026-0');
  assert.equal(draft.description, '  literal draft  ');
  assert.equal(parsePreviewExpenseDraft(draft).note, 'unfinished');
  assert.throws(() => parsePreviewExpenseDraft({ ...draft, amount: null }), /INVALID_PREVIEW_EXPENSE_DRAFT/u);
  assert.throws(() => parsePreviewExpenseDraft({ ...draft, savedAt: 'not-a-time' }), /INVALID_PREVIEW_EXPENSE_DRAFT/u);
});

test('R3A preview draft restore keeps literal text but clears stale reference ids without guessing', () => {
  const validAccount = syntheticPreviewEvidence.accounts[0].id;
  const validExpense = syntheticPreviewEvidence.categories.find((item) => item.kind === 'EXPENSE').id;
  const draft = createPreviewExpenseDraft({
    ...previewExpenseInput(),
    accountId: '90000000-0000-0000-0000-000000000001',
    categoryId: '90000000-0000-0000-0000-000000000002',
  }, { now: () => '2026-09-10T03:00:00.000Z' });
  const stale = restorePreviewExpenseDraft(draft, {
    accounts: syntheticPreviewEvidence.accounts,
    categories: syntheticPreviewEvidence.categories,
  });
  assert.equal(stale.accountId, '');
  assert.equal(stale.categoryId, '');
  assert.equal(stale.amount, draft.amount);
  assert.equal(stale.description, draft.description);

  const current = restorePreviewExpenseDraft(createPreviewExpenseDraft({
    ...previewExpenseInput(), accountId: validAccount, categoryId: validExpense,
  }, { now: () => '2026-09-10T03:00:00.000Z' }), {
    accounts: syntheticPreviewEvidence.accounts,
    categories: syntheticPreviewEvidence.categories,
  });
  assert.equal(current.accountId, validAccount);
  assert.equal(current.categoryId, validExpense);
});

test('R3A preview malformed durable draft fails closed and is not restored', async () => {
  const malformed = {
    schemaVersion: 1,
    draftKey: previewOutboxContract.draftKey,
    savedAt: 'not-a-time',
    amount: '12', occurredOn: '', accountId: '', categoryId: '', description: '', note: '',
  };
  const fake = createPreviewWriterFakeIndexedDb({ version: 2, draftRows: [malformed] });
  const drafts = createIndexedDbPreviewDraftStore(fake.indexedDb);
  assert.equal(await drafts.load(), null);
});

test('R3A preview INCOME draft preserves incomplete literals and restores only exact current references', () => {
  const draft = createPreviewIncomeDraft({
    amount: '7,',
    occurredOn: '2026-0',
    accountId: '91000000-0000-0000-0000-000000000001',
    categoryId: '91000000-0000-0000-0000-000000000002',
    description: '  literal income draft  ',
    note: 'unfinished',
  }, { now: () => '2026-09-10T05:31:00.000Z' });
  assert.equal(draft.draftKey, previewOutboxContract.incomeDraftKey);
  assert.equal(parsePreviewIncomeDraft(draft).amount, '7,');
  assert.throws(() => parsePreviewIncomeDraft({ ...draft, amount: null }), /INVALID_PREVIEW_INCOME_DRAFT/u);

  const stale = restorePreviewIncomeDraft(draft, {
    accounts: syntheticPreviewEvidence.accounts,
    categories: syntheticPreviewEvidence.categories,
  });
  assert.equal(stale.accountId, '');
  assert.equal(stale.categoryId, '');
  assert.equal(stale.description, '  literal income draft  ');

  const current = restorePreviewIncomeDraft(createPreviewIncomeDraft(previewIncomeInput(), {
    now: () => '2026-09-10T05:31:00.000Z',
  }), {
    accounts: syntheticPreviewEvidence.accounts,
    categories: syntheticPreviewEvidence.categories,
  });
  assert.equal(current.accountId, previewIncomeInput().accountId);
  assert.equal(current.categoryId, previewIncomeInput().categoryId);
});

test('R3A preview EXPENSE and INCOME drafts use isolated keys and income clear never deletes expense draft', async () => {
  const fake = createPreviewWriterFakeIndexedDb({ version: 2 });
  const expenseStore = createIndexedDbPreviewDraftStore(fake.indexedDb);
  const incomeStore = createIndexedDbPreviewIncomeDraftStore(fake.indexedDb);
  const expenseDraft = createPreviewExpenseDraft(previewExpenseInput(), { now: () => '2026-09-10T05:32:00.000Z' });
  const incomeDraft = createPreviewIncomeDraft(previewIncomeInput(), { now: () => '2026-09-10T05:32:00.000Z' });
  await expenseStore.save(expenseDraft);
  await incomeStore.save(incomeDraft);
  assert.equal((await expenseStore.load()).draftKey, previewOutboxContract.expenseDraftKey);
  assert.equal((await incomeStore.load()).draftKey, previewOutboxContract.incomeDraftKey);
  await incomeStore.clear();
  assert.equal(await incomeStore.load(), null);
  assert.equal((await expenseStore.load()).draftKey, previewOutboxContract.expenseDraftKey);
});

test('R3A preview IndexedDB v1 to v2 upgrade adds drafts without losing existing outbox intents', async () => {
  const existing = previewExpenseIntent();
  const fake = createPreviewWriterFakeIndexedDb({ version: 1, outboxRows: [existing] });
  const drafts = createIndexedDbPreviewDraftStore(fake.indexedDb);
  const outbox = createIndexedDbPreviewOutbox(fake.indexedDb);
  const draft = createPreviewExpenseDraft(previewExpenseInput({ amount: '7,' }), { now: () => '2026-09-10T03:00:00.000Z' });
  await drafts.save(draft);
  assert.equal(fake.version(), 2);
  assert.deepEqual(fake.createdStores, [previewOutboxContract.draftStoreName]);
  assert.equal(await outbox.countPending(), 1);
  assert.equal((await outbox.listPending())[0].intentId, existing.intentId);
  assert.equal((await drafts.load()).amount, '7,');
});

test('R3A preview commits outbox before clearing draft and never clears draft when enqueue fails', async () => {
  const intent = previewExpenseIntent();
  const events = [];
  const success = await enqueuePreviewExpenseThenClearDraft({
    outbox: { enqueue: async (value) => { events.push('enqueue'); return value; } },
    draftStore: { clear: async () => { events.push('clear'); } },
    intent,
  });
  assert.deepEqual(events, ['enqueue', 'clear']);
  assert.equal(success.draftCleared, true);

  events.length = 0;
  await assert.rejects(enqueuePreviewExpenseThenClearDraft({
    outbox: { enqueue: async () => { events.push('enqueue'); throw new Error('failed'); } },
    draftStore: { clear: async () => { events.push('clear'); } },
    intent,
  }), /failed/u);
  assert.deepEqual(events, ['enqueue']);

  const degraded = await enqueuePreviewExpenseThenClearDraft({
    outbox: { enqueue: async (value) => value },
    draftStore: { clear: async () => { throw new Error('failed'); } },
    intent,
  });
  assert.equal(degraded.draftCleared, false);
});

test('R3A preview INCOME commits outbox before clearing only its draft and preserves draft on enqueue failure', async () => {
  const intent = previewIncomeIntent();
  const events = [];
  const success = await enqueuePreviewIncomeThenClearDraft({
    outbox: { enqueue: async (value) => { events.push('enqueue'); return value; } },
    draftStore: { clear: async () => { events.push('clear-income'); } },
    intent,
  });
  assert.deepEqual(events, ['enqueue', 'clear-income']);
  assert.equal(success.draftCleared, true);

  events.length = 0;
  await assert.rejects(enqueuePreviewIncomeThenClearDraft({
    outbox: { enqueue: async () => { events.push('enqueue'); throw new Error('failed'); } },
    draftStore: { clear: async () => { events.push('clear-income'); } },
    intent,
  }), /failed/u);
  assert.deepEqual(events, ['enqueue']);
});

test('R3A draft mechanics remain preview-only and contain no network/provider write path', async () => {
  const writerSource = await readFile(new URL('../../web/preview-writer.mjs', import.meta.url), 'utf8');
  const storageSource = await readFile(new URL('../../web/preview-writer-outbox.mjs', import.meta.url), 'utf8');
  assert.equal(previewOutboxContract.dbVersion, 2);
  assert.equal(previewOutboxContract.draftStoreName, 'drafts');
  assert.match(writerSource, /Черновик сохранён локально · демо/u);
  assert.match(writerSource, /enqueuePreviewExpenseThenClearDraft/u);
  assert.match(writerSource, /enqueuePreviewIncomeThenClearDraft/u);
  assert.match(writerSource, /Новый доход · демо/u);
  assert.equal(previewOutboxContract.incomeDraftKey, 'quick-income');
  assert.match(storageSource, /createObjectStore\(DRAFT_STORE_NAME/u);
  for (const source of [writerSource, storageSource]) {
    assert.doesNotMatch(source, /\bfetch\s*\(/u);
    assert.doesNotMatch(source, /\/api\//u);
    assert.doesNotMatch(source, /YDB_WRITE_ENABLED|@ydb|ydbjs|google-auth-library|spreadsheets\./iu);
  }
  const productionShell = await readFile(new URL('../../web/index.html', import.meta.url), 'utf8');
  const productionApp = await readFile(new URL('../../web/app.mjs', import.meta.url), 'utf8');
  const productionServiceWorker = await readFile(new URL('../../web/sw.js', import.meta.url), 'utf8');
  assert.doesNotMatch(productionShell, /Черновик|drafts|preview-writer|Новый доход/u);
  assert.doesNotMatch(productionApp, /drafts|preview-writer/u);
  assert.doesNotMatch(productionServiceWorker, /preview-writer|drafts/u);
});

test('R3A preview delivery maps PENDING intent to minimal create request without local labels/metadata', () => {
  const intent = previewExpenseIntent();
  const request = createPreviewExpenseCreateApiRequest(intent);
  assert.deepEqual(request, {
    idempotencyKey: intent.intentId,
    occurredOn: intent.payload.occurredOn,
    amountMinor: intent.payload.amountMinor,
    currency: 'RUB',
    fromAccountId: intent.payload.fromAccount.id,
    categoryId: intent.payload.category.id,
    description: intent.payload.description,
    note: intent.payload.note,
  });
  assert.equal(Object.isFrozen(request), true);
  assert.equal('createdAt' in request, false);
  assert.equal('fromAccount' in request, false);
  assert.equal('category' in request, false);
  assert.equal(JSON.stringify(request).includes(intent.payload.fromAccount.label), false);
  assert.equal(JSON.stringify(request).includes(intent.payload.category.label), false);
});

test('R3A preview IndexedDB acknowledge removes only the exact canonical pending key', async () => {
  const intent = previewExpenseIntent();
  const fake = createPreviewOutboxFakeIndexedDb();
  const outbox = createIndexedDbPreviewOutbox(fake.indexedDb);
  await outbox.enqueue(intent);
  assert.equal(await outbox.countPending(), 1);
  await outbox.acknowledge(intent.intentId);
  assert.equal(await outbox.countPending(), 0);
  await assert.rejects(outbox.acknowledge('A0000000-0000-0000-0000-000000000001'), /INVALID_PREVIEW_OUTBOX_RECORD/u);
});

test('R3A preview delivery validates CREATED and REPLAY ACK before local acknowledge', async () => {
  const intent = previewExpenseIntent();
  for (const outcome of ['CREATED', 'REPLAY']) {
    const events = [];
    const ack = await deliverPreviewExpenseIntent({
      intent,
      sender: {
        async sendExpenseCreate(request) {
          events.push(['send', request.idempotencyKey]);
          return {
            apiVersion: 1,
            outcome,
            idempotencyKey: request.idempotencyKey,
            transactionId: '60000000-0000-0000-0000-000000000001',
            version: 1,
          };
        },
      },
      outbox: {
        async acknowledge(intentId) {
          events.push(['acknowledge', intentId]);
        },
      },
    });
    assert.equal(ack.outcome, outcome);
    assert.equal(Object.isFrozen(ack), true);
    assert.deepEqual(events, [
      ['send', intent.intentId],
      ['acknowledge', intent.intentId],
    ]);
  }
});

test('R3A preview delivery keeps PENDING when sender fails and sanitizes raw sender diagnostics', async () => {
  const intent = previewExpenseIntent();
  let acknowledged = false;
  await assert.rejects(
    deliverPreviewExpenseIntent({
      intent,
      sender: { sendExpenseCreate: async () => { throw new Error('private-provider-diagnostic'); } },
      outbox: { acknowledge: async () => { acknowledged = true; } },
    }),
    (error) => error?.message === 'PREVIEW_EXPENSE_SEND_FAILED' && !String(error).includes('private-provider-diagnostic'),
  );
  assert.equal(acknowledged, false);
});

test('R3A preview delivery rejects malformed or mismatched ACK without acknowledging local intent', async () => {
  const intent = previewExpenseIntent();
  const valid = {
    apiVersion: 1,
    outcome: 'CREATED',
    idempotencyKey: intent.intentId,
    transactionId: '60000000-0000-0000-0000-000000000001',
    version: 1,
  };
  const badAcks = [
    { ...valid, apiVersion: 2 },
    { ...valid, outcome: 'POSTED' },
    { ...valid, idempotencyKey: '50000000-0000-0000-0000-000000000002' },
    { ...valid, transactionId: intent.intentId },
    { ...valid, transactionId: 'A0000000-0000-0000-0000-000000000001' },
    { ...valid, version: 2 },
    { ...valid, extra: true },
  ];
  for (const response of badAcks) {
    let acknowledged = false;
    await assert.rejects(deliverPreviewExpenseIntent({
      intent,
      sender: { sendExpenseCreate: async () => response },
      outbox: { acknowledge: async () => { acknowledged = true; } },
    }), /INVALID_PREVIEW_EXPENSE_ACK/u);
    assert.equal(acknowledged, false);
  }
  assert.throws(() => parsePreviewExpenseCreateAck(valid, 'A0000000-0000-0000-0000-000000000001'), /INVALID_PREVIEW_EXPENSE_ACK/u);
});

test('R3A preview retry after server commit but local ACK failure reuses same key and clears on REPLAY', async () => {
  const intent = previewExpenseIntent();
  const sentKeys = [];
  let sendCount = 0;
  const sender = {
    async sendExpenseCreate(request) {
      sentKeys.push(request.idempotencyKey);
      sendCount += 1;
      return {
        apiVersion: 1,
        outcome: sendCount === 1 ? 'CREATED' : 'REPLAY',
        idempotencyKey: request.idempotencyKey,
        transactionId: '60000000-0000-0000-0000-000000000001',
        version: 1,
      };
    },
  };
  let ackAttempts = 0;
  const outbox = {
    async acknowledge(intentId) {
      assert.equal(intentId, intent.intentId);
      ackAttempts += 1;
      if (ackAttempts === 1) throw new Error('local-delete-failed');
    },
  };
  await assert.rejects(
    deliverPreviewExpenseIntent({ outbox, sender, intent }),
    (error) => error?.message === 'PREVIEW_EXPENSE_LOCAL_ACK_FAILED' && !String(error).includes('local-delete-failed'),
  );
  const replay = await deliverPreviewExpenseIntent({ outbox, sender, intent });
  assert.equal(replay.outcome, 'REPLAY');
  assert.deepEqual(sentKeys, [intent.intentId, intent.intentId]);
  assert.equal(ackAttempts, 2);
});

test('R3A preview delivery remains transport-neutral and production Reader stays untouched', async () => {
  const deliverySource = await readFile(new URL('../../web/preview-writer-delivery.mjs', import.meta.url), 'utf8');
  const storageSource = await readFile(new URL('../../web/preview-writer-outbox.mjs', import.meta.url), 'utf8');
  assert.match(deliverySource, /sendExpenseCreate/u);
  assert.match(storageSource, /acknowledge\(intentId\)/u);
  for (const source of [deliverySource, storageSource]) {
    assert.doesNotMatch(source, /\bfetch\s*\(/u);
    assert.doesNotMatch(source, /https?:\/\//u);
    assert.doesNotMatch(source, /\/api\//u);
    assert.doesNotMatch(source, /API Gateway|Yandex|YDB_WRITE_ENABLED|@ydb|ydbjs|cookie|Authorization/iu);
  }
  const productionApp = await readFile(new URL('../../web/app.mjs', import.meta.url), 'utf8');
  const productionServiceWorker = await readFile(new URL('../../web/sw.js', import.meta.url), 'utf8');
  assert.doesNotMatch(productionApp, /preview-writer-delivery|sendExpenseCreate/u);
  assert.doesNotMatch(productionServiceWorker, /preview-writer-delivery|sendExpenseCreate/u);
});
