const DB_NAME = 'prihrash-r3a-preview';
const DB_VERSION = 2;
const OUTBOX_STORE_NAME = 'outbox';
const DRAFT_STORE_NAME = 'drafts';
const DRAFT_KEY = 'quick-expense';
const RECORD_SCHEMA_VERSION = 1;
const DRAFT_SCHEMA_VERSION = 1;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:[.,]\d{1,2})?$/u;

function invalidInput() {
  throw new Error('INVALID_PREVIEW_EXPENSE_INPUT');
}

function invalidRecord() {
  throw new Error('INVALID_PREVIEW_OUTBOX_RECORD');
}

function invalidDraft() {
  throw new Error('INVALID_PREVIEW_EXPENSE_DRAFT');
}

function canonicalUuid(value, fail = invalidInput) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail();
  return value;
}

function canonicalDate(value, fail = invalidInput) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) fail();
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) fail();
  return value;
}

function canonicalTimestamp(value, fail = invalidRecord) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || !Number.isFinite(Date.parse(value))) fail();
  return value;
}

function entityRef(value, fail = invalidRecord) {
  if (!exactKeys(value, ['id', 'label'])) fail();
  const id = canonicalUuid(value.id, fail);
  if (typeof value.label !== 'string' || value.label.length === 0 || value.label !== value.label.trim()) fail();
  return Object.freeze({ id, label: value.label });
}

function expenseCategoryRef(value, fail = invalidRecord) {
  if (!exactKeys(value, ['id', 'label', 'kind']) || value.kind !== 'EXPENSE') fail();
  const id = canonicalUuid(value.id, fail);
  if (typeof value.label !== 'string' || value.label.length === 0 || value.label !== value.label.trim()) fail();
  return Object.freeze({ id, label: value.label, kind: 'EXPENSE' });
}

function optionalLiteralText(value, fail = invalidRecord) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0) fail();
  return value;
}

function literalDraftField(value) {
  if (typeof value !== 'string') invalidDraft();
  return value;
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function resolveUniqueRef(id, values) {
  canonicalUuid(id);
  if (!Array.isArray(values)) invalidInput();
  const matches = values.filter((item) => item?.id === id);
  if (matches.length !== 1) invalidInput();
  return entityRef(matches[0], invalidInput);
}

function resolveUniqueExpenseCategory(id, values) {
  canonicalUuid(id);
  if (!Array.isArray(values)) invalidInput();
  const matches = values.filter((item) => item?.id === id);
  if (matches.length !== 1) invalidInput();
  return expenseCategoryRef(matches[0], invalidInput);
}

function restorableAccountId(id, accounts) {
  if (typeof id !== 'string' || !Array.isArray(accounts)) return '';
  return accounts.filter((item) => item?.id === id).length === 1 ? id : '';
}

function restorableExpenseCategoryId(id, categories) {
  if (typeof id !== 'string' || !Array.isArray(categories)) return '';
  const matches = categories.filter((item) => item?.id === id && item?.kind === 'EXPENSE');
  return matches.length === 1 ? id : '';
}

export function parsePreviewExpenseAmountMinor(value) {
  if (typeof value !== 'string' || value !== value.trim() || !AMOUNT_PATTERN.test(value)) invalidInput();
  const [wholeText, fractionText = ''] = value.replace(',', '.').split('.');
  const whole = Number(wholeText);
  const fraction = Number(fractionText.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(fraction)) invalidInput();
  const amountMinor = whole * 100 + fraction;
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) invalidInput();
  return amountMinor;
}

