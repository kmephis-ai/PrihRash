const DB_NAME = 'prihrash-r3a-preview';
const DB_VERSION = 2;
const OUTBOX_STORE_NAME = 'outbox';
const DRAFT_STORE_NAME = 'drafts';
const EXPENSE_DRAFT_KEY = 'quick-expense';
const INCOME_DRAFT_KEY = 'quick-income';
const TRANSFER_DRAFT_KEY = 'quick-transfer';
const RECORD_SCHEMA_VERSION = 1;
const EXPENSE_RECORD_SCHEMA_VERSION = 2;
const DRAFT_SCHEMA_VERSION = 1;
const EXPENSE_DRAFT_SCHEMA_VERSION = 2;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:[.,]\d{1,2})?$/u;

function invalidExpenseInput() {
  throw new Error('INVALID_PREVIEW_EXPENSE_INPUT');
}

function invalidIncomeInput() {
  throw new Error('INVALID_PREVIEW_INCOME_INPUT');
}

function invalidTransferInput() {
  throw new Error('INVALID_PREVIEW_TRANSFER_INPUT');
}

function invalidRecord() {
  throw new Error('INVALID_PREVIEW_OUTBOX_RECORD');
}

function invalidExpenseDraft() {
  throw new Error('INVALID_PREVIEW_EXPENSE_DRAFT');
}

function invalidIncomeDraft() {
  throw new Error('INVALID_PREVIEW_INCOME_DRAFT');
}

function invalidTransferDraft() {
  throw new Error('INVALID_PREVIEW_TRANSFER_DRAFT');
}

function canonicalUuid(value, fail = invalidExpenseInput) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail();
  return value;
}

function canonicalDate(value, fail = invalidExpenseInput) {
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

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function entityRef(value, fail = invalidRecord) {
  if (!exactKeys(value, ['id', 'label'])) fail();
  const id = canonicalUuid(value.id, fail);
  if (typeof value.label !== 'string' || value.label.length === 0 || value.label !== value.label.trim()) fail();
  return Object.freeze({ id, label: value.label });
}

function optionalEntityRef(value, fail = invalidRecord) {
  if (value === null) return null;
  return entityRef(value, fail);
}

function categoryRef(value, kind, fail = invalidRecord) {
  if (!exactKeys(value, ['id', 'label', 'kind']) || value.kind !== kind) fail();
  const id = canonicalUuid(value.id, fail);
  if (typeof value.label !== 'string' || value.label.length === 0 || value.label !== value.label.trim()) fail();
  return Object.freeze({ id, label: value.label, kind });
}

function optionalLiteralText(value, fail = invalidRecord) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0) fail();
  return value;
}

function literalDraftField(value, fail) {
  if (typeof value !== 'string') fail();
  return value;
}

function resolveUniqueRef(id, values, fail) {
  canonicalUuid(id, fail);
  if (!Array.isArray(values)) fail();
  const matches = values.filter((item) => item?.id === id);
  if (matches.length !== 1) fail();
  return entityRef(matches[0], fail);
}

function resolveOptionalUniqueRef(id, values, fail) {
  if (id === '') return null;
  return resolveUniqueRef(id, values, fail);
}

function resolveUniqueCategory(id, values, kind, fail) {
  canonicalUuid(id, fail);
  if (!Array.isArray(values)) fail();
  const matches = values.filter((item) => item?.id === id);
  if (matches.length !== 1) fail();
  return categoryRef(matches[0], kind, fail);
}

function restorableAccountId(id, accounts) {
  if (typeof id !== 'string' || !Array.isArray(accounts)) return '';
  return accounts.filter((item) => item?.id === id).length === 1 ? id : '';
}

function restorableMemberId(id, members) {
  if (id === '') return '';
  if (typeof id !== 'string' || !Array.isArray(members)) return '';
  const matches = members.filter((item) => item?.id === id);
  if (matches.length !== 1) return '';
  try {
    return entityRef(matches[0], invalidExpenseDraft).id;
  } catch {
    return '';
  }
}

function restorableCategoryId(id, categories, kind) {
  if (typeof id !== 'string' || !Array.isArray(categories)) return '';
  const matches = categories.filter((item) => item?.id === id && item?.kind === kind);
  return matches.length === 1 ? id : '';
}

