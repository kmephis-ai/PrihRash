import { parsePreviewExpenseAmountMinor } from './preview-writer-outbox.mjs';
import { syntheticPreviewEvidence } from './preview-transport.mjs';

function buildSyntheticExpenseEditReferences() {
  const membersById = new Map();
  for (const operation of syntheticPreviewEvidence.operations) {
    const member = operation.paidByMember;
    if (member === null) continue;
    if (!member || typeof member.id !== 'string' || typeof member.label !== 'string') fail('PREVIEW_EXPENSE_EDIT_REFERENCE_INVALID');
    const existing = membersById.get(member.id);
    if (existing && existing.label !== member.label) fail('PREVIEW_EXPENSE_EDIT_REFERENCE_INVALID');
    membersById.set(member.id, Object.freeze({ id: member.id, label: member.label }));
  }
  return Object.freeze({
    accounts: syntheticPreviewEvidence.accounts,
    categories: syntheticPreviewEvidence.categories,
    members: Object.freeze([...membersById.values()]),
  });
}

const syntheticExpenseEditReferences = buildSyntheticExpenseEditReferences();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const EDITABLE_FIELDS = Object.freeze([
  'occurredOn',
  'amount',
  'fromAccountId',
  'categoryId',
  'paidByMemberId',
  'description',
  'note',
]);
const TRANSACTION_KEYS = Object.freeze([
  'type',
  'occurredOn',
  'recordGranularity',
  'datePrecision',
  'aggregatePeriodMonth',
  'financialPeriodId',
  'periodAssignmentQuality',
  'amountMinor',
  'currency',
  'fromAccountId',
  'toAccountId',
  'categoryId',
  'paidByMemberId',
  'description',
  'note',
  'status',
  'analyticsState',
  'flowKind',
]);

function fail(code) {
  throw new Error(code);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function canonicalUuid(value, code = 'PREVIEW_EXPENSE_EDIT_EVIDENCE_INVALID') {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail(code);
  return value;
}

function positiveVersion(value, code = 'PREVIEW_EXPENSE_EDIT_EVIDENCE_INVALID') {
  if (!Number.isSafeInteger(value) || value <= 0) fail(code);
  return value;
}

function canonicalDate(value, code = 'PREVIEW_EXPENSE_EDIT_EVIDENCE_INVALID') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) fail(code);
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) fail(code);
  return value;
}

function canonicalText(value, code = 'PREVIEW_EXPENSE_EDIT_EVIDENCE_INVALID') {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0 || value !== value.trim()) fail(code);
  return value;
}

function exactRef(id, refs, predicate = () => true, code = 'PREVIEW_EXPENSE_EDIT_REFERENCE_INVALID') {
  canonicalUuid(id, code);
  if (!Array.isArray(refs)) fail(code);
  const matches = refs.filter((item) => item?.id === id);
  if (matches.length !== 1 || !predicate(matches[0])) fail(code);
  const ref = matches[0];
  if (typeof ref.label !== 'string' || ref.label.length === 0 || ref.label !== ref.label.trim()) fail(code);
  return ref;
}

function exactOptionalMember(id, members, code = 'PREVIEW_EXPENSE_EDIT_REFERENCE_INVALID') {
  if (id === null) return null;
  return exactRef(id, members, () => true, code);
}

function formatAmountMinor(amountMinor) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) fail('PREVIEW_EXPENSE_EDIT_EVIDENCE_INVALID');
  const whole = Math.floor(amountMinor / 100);
  const fraction = String(amountMinor % 100).padStart(2, '0');
  return `${whole},${fraction}`;
}