export function createPreviewExpenseIntent(input, {
  accounts,
  categories,
  randomUuid = () => globalThis.crypto?.randomUUID?.(),
  now = () => new Date().toISOString(),
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalidInput();
  const intentId = canonicalUuid(randomUuid());
  const createdAt = now();
  if (typeof createdAt !== 'string' || createdAt.length === 0 || createdAt !== createdAt.trim() || !Number.isFinite(Date.parse(createdAt))) invalidInput();
  const fromAccount = resolveUniqueRef(input.accountId, accounts);
  const category = resolveUniqueExpenseCategory(input.categoryId, categories);
  const description = input.description === '' ? null : optionalLiteralText(input.description, invalidInput);
  const note = input.note === '' ? null : optionalLiteralText(input.note, invalidInput);

  return parsePreviewExpenseIntent({
    schemaVersion: RECORD_SCHEMA_VERSION,
    intentId,
    kind: 'CREATE_EXPENSE',
    state: 'PENDING',
    createdAt,
    payload: {
      type: 'EXPENSE',
      occurredOn: canonicalDate(input.occurredOn),
      amountMinor: parsePreviewExpenseAmountMinor(input.amount),
      currency: 'RUB',
      fromAccount,
      category,
      description,
      note,
    },
  });
}

export function parsePreviewExpenseIntent(value) {
  if (!exactKeys(value, ['schemaVersion', 'intentId', 'kind', 'state', 'createdAt', 'payload'])) invalidRecord();
  if (value.schemaVersion !== RECORD_SCHEMA_VERSION || value.kind !== 'CREATE_EXPENSE' || value.state !== 'PENDING') invalidRecord();
  const intentId = canonicalUuid(value.intentId, invalidRecord);
  const createdAt = canonicalTimestamp(value.createdAt, invalidRecord);
  if (!exactKeys(value.payload, ['type', 'occurredOn', 'amountMinor', 'currency', 'fromAccount', 'category', 'description', 'note'])) invalidRecord();
  if (value.payload.type !== 'EXPENSE' || value.payload.currency !== 'RUB') invalidRecord();
  if (!Number.isSafeInteger(value.payload.amountMinor) || value.payload.amountMinor <= 0) invalidRecord();
  const occurredOn = canonicalDate(value.payload.occurredOn, invalidRecord);
  const fromAccount = entityRef(value.payload.fromAccount, invalidRecord);
  const category = expenseCategoryRef(value.payload.category, invalidRecord);
  const description = optionalLiteralText(value.payload.description, invalidRecord);
  const note = optionalLiteralText(value.payload.note, invalidRecord);

  return Object.freeze({
    schemaVersion: RECORD_SCHEMA_VERSION,
    intentId,
    kind: 'CREATE_EXPENSE',
    state: 'PENDING',
    createdAt,
    payload: Object.freeze({
      type: 'EXPENSE',
      occurredOn,
      amountMinor: value.payload.amountMinor,
      currency: 'RUB',
      fromAccount,
      category,
      description,
      note,
    }),
  });
}

export function createPreviewExpenseDraft(input, { now = () => new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalidDraft();
  return parsePreviewExpenseDraft({
    schemaVersion: DRAFT_SCHEMA_VERSION,
    draftKey: DRAFT_KEY,
    savedAt: now(),
    amount: input.amount,
    occurredOn: input.occurredOn,
    accountId: input.accountId,
    categoryId: input.categoryId,
    description: input.description,
    note: input.note,
  });
}

export function parsePreviewExpenseDraft(value) {
  if (!exactKeys(value, ['schemaVersion', 'draftKey', 'savedAt', 'amount', 'occurredOn', 'accountId', 'categoryId', 'description', 'note'])) invalidDraft();
  if (value.schemaVersion !== DRAFT_SCHEMA_VERSION || value.draftKey !== DRAFT_KEY) invalidDraft();
  const savedAt = canonicalTimestamp(value.savedAt, invalidDraft);
  return Object.freeze({
    schemaVersion: DRAFT_SCHEMA_VERSION,
    draftKey: DRAFT_KEY,
    savedAt,
    amount: literalDraftField(value.amount),
    occurredOn: literalDraftField(value.occurredOn),
    accountId: literalDraftField(value.accountId),
    categoryId: literalDraftField(value.categoryId),
    description: literalDraftField(value.description),
    note: literalDraftField(value.note),
  });
}

export function restorePreviewExpenseDraft(draft, { accounts, categories } = {}) {
  const safe = parsePreviewExpenseDraft(draft);
  return Object.freeze({
    amount: safe.amount,
    occurredOn: safe.occurredOn,
    accountId: restorableAccountId(safe.accountId, accounts),
    categoryId: restorableExpenseCategoryId(safe.categoryId, categories),
    description: safe.description,
    note: safe.note,
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('PREVIEW_WRITER_REQUEST_FAILED'));
  });
}

function transactionFinished(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error('PREVIEW_WRITER_TRANSACTION_FAILED'));
    transaction.onabort = () => reject(new Error('PREVIEW_WRITER_TRANSACTION_FAILED'));
  });
}