function parsePreviewAmountMinor(value, fail) {
  if (typeof value !== 'string' || value !== value.trim() || !AMOUNT_PATTERN.test(value)) fail();
  const [wholeText, fractionText = ''] = value.replace(',', '.').split('.');
  const whole = Number(wholeText);
  const fraction = Number(fractionText.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(fraction)) fail();
  const amountMinor = whole * 100 + fraction;
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) fail();
  return amountMinor;
}

export function parsePreviewExpenseAmountMinor(value) {
  return parsePreviewAmountMinor(value, invalidExpenseInput);
}

export function parsePreviewIncomeAmountMinor(value) {
  return parsePreviewAmountMinor(value, invalidIncomeInput);
}

export function parsePreviewTransferAmountMinor(value) {
  return parsePreviewAmountMinor(value, invalidTransferInput);
}

function createIntentBase(input, { randomUuid, now, fail }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail();
  const intentId = canonicalUuid(randomUuid(), fail);
  const createdAt = now();
  if (typeof createdAt !== 'string' || createdAt.length === 0 || createdAt !== createdAt.trim() || !Number.isFinite(Date.parse(createdAt))) fail();
  return { intentId, createdAt };
}

export function createPreviewExpenseIntent(input, {
  accounts,
  categories,
  members,
  randomUuid = () => globalThis.crypto?.randomUUID?.(),
  now = () => new Date().toISOString(),
} = {}) {
  const { intentId, createdAt } = createIntentBase(input, { randomUuid, now, fail: invalidExpenseInput });
  const fromAccount = resolveUniqueRef(input.accountId, accounts, invalidExpenseInput);
  const category = resolveUniqueCategory(input.categoryId, categories, 'EXPENSE', invalidExpenseInput);
  const paidByMember = resolveOptionalUniqueRef(input.paidByMemberId, members, invalidExpenseInput);
  const description = input.description === '' ? null : optionalLiteralText(input.description, invalidExpenseInput);
  const note = input.note === '' ? null : optionalLiteralText(input.note, invalidExpenseInput);

  return parsePreviewExpenseIntent({
    schemaVersion: EXPENSE_RECORD_SCHEMA_VERSION,
    intentId,
    kind: 'CREATE_EXPENSE',
    state: 'PENDING',
    createdAt,
    payload: {
      type: 'EXPENSE',
      occurredOn: canonicalDate(input.occurredOn, invalidExpenseInput),
      amountMinor: parsePreviewExpenseAmountMinor(input.amount),
      currency: 'RUB',
      fromAccount,
      category,
      paidByMember,
      description,
      note,
    },
  });
}

export function createPreviewIncomeIntent(input, {
  accounts,
  categories,
  randomUuid = () => globalThis.crypto?.randomUUID?.(),
  now = () => new Date().toISOString(),
} = {}) {
  const { intentId, createdAt } = createIntentBase(input, { randomUuid, now, fail: invalidIncomeInput });
  const toAccount = resolveUniqueRef(input.accountId, accounts, invalidIncomeInput);
  const category = resolveUniqueCategory(input.categoryId, categories, 'INCOME', invalidIncomeInput);
  const description = input.description === '' ? null : optionalLiteralText(input.description, invalidIncomeInput);
  const note = input.note === '' ? null : optionalLiteralText(input.note, invalidIncomeInput);

  return parsePreviewIncomeIntent({
    schemaVersion: RECORD_SCHEMA_VERSION,
    intentId,
    kind: 'CREATE_INCOME',
    state: 'PENDING',
    createdAt,
    payload: {
      type: 'INCOME',
      occurredOn: canonicalDate(input.occurredOn, invalidIncomeInput),
      amountMinor: parsePreviewIncomeAmountMinor(input.amount),
      currency: 'RUB',
      toAccount,
      category,
      description,
      note,
    },
  });
}

export function createPreviewTransferIntent(input, {
  accounts,
  randomUuid = () => globalThis.crypto?.randomUUID?.(),
  now = () => new Date().toISOString(),
} = {}) {
  const { intentId, createdAt } = createIntentBase(input, { randomUuid, now, fail: invalidTransferInput });
  const fromAccount = resolveUniqueRef(input.fromAccountId, accounts, invalidTransferInput);
  const toAccount = resolveUniqueRef(input.toAccountId, accounts, invalidTransferInput);
  if (fromAccount.id === toAccount.id) invalidTransferInput();
  const description = input.description === '' ? null : optionalLiteralText(input.description, invalidTransferInput);
  const note = input.note === '' ? null : optionalLiteralText(input.note, invalidTransferInput);

  return parsePreviewTransferIntent({
    schemaVersion: RECORD_SCHEMA_VERSION,
    intentId,
    kind: 'CREATE_TRANSFER',
    state: 'PENDING',
    createdAt,
    payload: {
      type: 'TRANSFER',
      occurredOn: canonicalDate(input.occurredOn, invalidTransferInput),
      amountMinor: parsePreviewTransferAmountMinor(input.amount),
      currency: 'RUB',
      fromAccount,
      toAccount,
      flowKind: null,
      description,
      note,
    },
  });
}