function validateVersionedExpense(value, references, { transactionId = null, version = null } = {}) {
  if (!exactKeys(value, ['id', 'version', 'transaction'])) fail('PREVIEW_EXPENSE_EDIT_EVIDENCE_INVALID');
  const id = canonicalUuid(value.id);
  const currentVersion = positiveVersion(value.version);
  if (transactionId !== null && id !== transactionId) fail('PREVIEW_EXPENSE_EDIT_EVIDENCE_INVALID');
  if (version !== null && currentVersion !== version) fail('PREVIEW_EXPENSE_EDIT_EVIDENCE_INVALID');

  const tx = value.transaction;
  if (!exactKeys(tx, TRANSACTION_KEYS)) fail('PREVIEW_EXPENSE_EDIT_EVIDENCE_INVALID');
  if (
    tx.type !== 'EXPENSE'
    || tx.recordGranularity !== 'TRANSACTION'
    || tx.datePrecision !== 'DAY'
    || tx.aggregatePeriodMonth !== null
    || tx.status !== 'POSTED'
    || tx.currency !== 'RUB'
    || tx.toAccountId !== null
    || tx.flowKind !== null
  ) fail('PREVIEW_EXPENSE_EDIT_EVIDENCE_INVALID');
  canonicalDate(tx.occurredOn);
  if (!Number.isSafeInteger(tx.amountMinor) || tx.amountMinor <= 0) fail('PREVIEW_EXPENSE_EDIT_EVIDENCE_INVALID');
  exactRef(tx.fromAccountId, references.accounts);
  exactRef(tx.categoryId, references.categories, (item) => item.kind === 'EXPENSE');
  exactOptionalMember(tx.paidByMemberId, references.members);
  canonicalText(tx.description);
  canonicalText(tx.note);
  if (!['EXPLICIT', 'DERIVED', 'LEGACY_AMBIGUOUS', 'UNASSIGNED'].includes(tx.periodAssignmentQuality)) {
    fail('PREVIEW_EXPENSE_EDIT_EVIDENCE_INVALID');
  }
  if (tx.financialPeriodId !== null) canonicalUuid(tx.financialPeriodId);
  if (!['INCLUDED', 'EXCLUDED'].includes(tx.analyticsState)) fail('PREVIEW_EXPENSE_EDIT_EVIDENCE_INVALID');

  return Object.freeze({ id, version: currentVersion, transaction: Object.freeze({ ...tx }) });
}

function formValuesFromCurrent(current) {
  const tx = current.transaction;
  return Object.freeze({
    occurredOn: tx.occurredOn,
    amount: formatAmountMinor(tx.amountMinor),
    fromAccountId: tx.fromAccountId,
    categoryId: tx.categoryId,
    paidByMemberId: tx.paidByMemberId,
    description: tx.description ?? '',
    note: tx.note ?? '',
  });
}

function validateDraft(values, references) {
  if (!exactKeys(values, EDITABLE_FIELDS)) fail('INVALID_PREVIEW_EXPENSE_EDIT_INPUT');
  canonicalDate(values.occurredOn, 'INVALID_PREVIEW_EXPENSE_EDIT_INPUT');
  let amountMinor;
  try {
    amountMinor = parsePreviewExpenseAmountMinor(values.amount);
  } catch {
    fail('INVALID_PREVIEW_EXPENSE_EDIT_INPUT');
  }
  exactRef(values.fromAccountId, references.accounts, () => true, 'INVALID_PREVIEW_EXPENSE_EDIT_INPUT');
  exactRef(values.categoryId, references.categories, (item) => item.kind === 'EXPENSE', 'INVALID_PREVIEW_EXPENSE_EDIT_INPUT');
  if (values.paidByMemberId !== null) {
    exactRef(values.paidByMemberId, references.members, () => true, 'INVALID_PREVIEW_EXPENSE_EDIT_INPUT');
  }
  const description = values.description === '' ? null : canonicalText(values.description, 'INVALID_PREVIEW_EXPENSE_EDIT_INPUT');
  const note = values.note === '' ? null : canonicalText(values.note, 'INVALID_PREVIEW_EXPENSE_EDIT_INPUT');
  return Object.freeze({
    occurredOn: values.occurredOn,
    amountMinor,
    currency: 'RUB',
    fromAccountId: values.fromAccountId,
    categoryId: values.categoryId,
    paidByMemberId: values.paidByMemberId,
    description,
    note,
  });
}

function frozenState(state) {
  return Object.freeze({
    ...state,
    values: Object.freeze({ ...state.values }),
    conflict: state.conflict === null ? null : Object.freeze({
      currentVersion: state.conflict.currentVersion,
      currentValues: Object.freeze({ ...state.conflict.currentValues }),
      localValues: Object.freeze({ ...state.conflict.localValues }),
    }),
  });
}