function openDatabase(indexedDb) {
  if (!indexedDb || typeof indexedDb.open !== 'function') return Promise.reject(new Error('PREVIEW_WRITER_STORAGE_UNAVAILABLE'));
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE_NAME)) db.createObjectStore(OUTBOX_STORE_NAME, { keyPath: 'intentId' });
      if (!db.objectStoreNames.contains(DRAFT_STORE_NAME)) db.createObjectStore(DRAFT_STORE_NAME, { keyPath: 'draftKey' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('PREVIEW_WRITER_STORAGE_OPEN_FAILED'));
    request.onblocked = () => reject(new Error('PREVIEW_WRITER_STORAGE_OPEN_FAILED'));
  });
}

function createStoreAccess(indexedDb) {
  return async function withStore(storeName, mode, action) {
    const db = await openDatabase(indexedDb);
    try {
      const transaction = db.transaction(storeName, mode);
      const finished = transactionFinished(transaction);
      const result = await action(transaction.objectStore(storeName));
      await finished;
      return result;
    } finally {
      db.close();
    }
  };
}

export function createIndexedDbPreviewOutbox(indexedDb = globalThis.indexedDB) {
  const withStore = createStoreAccess(indexedDb);

  async function listPending() {
    let rows;
    try {
      rows = await withStore(OUTBOX_STORE_NAME, 'readonly', (store) => requestResult(store.getAll()));
    } catch {
      throw new Error('PREVIEW_OUTBOX_READ_FAILED');
    }
    if (!Array.isArray(rows)) throw new Error('PREVIEW_OUTBOX_READ_FAILED');
    const valid = [];
    for (const row of rows) {
      try {
        valid.push(parsePreviewExpenseIntent(row));
      } catch {
        // Malformed durable preview evidence is ignored and never counted as a valid pending intent.
      }
    }
    return Object.freeze(valid);
  }

  return Object.freeze({
    async enqueue(intent) {
      const safe = parsePreviewExpenseIntent(intent);
      try {
        await withStore(OUTBOX_STORE_NAME, 'readwrite', (store) => requestResult(store.add(safe)));
      } catch {
        throw new Error('PREVIEW_OUTBOX_WRITE_FAILED');
      }
      return safe;
    },
    listPending,
    async countPending() {
      return (await listPending()).length;
    },
    async acknowledge(intentId) {
      const safeIntentId = canonicalUuid(intentId, invalidRecord);
      try {
        await withStore(OUTBOX_STORE_NAME, 'readwrite', (store) => requestResult(store.delete(safeIntentId)));
      } catch {
        throw new Error('PREVIEW_OUTBOX_ACK_FAILED');
      }
    },
  });
}

export function createIndexedDbPreviewDraftStore(indexedDb = globalThis.indexedDB) {
  const withStore = createStoreAccess(indexedDb);
  return Object.freeze({
    async save(draft) {
      const safe = parsePreviewExpenseDraft(draft);
      try {
        await withStore(DRAFT_STORE_NAME, 'readwrite', (store) => requestResult(store.put(safe)));
      } catch {
        throw new Error('PREVIEW_DRAFT_WRITE_FAILED');
      }
      return safe;
    },
    async load() {
      let row;
      try {
        row = await withStore(DRAFT_STORE_NAME, 'readonly', (store) => requestResult(store.get(DRAFT_KEY)));
      } catch {
        throw new Error('PREVIEW_DRAFT_READ_FAILED');
      }
      if (row === undefined) return null;
      try {
        return parsePreviewExpenseDraft(row);
      } catch {
        return null;
      }
    },
    async clear() {
      try {
        await withStore(DRAFT_STORE_NAME, 'readwrite', (store) => requestResult(store.delete(DRAFT_KEY)));
      } catch {
        throw new Error('PREVIEW_DRAFT_CLEAR_FAILED');
      }
    },
  });
}

export async function enqueuePreviewExpenseThenClearDraft({ outbox, draftStore, intent }) {
  const saved = await outbox.enqueue(intent);
  try {
    await draftStore.clear();
    return Object.freeze({ intent: saved, draftCleared: true });
  } catch {
    return Object.freeze({ intent: saved, draftCleared: false });
  }
}

export const previewOutboxContract = Object.freeze({
  dbName: DB_NAME,
  dbVersion: DB_VERSION,
  storeName: OUTBOX_STORE_NAME,
  recordSchemaVersion: RECORD_SCHEMA_VERSION,
  draftStoreName: DRAFT_STORE_NAME,
  draftKey: DRAFT_KEY,
  draftSchemaVersion: DRAFT_SCHEMA_VERSION,
});