export function parsePreviewExpenseIntent(value) {
  if (!exactKeys(value, ['schemaVersion', 'intentId', 'kind', 'state', 'createdAt', 'payload'])) invalidRecord();
  if ((value.schemaVersion !== RECORD_SCHEMA_VERSION && value.schemaVersion !== EXPENSE_RECORD_SCHEMA_VERSION)
    || value.kind !== 'CREATE_EXPENSE' || value.state !== 'PENDING') invalidRecord();
  const intentId = canonicalUuid(value.intentId, invalidRecord);
  const createdAt = canonicalTimestamp(value.createdAt, invalidRecord);
  const legacy = value.schemaVersion === RECORD_SCHEMA_VERSION;
  const payloadKeys = legacy
    ? ['type', 'occurredOn', 'amountMinor', 'currency', 'fromAccount', 'category', 'description', 'note']
    : ['type', 'occurredOn', 'amountMinor', 'currency', 'fromAccount', 'category', 'paidByMember', 'description', 'note'];
  if (!exactKeys(value.payload, payloadKeys)) invalidRecord();
  if (value.payload.type !== 'EXPENSE' || value.payload.currency !== 'RUB') invalidRecord();
  if (!Number.isSafeInteger(value.payload.amountMinor) || value.payload.amountMinor <= 0) invalidRecord();
  const occurredOn = canonicalDate(value.payload.occurredOn, invalidRecord);
  const fromAccount = entityRef(value.payload.fromAccount, invalidRecord);
  const category = categoryRef(value.payload.category, 'EXPENSE', invalidRecord);
  const paidByMember = legacy ? undefined : optionalEntityRef(value.payload.paidByMember, invalidRecord);
  const description = optionalLiteralText(value.payload.description, invalidRecord);
  const note = optionalLiteralText(value.payload.note, invalidRecord);
  const payload = legacy
    ? Object.freeze({ type: 'EXPENSE', occurredOn, amountMinor: value.payload.amountMinor, currency: 'RUB', fromAccount, category, description, note })
    : Object.freeze({ type: 'EXPENSE', occurredOn, amountMinor: value.payload.amountMinor, currency: 'RUB', fromAccount, category, paidByMember, description, note });

  return Object.freeze({
    schemaVersion: value.schemaVersion,
    intentId,
    kind: 'CREATE_EXPENSE',
    state: 'PENDING',
    createdAt,
    payload,
  });
}

export function parsePreviewIncomeIntent(value) {
  if (!exactKeys(value, ['schemaVersion', 'intentId', 'kind', 'state', 'createdAt', 'payload'])) invalidRecord();
  if (value.schemaVersion !== RECORD_SCHEMA_VERSION || value.kind !== 'CREATE_INCOME' || value.state !== 'PENDING') invalidRecord();
  const intentId = canonicalUuid(value.intentId, invalidRecord);
  const createdAt = canonicalTimestamp(value.createdAt, invalidRecord);
  if (!exactKeys(value.payload, ['type', 'occurredOn', 'amountMinor', 'currency', 'toAccount', 'category', 'description', 'note'])) invalidRecord();
  if (value.payload.type !== 'INCOME' || value.payload.currency !== 'RUB') invalidRecord();
  if (!Number.isSafeInteger(value.payload.amountMinor) || value.payload.amountMinor <= 0) invalidRecord();
  const occurredOn = canonicalDate(value.payload.occurredOn, invalidRecord);
  const toAccount = entityRef(value.payload.toAccount, invalidRecord);
  const category = categoryRef(value.payload.category, 'INCOME', invalidRecord);
  const description = optionalLiteralText(value.payload.description, invalidRecord);
  const note = optionalLiteralText(value.payload.note, invalidRecord);

  return Object.freeze({
    schemaVersion: RECORD_SCHEMA_VERSION,
    intentId,
    kind: 'CREATE_INCOME',
    state: 'PENDING',
    createdAt,
    payload: Object.freeze({
      type: 'INCOME',
      occurredOn,
      amountMinor: value.payload.amountMinor,
      currency: 'RUB',
      toAccount,
      category,
      description,
      note,
    }),
  });
}