export function createPreviewExpenseEditController({
  initial,
  references,
  submitExpenseEdit,
  readCurrentExpense,
}) {
  if (typeof submitExpenseEdit !== 'function' || typeof readCurrentExpense !== 'function') {
    fail('PREVIEW_EXPENSE_EDIT_PORT_REQUIRED');
  }
  const validatedInitial = validateVersionedExpense(initial, references);
  let state = frozenState({
    status: 'READY',
    transactionId: validatedInitial.id,
    expectedVersion: validatedInitial.version,
    values: formValuesFromCurrent(validatedInitial),
    conflict: null,
    message: `Версия ${validatedInitial.version} · готово к редактированию`,
  });

  function getState() {
    return state;
  }

  function replaceValues(values) {
    if (state.status === 'SAVING' || state.conflict !== null) fail('PREVIEW_EXPENSE_EDIT_ACTION_BLOCKED');
    state = frozenState({ ...state, status: 'READY', values, message: `Версия ${state.expectedVersion} · есть локальные изменения` });
    return state;
  }

  function updateValue(name, value) {
    if (!EDITABLE_FIELDS.includes(name)) fail('PREVIEW_EXPENSE_EDIT_FIELD_INVALID');
    const next = { ...state.values, [name]: value };
    return replaceValues(next);
  }

  async function save() {
    if (state.status === 'SAVING' || state.conflict !== null) fail('PREVIEW_EXPENSE_EDIT_ACTION_BLOCKED');
    const parsed = validateDraft(state.values, references);
    const request = Object.freeze({
      transactionId: state.transactionId,
      expectedVersion: state.expectedVersion,
      ...parsed,
    });
    state = frozenState({ ...state, status: 'SAVING', message: 'Сохраняем изменения · демо…' });

    let response;
    try {
      response = await submitExpenseEdit(request);
    } catch {
      state = frozenState({ ...state, status: 'DEGRADED', message: 'Не удалось сохранить изменения · демо' });
      return state;
    }

    if (response?.outcome === 'UPDATED') {
      if (
        !exactKeys(response, ['apiVersion', 'outcome', 'transactionId', 'version'])
        || response.apiVersion !== 1
        || response.transactionId !== state.transactionId
        || response.version !== state.expectedVersion + 1
      ) {
        state = frozenState({ ...state, status: 'DEGRADED', message: 'Ответ сохранения не прошёл проверку · демо' });
        return state;
      }
      state = frozenState({
        ...state,
        status: 'UPDATED',
        expectedVersion: response.version,
        conflict: null,
        message: `Сохранено · версия ${response.version} · демо`,
      });
      return state;
    }

    if (
      response?.outcome !== 'VERSION_CONFLICT'
      || !exactKeys(response, ['apiVersion', 'outcome', 'transactionId', 'currentVersion'])
      || response.apiVersion !== 1
      || response.transactionId !== state.transactionId
      || !Number.isSafeInteger(response.currentVersion)
      || response.currentVersion <= state.expectedVersion
    ) {
      state = frozenState({ ...state, status: 'DEGRADED', message: 'Ответ сохранения не прошёл проверку · демо' });
      return state;
    }

    const localValues = Object.freeze({ ...state.values });
    let current;
    try {
      current = await readCurrentExpense(state.transactionId);
      current = validateVersionedExpense(current, references, {
        transactionId: state.transactionId,
        version: response.currentVersion,
      });
    } catch {
      state = frozenState({
        ...state,
        status: 'DEGRADED',
        values: localValues,
        conflict: null,
        message: 'Есть конфликт версий, но актуальную запись проверить не удалось · мои изменения сохранены в форме',
      });
      return state;
    }

    state = frozenState({
      ...state,
      status: 'CONFLICT',
      values: localValues,
      conflict: {
        currentVersion: current.version,
        currentValues: formValuesFromCurrent(current),
        localValues,
      },
      message: `Обнаружена более новая версия ${current.version}. Ничего не перезаписано.`,
    });
    return state;
  }

  function acceptCurrent() {
    if (state.status !== 'CONFLICT' || state.conflict === null) fail('PREVIEW_EXPENSE_EDIT_ACTION_BLOCKED');
    state = frozenState({
      ...state,
      status: 'READY',
      expectedVersion: state.conflict.currentVersion,
      values: state.conflict.currentValues,
      conflict: null,
      message: `Принята актуальная версия ${state.conflict.currentVersion} · демо`,
    });
    return state;
  }

  function keepMineOnCurrent() {
    if (state.status !== 'CONFLICT' || state.conflict === null) fail('PREVIEW_EXPENSE_EDIT_ACTION_BLOCKED');
    state = frozenState({
      ...state,
      status: 'READY',
      expectedVersion: state.conflict.currentVersion,
      values: state.conflict.localValues,
      conflict: null,
      message: `Мои изменения оставлены поверх версии ${state.conflict.currentVersion}. Нажмите «Сохранить изменения» ещё раз.`,
    });
    return state;
  }

  return Object.freeze({ getState, updateValue, save, acceptCurrent, keepMineOnCurrent });
}

