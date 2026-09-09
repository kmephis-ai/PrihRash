import assert from 'node:assert/strict';
import { access, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { createSyntheticPreviewFetch, syntheticPreviewEvidence } from '../../web/preview-transport.mjs';
import { sanitizeReaderResponse, toOperationPresentation } from '../../web/presentation.mjs';
import { sanitizeReaderFilterOptions } from '../../web/reader-filters.mjs';
import { sanitizeReaderSyncStatus } from '../../web/reader-sync-status.mjs';
import {
  createIndexedDbPreviewOutbox,
  createPreviewExpenseIntent,
  parsePreviewExpenseAmountMinor,
  parsePreviewExpenseIntent,
  previewOutboxContract,
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


function createPreviewOutboxFakeIndexedDb(initialRows = []) {
  const rows = [...initialRows];
  let hasStore = false;
  const objectStoreNames = { contains: (name) => hasStore && name === previewOutboxContract.storeName };

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
    createObjectStore(name) {
      assert.equal(name, previewOutboxContract.storeName);
      hasStore = true;
    },
    close() {},
    transaction(name) {
      assert.equal(name, previewOutboxContract.storeName);
      const transaction = {};
      transaction.objectStore = () => ({
        add: (value) => makeRequest(() => {
          if (rows.some((row) => row?.intentId === value.intentId)) throw new Error('duplicate');
          rows.push(value);
          return value.intentId;
        }, transaction),
        getAll: () => makeRequest(() => [...rows], transaction),
      });
      return transaction;
    },
  };

  return {
    indexedDb: {
      open(name, version) {
        assert.equal(name, previewOutboxContract.dbName);
        assert.equal(version, previewOutboxContract.dbVersion);
        const request = { result: db };
        queueMicrotask(() => {
          if (!hasStore) request.onupgradeneeded?.();
          request.onsuccess?.();
        });
        return request;
      },
    },
    rows,
  };
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
  assert.match(productionShell, />Только чтение</u);
  assert.doesNotMatch(productionShell, /Новый расход|data-preview-writer|Сохранить локально/u);
  assert.doesNotMatch(productionApp, /preview-writer|CREATE_EXPENSE|Сохранить локально/u);
  const productionStyles = await readFile(new URL('../../web/styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(productionStyles, /preview-writer/u);
});