export function parsePreviewTransferIntent(value) {
  if (!exactKeys(value, ['schemaVersion', 'intentId', 'kind', 'state', 'createdAt', 'payload'])) invalidRecord();
  if (value.schemaVersion !== RECORD_SCHEMA_VERSION || value.kind !== 'CREATE_TRANSFER' || value.state !== 'PENDING') invalidRecord();
  const intentId = canonicalUuid(value.intentId, invalidRecord);
  const createdAt = canonicalTimestamp(value.createdAt, invalidRecord);
  if (!exactKeys(value.payload, ['type', 'occurredOn', 'amountMinor', 'currency', 'fromAccount', 'toAccount', 'flowKind', 'description', 'note'])) invalidRecord();
  if (value.payload.type !== 'TRANSFER' || value.payload.currency !== 'RUB' || value.payload.flowKind !== null) invalidRecord();
  if (!Number.isSafeInteger(value.payload.amountMinor) || value.payload.amountMinor <= 0) invalidRecord();
  const occurredOn = canonicalDate(value.payload.occurredOn, invalidRecord);
  const fromAccount = entityRef(value.payload.fromAccount, invalidRecord);
  const toAccount = entityRef(value.payload.toAccount, invalidRecord);
  if (fromAccount.id === toAccount.id) invalidRecord();
  const description = optionalLiteralText(value.payload.description, invalidRecord);
  const note = optionalLiteralText(value.payload.note, invalidRecord);

  return Object.freeze({
    schemaVersion: RECORD_SCHEMA_VERSION,
    intentId,
    kind: 'CREATE_TRANSFER',
    state: 'PENDING',
    createdAt,
    payload: Object.freeze({
      type: 'TRANSFER',
      occurredOn,
      amountMinor: value.payload.amountMinor,
      currency: 'RUB',
      fromAccount,
      toAccount,
      flowKind: null,
      description,
      note,
    }),
  });
}

export function parsePreviewIntent(value) {
  if (value?.kind === 'CREATE_EXPENSE') return parsePreviewExpenseIntent(value);
  if (value?.kind === 'CREATE_INCOME') return parsePreviewIncomeIntent(value);
  if (value?.kind === 'CREATE_TRANSFER') return parsePreviewTransferIntent(value);
  invalidRecord();
}

function parsePreviewDraft(value, { draftKey, fail }) {
  if (!exactKeys(value, ['schemaVersion', 'draftKey', 'savedAt', 'amount', 'occurredOn', 'accountId', 'categoryId', 'description', 'note'])) fail();
  if (value.schemaVersion !== DRAFT_SCHEMA_VERSION || value.draftKey !== draftKey) fail();
  const savedAt = canonicalTimestamp(value.savedAt, fail);
  return Object.freeze({
    schemaVersion: DRAFT_SCHEMA_VERSION,
    draftKey,
    savedAt,
    amount: literalDraftField(value.amount, fail),
    occurredOn: literalDraftField(value.occurredOn, fail),
    accountId: literalDraftField(value.accountId, fail),
    categoryId: literalDraftField(value.categoryId, fail),
    description: literalDraftField(value.description, fail),
    note: literalDraftField(value.note, fail),
  });
}

function createPreviewDraft(input, { now, draftKey, parseDraft, fail }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail();
  return parseDraft({
    schemaVersion: DRAFT_SCHEMA_VERSION,
    draftKey,
    savedAt: now(),
    amount: input.amount,
    occurredOn: input.occurredOn,
    accountId: input.accountId,
    categoryId: input.categoryId,
    description: input.description,
    note: input.note,
  });
}