function canonicalFromPreviewOperation(operation) {
  return Object.freeze({
    id: operation.id,
    version: operation.version,
    transaction: Object.freeze({
      type: operation.type,
      occurredOn: operation.occurredOn,
      recordGranularity: operation.recordGranularity,
      datePrecision: operation.datePrecision,
      aggregatePeriodMonth: operation.aggregatePeriodMonth,
      financialPeriodId: operation.financialPeriodId,
      periodAssignmentQuality: operation.periodAssignmentQuality,
      amountMinor: operation.amountMinor,
      currency: operation.currency,
      fromAccountId: operation.fromAccount?.id ?? null,
      toAccountId: operation.toAccount?.id ?? null,
      categoryId: operation.category?.id ?? null,
      paidByMemberId: operation.paidByMember?.id ?? null,
      description: operation.description,
      note: operation.note,
      status: operation.status,
      analyticsState: operation.analyticsState,
      flowKind: operation.flowKind,
    }),
  });
}

export function createSyntheticPreviewExpenseEditPorts(initial) {
  const validated = validateVersionedExpense(initial, syntheticExpenseEditReferences);
  let remote = validated;
  let firstAttempt = true;
  return Object.freeze({
    async submitExpenseEdit(request) {
      if (firstAttempt) {
        firstAttempt = false;
        remote = Object.freeze({
          id: remote.id,
          version: remote.version + 1,
          transaction: Object.freeze({
            ...remote.transaction,
            description: 'Изменено в другом окне · демо',
            note: 'Актуальная версия для проверки конфликта · демо',
          }),
        });
        return Object.freeze({ apiVersion: 1, outcome: 'VERSION_CONFLICT', transactionId: remote.id, currentVersion: remote.version });
      }
      if (request.expectedVersion !== remote.version) {
        return Object.freeze({ apiVersion: 1, outcome: 'VERSION_CONFLICT', transactionId: remote.id, currentVersion: remote.version });
      }
      remote = Object.freeze({
        id: remote.id,
        version: remote.version + 1,
        transaction: Object.freeze({
          ...remote.transaction,
          occurredOn: request.occurredOn,
          amountMinor: request.amountMinor,
          fromAccountId: request.fromAccountId,
          categoryId: request.categoryId,
          paidByMemberId: request.paidByMemberId,
          description: request.description,
          note: request.note,
        }),
      });
      return Object.freeze({ apiVersion: 1, outcome: 'UPDATED', transactionId: remote.id, version: remote.version });
    },
    async readCurrentExpense(transactionId) {
      return transactionId === remote.id ? remote : null;
    },
  });
}

function optionMarkup(items, { emptyLabel = null } = {}) {
  const empty = emptyLabel === null ? '' : `<option value="">${emptyLabel}</option>`;
  return `${empty}${items.map((item) => `<option value="${item.id}">${item.label}</option>`).join('')}`;
}

function panelMarkup() {
  const accounts = syntheticExpenseEditReferences.accounts;
  const categories = syntheticExpenseEditReferences.categories.filter((item) => item.kind === 'EXPENSE');
  const members = syntheticExpenseEditReferences.members;
  return `
    <section class="panel preview-expense-edit" data-preview-expense-edit>
      <div class="section-head">
        <div><span class="eyebrow">R3A · synthetic only</span><h2>Редактирование расхода · демо</h2></div>
        <span data-preview-expense-edit-version></span>
      </div>
      <p class="preview-writer__notice">Первое сохранение намеренно моделирует конфликт версии. Демо ничего не перезаписывает автоматически: решение всегда принимает пользователь.</p>
      <form class="preview-writer__form" data-preview-expense-edit-form novalidate>
        <label class="preview-writer__field"><span>Сумма, ₽</span><input name="amount" inputmode="decimal" autocomplete="off" required></label>
        <label class="preview-writer__field"><span>Дата</span><input name="occurredOn" type="date" required></label>
        <label class="preview-writer__field"><span>Счёт списания</span><select name="fromAccountId" required>${optionMarkup(accounts)}</select></label>
        <label class="preview-writer__field"><span>Категория расхода</span><select name="categoryId" required>${optionMarkup(categories)}</select></label>
        <label class="preview-writer__field"><span>Кто оплатил</span><select name="paidByMemberId">${optionMarkup(members, { emptyLabel: 'Не указан' })}</select></label>
        <label class="preview-writer__field preview-writer__field--wide"><span>Описание</span><input name="description" autocomplete="off"></label>
        <label class="preview-writer__field preview-writer__field--wide"><span>Заметка</span><textarea name="note" rows="2"></textarea></label>
        <div class="preview-writer__actions">
          <button type="submit" data-preview-expense-edit-save>Сохранить изменения</button>
        </div>
        <p class="preview-writer__status" data-preview-expense-edit-status role="status" aria-live="polite" aria-atomic="true"></p>
      </form>
      <section class="preview-expense-edit__conflict" data-preview-expense-edit-conflict hidden aria-labelledby="preview-expense-conflict-title">
        <div class="preview-expense-edit__conflict-head">
          <div><span class="eyebrow">Конфликт версии</span><h3 id="preview-expense-conflict-title">Ничего не перезаписано</h3></div>
          <span data-preview-expense-edit-current-version></span>
        </div>
        <div class="preview-expense-edit__compare">
          <div><h4>Мои изменения</h4><dl data-preview-expense-edit-local></dl></div>
          <div><h4>Актуальная версия</h4><dl data-preview-expense-edit-current></dl></div>
        </div>
        <div class="preview-expense-edit__conflict-actions">
          <button type="button" data-preview-expense-edit-accept>Принять актуальную версию</button>
          <button type="button" data-preview-expense-edit-rebase>Оставить мои изменения поверх актуальной</button>
        </div>
      </section>
    </section>`;
}

function formValues(form) {
  const value = (name) => {
    const field = form.elements.namedItem(name);
    if (!field || typeof field.value !== 'string') fail('PREVIEW_EXPENSE_EDIT_FORM_INVALID');
    return field.value;
  };
  const payer = value('paidByMemberId');
  return Object.freeze({
    occurredOn: value('occurredOn'),
    amount: value('amount'),
    fromAccountId: value('fromAccountId'),
    categoryId: value('categoryId'),
    paidByMemberId: payer === '' ? null : payer,
    description: value('description'),
    note: value('note'),
  });
}

function writeForm(form, values) {
  for (const name of EDITABLE_FIELDS) {
    const field = form.elements.namedItem(name);
    if (!field || typeof field.value !== 'string') fail('PREVIEW_EXPENSE_EDIT_FORM_INVALID');
    field.value = values[name] ?? '';
  }
}

function labelForValue(name, value) {
  if (name === 'fromAccountId') return exactRef(value, syntheticExpenseEditReferences.accounts).label;
  if (name === 'categoryId') return exactRef(value, syntheticExpenseEditReferences.categories, (item) => item.kind === 'EXPENSE').label;
  if (name === 'paidByMemberId') return value === null ? 'Не указан' : exactRef(value, syntheticExpenseEditReferences.members).label;
  if (name === 'description' || name === 'note') return value === '' ? '—' : value;
  return value;
}

const FIELD_LABELS = Object.freeze({
  occurredOn: 'Дата',
  amount: 'Сумма, ₽',
  fromAccountId: 'Счёт списания',
  categoryId: 'Категория',
  paidByMemberId: 'Кто оплатил',
  description: 'Описание',
  note: 'Заметка',
});

function renderComparison(container, values) {
  container.replaceChildren();
  for (const name of EDITABLE_FIELDS) {
    const dt = container.ownerDocument.createElement('dt');
    dt.textContent = FIELD_LABELS[name];
    const dd = container.ownerDocument.createElement('dd');
    dd.textContent = labelForValue(name, values[name]);
    container.append(dt, dd);
  }
}