export function createPreviewExpenseDraft(input, { now = () => new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalidExpenseDraft();
  return parsePreviewExpenseDraft({
    schemaVersion: EXPENSE_DRAFT_SCHEMA_VERSION,
    draftKey: EXPENSE_DRAFT_KEY,
    savedAt: now(),
    amount: input.amount,
    occurredOn: input.occurredOn,
    accountId: input.accountId,
    categoryId: input.categoryId,
    paidByMemberId: input.paidByMemberId,
    description: input.description,
    note: input.note,
  });
}

export function createPreviewIncomeDraft(input, { now = () => new Date().toISOString() } = {}) {
  return createPreviewDraft(input, {
    now,
    draftKey: INCOME_DRAFT_KEY,
    parseDraft: parsePreviewIncomeDraft,
    fail: invalidIncomeDraft,
  });
}

export function parsePreviewExpenseDraft(value) {
  if (value?.schemaVersion === DRAFT_SCHEMA_VERSION) {
    return parsePreviewDraft(value, { draftKey: EXPENSE_DRAFT_KEY, fail: invalidExpenseDraft });
  }
  if (!exactKeys(value, ['schemaVersion', 'draftKey', 'savedAt', 'amount', 'occurredOn', 'accountId', 'categoryId', 'paidByMemberId', 'description', 'note'])) invalidExpenseDraft();
  if (value.schemaVersion !== EXPENSE_DRAFT_SCHEMA_VERSION || value.draftKey !== EXPENSE_DRAFT_KEY) invalidExpenseDraft();
  return Object.freeze({
    schemaVersion: EXPENSE_DRAFT_SCHEMA_VERSION,
    draftKey: EXPENSE_DRAFT_KEY,
    savedAt: canonicalTimestamp(value.savedAt, invalidExpenseDraft),
    amount: literalDraftField(value.amount, invalidExpenseDraft),
    occurredOn: literalDraftField(value.occurredOn, invalidExpenseDraft),
    accountId: literalDraftField(value.accountId, invalidExpenseDraft),
    categoryId: literalDraftField(value.categoryId, invalidExpenseDraft),
    paidByMemberId: literalDraftField(value.paidByMemberId, invalidExpenseDraft),
    description: literalDraftField(value.description, invalidExpenseDraft),
    note: literalDraftField(value.note, invalidExpenseDraft),
  });
}

export function parsePreviewIncomeDraft(value) {
  return parsePreviewDraft(value, { draftKey: INCOME_DRAFT_KEY, fail: invalidIncomeDraft });
}

function restorePreviewDraft(draft, { accounts, categories, categoryKind, parseDraft }) {
  const safe = parseDraft(draft);
  return Object.freeze({
    amount: safe.amount,
    occurredOn: safe.occurredOn,
    accountId: restorableAccountId(safe.accountId, accounts),
    categoryId: restorableCategoryId(safe.categoryId, categories, categoryKind),
    description: safe.description,
    note: safe.note,
  });
}

export function createPreviewTransferDraft(input, { now = () => new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalidTransferDraft();
  return parsePreviewTransferDraft({
    schemaVersion: DRAFT_SCHEMA_VERSION,
    draftKey: TRANSFER_DRAFT_KEY,
    savedAt: now(),
    amount: input.amount,
    occurredOn: input.occurredOn,
    fromAccountId: input.fromAccountId,
    toAccountId: input.toAccountId,
    description: input.description,
    note: input.note,
  });
}

export function parsePreviewTransferDraft(value) {
  if (!exactKeys(value, ['schemaVersion', 'draftKey', 'savedAt', 'amount', 'occurredOn', 'fromAccountId', 'toAccountId', 'description', 'note'])) invalidTransferDraft();
  if (value.schemaVersion !== DRAFT_SCHEMA_VERSION || value.draftKey !== TRANSFER_DRAFT_KEY) invalidTransferDraft();
  return Object.freeze({
    schemaVersion: DRAFT_SCHEMA_VERSION,
    draftKey: TRANSFER_DRAFT_KEY,
    savedAt: canonicalTimestamp(value.savedAt, invalidTransferDraft),
    amount: literalDraftField(value.amount, invalidTransferDraft),
    occurredOn: literalDraftField(value.occurredOn, invalidTransferDraft),
    fromAccountId: literalDraftField(value.fromAccountId, invalidTransferDraft),
    toAccountId: literalDraftField(value.toAccountId, invalidTransferDraft),
    description: literalDraftField(value.description, invalidTransferDraft),
    note: literalDraftField(value.note, invalidTransferDraft),
  });
}

export function restorePreviewTransferDraft(draft, { accounts } = {}) {
  const safe = parsePreviewTransferDraft(draft);
  return Object.freeze({
    amount: safe.amount,
    occurredOn: safe.occurredOn,
    fromAccountId: restorableAccountId(safe.fromAccountId, accounts),
    toAccountId: restorableAccountId(safe.toAccountId, accounts),
    description: safe.description,
    note: safe.note,
  });
}

export function restorePreviewExpenseDraft(draft, { accounts, categories, members } = {}) {
  const safe = parsePreviewExpenseDraft(draft);
  return Object.freeze({
    amount: safe.amount,
    occurredOn: safe.occurredOn,
    accountId: restorableAccountId(safe.accountId, accounts),
    categoryId: restorableCategoryId(safe.categoryId, categories, 'EXPENSE'),
    paidByMemberId: safe.schemaVersion === DRAFT_SCHEMA_VERSION ? '' : restorableMemberId(safe.paidByMemberId, members),
    description: safe.description,
    note: safe.note,
  });
}

export function restorePreviewIncomeDraft(draft, { accounts, categories } = {}) {
  return restorePreviewDraft(draft, {
    accounts,
    categories,
    categoryKind: 'INCOME',
    parseDraft: parsePreviewIncomeDraft,
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
        valid.push(parsePreviewIntent(row));
      } catch {
        // Malformed or unknown durable preview evidence is ignored and never counted as valid pending intent.
      }
    }
    return Object.freeze(valid);
  }

  return Object.freeze({
    async enqueue(intent) {
      const safe = parsePreviewIntent(intent);
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

function createIndexedDbPreviewDraftStoreFor(indexedDb, { draftKey, parseDraft }) {
  const withStore = createStoreAccess(indexedDb);
  return Object.freeze({
    async save(draft) {
      const safe = parseDraft(draft);
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
        row = await withStore(DRAFT_STORE_NAME, 'readonly', (store) => requestResult(store.get(draftKey)));
      } catch {
        throw new Error('PREVIEW_DRAFT_READ_FAILED');
      }
      if (row === undefined) return null;
      try {
        return parseDraft(row);
      } catch {
        return null;
      }
    },
    async clear() {
      try {
        await withStore(DRAFT_STORE_NAME, 'readwrite', (store) => requestResult(store.delete(draftKey)));
      } catch {
        throw new Error('PREVIEW_DRAFT_CLEAR_FAILED');
      }
    },
  });
}

export function createIndexedDbPreviewDraftStore(indexedDb = globalThis.indexedDB) {
  return createIndexedDbPreviewDraftStoreFor(indexedDb, {
    draftKey: EXPENSE_DRAFT_KEY,
    parseDraft: parsePreviewExpenseDraft,
  });
}

export function createIndexedDbPreviewIncomeDraftStore(indexedDb = globalThis.indexedDB) {
  return createIndexedDbPreviewDraftStoreFor(indexedDb, {
    draftKey: INCOME_DRAFT_KEY,
    parseDraft: parsePreviewIncomeDraft,
  });
}

export function createIndexedDbPreviewTransferDraftStore(indexedDb = globalThis.indexedDB) {
  return createIndexedDbPreviewDraftStoreFor(indexedDb, {
    draftKey: TRANSFER_DRAFT_KEY,
    parseDraft: parsePreviewTransferDraft,
  });
}

async function enqueuePreviewIntentThenClearDraft({ outbox, draftStore, intent }) {
  const saved = await outbox.enqueue(intent);
  try {
    await draftStore.clear();
    return Object.freeze({ intent: saved, draftCleared: true });
  } catch {
    return Object.freeze({ intent: saved, draftCleared: false });
  }
}

export async function enqueuePreviewExpenseThenClearDraft(args) {
  return enqueuePreviewIntentThenClearDraft(args);
}

export async function enqueuePreviewIncomeThenClearDraft(args) {
  return enqueuePreviewIntentThenClearDraft(args);
}

export async function enqueuePreviewTransferThenClearDraft(args) {
  return enqueuePreviewIntentThenClearDraft(args);
}

export const previewOutboxContract = Object.freeze({
  dbName: DB_NAME,
  dbVersion: DB_VERSION,
  storeName: OUTBOX_STORE_NAME,
  recordSchemaVersion: RECORD_SCHEMA_VERSION,
  expenseRecordSchemaVersion: EXPENSE_RECORD_SCHEMA_VERSION,
  draftStoreName: DRAFT_STORE_NAME,
  draftKey: EXPENSE_DRAFT_KEY,
  expenseDraftKey: EXPENSE_DRAFT_KEY,
  incomeDraftKey: INCOME_DRAFT_KEY,
  transferDraftKey: TRANSFER_DRAFT_KEY,
  draftSchemaVersion: DRAFT_SCHEMA_VERSION,
  expenseDraftSchemaVersion: EXPENSE_DRAFT_SCHEMA_VERSION,
});