export async function mountSyntheticPreviewExpenseEdit({
  document = globalThis.document,
  initial = null,
  submitExpenseEdit = null,
  readCurrentExpense = null,
} = {}) {
  if (!document?.querySelector) fail('PREVIEW_EXPENSE_EDIT_DOCUMENT_REQUIRED');
  if (document.querySelector('[data-preview-expense-edit]')) return;
  const main = document.querySelector('main');
  if (!main) fail('PREVIEW_EXPENSE_EDIT_MAIN_REQUIRED');

  const operation = syntheticPreviewEvidence.operations.find((item) => (
    item.type === 'EXPENSE'
    && item.recordGranularity === 'TRANSACTION'
    && item.datePrecision === 'DAY'
    && item.status === 'POSTED'
  ));
  const startingCurrent = initial ?? canonicalFromPreviewOperation(operation);
  const defaultPorts = createSyntheticPreviewExpenseEditPorts(startingCurrent);
  const controller = createPreviewExpenseEditController({
    initial: startingCurrent,
    references: syntheticExpenseEditReferences,
    submitExpenseEdit: submitExpenseEdit ?? defaultPorts.submitExpenseEdit,
    readCurrentExpense: readCurrentExpense ?? defaultPorts.readCurrentExpense,
  });

  main.insertAdjacentHTML('beforeend', panelMarkup());
  const panel = document.querySelector('[data-preview-expense-edit]');
  const form = panel.querySelector('[data-preview-expense-edit-form]');
  const status = panel.querySelector('[data-preview-expense-edit-status]');
  const version = panel.querySelector('[data-preview-expense-edit-version]');
  const saveButton = panel.querySelector('[data-preview-expense-edit-save]');
  const conflictPanel = panel.querySelector('[data-preview-expense-edit-conflict]');
  const currentVersion = panel.querySelector('[data-preview-expense-edit-current-version]');
  const localCompare = panel.querySelector('[data-preview-expense-edit-local]');
  const currentCompare = panel.querySelector('[data-preview-expense-edit-current]');
  const acceptButton = panel.querySelector('[data-preview-expense-edit-accept]');
  const rebaseButton = panel.querySelector('[data-preview-expense-edit-rebase]');
  if (!form || !status || !version || !saveButton || !conflictPanel || !currentVersion || !localCompare || !currentCompare || !acceptButton || !rebaseButton) {
    fail('PREVIEW_EXPENSE_EDIT_MARKUP_INVALID');
  }

  const render = () => {
    const state = controller.getState();
    writeForm(form, state.values);
    status.textContent = state.message;
    version.textContent = `Версия ${state.expectedVersion}`;
    const conflict = state.conflict;
    conflictPanel.hidden = conflict === null;
    saveButton.disabled = state.status === 'SAVING' || conflict !== null;
    for (const name of EDITABLE_FIELDS) {
      const field = form.elements.namedItem(name);
      if (field) field.disabled = conflict !== null || state.status === 'SAVING';
    }
    if (conflict !== null) {
      currentVersion.textContent = `Актуальная версия ${conflict.currentVersion}`;
      renderComparison(localCompare, conflict.localValues);
      renderComparison(currentCompare, conflict.currentValues);
    }
  };

  writeForm(form, controller.getState().values);
  form.addEventListener('input', (event) => {
    const name = event.target?.name;
    if (!EDITABLE_FIELDS.includes(name)) return;
    const value = name === 'paidByMemberId' && event.target.value === '' ? null : event.target.value;
    try {
      controller.updateValue(name, value);
      status.textContent = controller.getState().message;
    } catch {
      status.textContent = 'Редактирование временно заблокировано до разрешения конфликта.';
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    let messageOverride = null;
    try {
      for (const [name, value] of Object.entries(formValues(form))) controller.updateValue(name, value);
      await controller.save();
    } catch (error) {
      messageOverride = error?.message === 'INVALID_PREVIEW_EXPENSE_EDIT_INPUT'
        ? 'Проверьте сумму, дату, ссылки и текстовые поля.'
        : 'Не удалось подготовить изменения · демо';
    }
    render();
    if (messageOverride !== null) status.textContent = messageOverride;
  });
  acceptButton.addEventListener('click', () => {
    controller.acceptCurrent();
    render();
  });
  rebaseButton.addEventListener('click', () => {
    controller.keepMineOnCurrent();
    render();
  });
  render();
  return controller;
}

export const previewExpenseEditContract = Object.freeze({ editableFields: EDITABLE_FIELDS });
