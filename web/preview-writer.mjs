import {
  createIndexedDbPreviewDraftStore,
  createIndexedDbPreviewIncomeDraftStore,
  createIndexedDbPreviewTransferDraftStore,
  createIndexedDbPreviewOutbox,
  createPreviewExpenseDraft,
  createPreviewExpenseIntent,
  createPreviewIncomeDraft,
  createPreviewIncomeIntent,
  createPreviewTransferDraft,
  createPreviewTransferIntent,
  enqueuePreviewExpenseThenClearDraft,
  enqueuePreviewIncomeThenClearDraft,
  enqueuePreviewTransferThenClearDraft,
  parsePreviewExpenseAmountMinor,
  parsePreviewIncomeAmountMinor,
  parsePreviewTransferAmountMinor,
  restorePreviewExpenseDraft,
  restorePreviewIncomeDraft,
  restorePreviewTransferDraft,
} from './preview-writer-outbox.mjs';
import { syntheticPreviewEvidence } from './preview-transport.mjs';

const DRAFT_STATUS = 'Черновик сохраняется локально · демо';
const OUTBOX_CHANGED_EVENT = 'prihrash:preview-outbox-changed';
const EDIT_PENDING_EVENT = 'prihrash:preview-edit-pending';
const FINANCIAL_TIME_ZONE = 'Europe/Moscow';

function buildSyntheticMemberReferences() {
  const byId = new Map();
  for (const operation of syntheticPreviewEvidence.operations) {
    const member = operation.paidByMember;
    if (member === null) continue;
    if (!member || typeof member.id !== 'string' || typeof member.label !== 'string') throw new Error('PREVIEW_WRITER_REFERENCE_INVALID');
    const existing = byId.get(member.id);
    if (existing && existing.label !== member.label) throw new Error('PREVIEW_WRITER_REFERENCE_INVALID');
    byId.set(member.id, Object.freeze({ id: member.id, label: member.label }));
  }
  return Object.freeze([...byId.values()]);
}

const SYNTHETIC_MEMBER_REFERENCES = buildSyntheticMemberReferences();

const WRITER_CONFIGS = Object.freeze({
  expense: Object.freeze({
    slug: 'expense',
    intentKind: 'CREATE_EXPENSE',
    categoryKind: 'EXPENSE',
    title: 'Новая операция · демо',
    accountLabel: 'Счёт списания',
    categoryLabel: 'Категория расхода',
    queueLabel: 'Ожидают отправки',
    invalidInputCode: 'INVALID_PREVIEW_EXPENSE_INPUT',
    payerEnabled: true,
    amountParser: parsePreviewExpenseAmountMinor,
    createDraft: createPreviewExpenseDraft,
    createIntent: createPreviewExpenseIntent,
    createDraftStore: createIndexedDbPreviewDraftStore,
    restoreDraft: restorePreviewExpenseDraft,
    enqueueThenClearDraft: enqueuePreviewExpenseThenClearDraft,
  }),
  income: Object.freeze({
    slug: 'income',
    intentKind: 'CREATE_INCOME',
    categoryKind: 'INCOME',
    title: 'Новая операция · демо',
    accountLabel: 'Счёт зачисления',
    categoryLabel: 'Категория дохода',
    queueLabel: 'Ожидают отправки',
    invalidInputCode: 'INVALID_PREVIEW_INCOME_INPUT',
    payerEnabled: false,
    amountParser: parsePreviewIncomeAmountMinor,
    createDraft: createPreviewIncomeDraft,
    createIntent: createPreviewIncomeIntent,
    createDraftStore: createIndexedDbPreviewIncomeDraftStore,
    restoreDraft: restorePreviewIncomeDraft,
    enqueueThenClearDraft: enqueuePreviewIncomeThenClearDraft,
  }),
});

function optionMarkup(items) {
  return items.map((item) => `<option value="${item.id}">${item.label}</option>`).join('');
}

function fieldError(name) {
  return `<span class="preview-writer__field-error" data-preview-field-error="${name}" aria-live="polite"></span>`;
}

function typeSwitchMarkup(active) {
  return `<div class="preview-writer__type-switch" role="tablist" aria-label="Тип новой операции">
    <button type="button" role="tab" data-preview-writer-type="expense" aria-selected="${active === 'expense'}">Расход</button>
    <button type="button" role="tab" data-preview-writer-type="income" aria-selected="${active === 'income'}">Доход</button>
  </div>`;
}

function panelMarkup(config) {
  const accounts = syntheticPreviewEvidence.accounts;
  const categories = syntheticPreviewEvidence.categories.filter((item) => item.kind === config.categoryKind);
  const payerField = config.payerEnabled
    ? `<label class="preview-writer__field"><span>Кто оплатил <small>необязательно</small></span><select name="paidByMemberId"><option value="">Не указан</option>${optionMarkup(SYNTHETIC_MEMBER_REFERENCES)}</select></label>`
    : '';
  return `
    <section class="panel preview-writer preview-writer--primary" data-preview-writer="${config.slug}"${config.slug === 'income' ? ' hidden' : ''}>
      <div class="section-head">
        <div><span class="eyebrow">R3A · synthetic only</span><h2>${config.title}</h2></div>
        <span>Только локально</span>
      </div>
      ${typeSwitchMarkup(config.slug)}
      <p class="preview-writer__notice">Сохранение происходит сразу на устройстве. Демо не отправляет реальные финансовые данные.</p>
      <form class="preview-writer__form" data-preview-${config.slug}-form novalidate>
        <label class="preview-writer__field"><span>Сумма, ₽ <b>*</b></span><input name="amount" inputmode="decimal" autocomplete="off" placeholder="0,00" required data-preview-money>${fieldError('amount')}</label>
        <label class="preview-writer__field"><span>Дата <b>*</b></span><input name="occurredOn" type="date" required>${fieldError('occurredOn')}</label>
        <label class="preview-writer__field"><span>${config.accountLabel} <b>*</b></span><select name="accountId" required><option value="">Выберите счёт</option>${optionMarkup(accounts)}</select>${fieldError('accountId')}</label>
        <label class="preview-writer__field"><span>${config.categoryLabel} <b>*</b></span><select name="categoryId" required><option value="">Выберите категорию</option>${optionMarkup(categories)}</select>${fieldError('categoryId')}</label>
        ${payerField}
        <label class="preview-writer__field preview-writer__field--wide"><span>Описание <b>*</b></span><input name="description" autocomplete="off" placeholder="Например, Продукты" required>${fieldError('description')}</label>
        <label class="preview-writer__field preview-writer__field--wide"><span>Заметка <small>необязательно</small></span><textarea name="note" rows="2" placeholder="Дополнительные детали"></textarea></label>
        <div class="preview-writer__actions">
          <button type="submit" data-preview-${config.slug}-save>Сохранить локально</button>
          <button type="button" class="preview-writer__cancel-edit" data-preview-${config.slug}-cancel-edit hidden>Отменить редактирование</button>
          <span data-preview-${config.slug}-pending-count>${config.queueLabel}: проверяем…</span>
        </div>
        <p class="preview-writer__status" data-preview-${config.slug}-writer-status role="status" aria-live="polite" aria-atomic="true">${DRAFT_STATUS}</p>
      </form>
    </section>`;
}

function transferPanelMarkup() {
  const accounts = syntheticPreviewEvidence.accounts;
  return `
    <details class="panel preview-writer preview-writer--transfer" data-preview-writer="transfer">
      <summary><span><span class="eyebrow">R3A · synthetic only</span><strong>Перевод между своими счетами · демо</strong></span><span>Редкая операция</span></summary>
      <p class="preview-writer__notice">Тип перевода не угадывается. Сохранение остаётся только локальным.</p>
      <form class="preview-writer__form" data-preview-transfer-form novalidate>
        <label class="preview-writer__field"><span>Сумма, ₽ <b>*</b></span><input name="amount" inputmode="decimal" autocomplete="off" placeholder="0,00" required data-preview-money>${fieldError('amount')}</label>
        <label class="preview-writer__field"><span>Дата <b>*</b></span><input name="occurredOn" type="date" required>${fieldError('occurredOn')}</label>
        <label class="preview-writer__field"><span>Счёт списания <b>*</b></span><select name="fromAccountId" required><option value="">Выберите счёт</option>${optionMarkup(accounts)}</select>${fieldError('fromAccountId')}</label>
        <label class="preview-writer__field"><span>Счёт зачисления <b>*</b></span><select name="toAccountId" required><option value="">Выберите счёт</option>${optionMarkup(accounts)}</select>${fieldError('toAccountId')}</label>
        <label class="preview-writer__field preview-writer__field--wide"><span>Описание <b>*</b></span><input name="description" autocomplete="off" placeholder="Например, В накопления" required>${fieldError('description')}</label>
        <label class="preview-writer__field preview-writer__field--wide"><span>Заметка <small>необязательно</small></span><textarea name="note" rows="2" placeholder="Дополнительные детали"></textarea></label>
        <div class="preview-writer__actions">
          <button type="submit" data-preview-transfer-save>Сохранить локально</button>
          <button type="button" class="preview-writer__cancel-edit" data-preview-transfer-cancel-edit hidden>Отменить редактирование</button>
          <span data-preview-transfer-pending-count>Ожидают отправки: проверяем…</span>
        </div>
        <p class="preview-writer__status" data-preview-transfer-writer-status role="status" aria-live="polite" aria-atomic="true">${DRAFT_STATUS}</p>
      </form>
    </details>`;
}

export function financialDateInMoscow(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('PREVIEW_WRITER_DATE_INVALID');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: FINANCIAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (!/^\d{4}$/u.test(byType.year ?? '') || !/^\d{2}$/u.test(byType.month ?? '') || !/^\d{2}$/u.test(byType.day ?? '')) {
    throw new Error('PREVIEW_WRITER_DATE_INVALID');
  }
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function formValue(form, name) {
  const field = form.elements.namedItem(name);
  if (!field || typeof field.value !== 'string') throw new Error('PREVIEW_WRITER_FORM_INVALID');
  return field.value;
}

function setFormValue(form, name, value) {
  const field = form.elements.namedItem(name);
  if (!field || typeof field.value !== 'string') throw new Error('PREVIEW_WRITER_FORM_INVALID');
  field.value = value;
}

function formInput(form, config) {
  const base = {
    amount: formValue(form, 'amount'),
    occurredOn: formValue(form, 'occurredOn'),
    accountId: formValue(form, 'accountId'),
    categoryId: formValue(form, 'categoryId'),
    description: formValue(form, 'description'),
    note: formValue(form, 'note'),
  };
  return config.payerEnabled ? { ...base, paidByMemberId: formValue(form, 'paidByMemberId') } : base;
}

function transferFormInput(form) {
  return {
    amount: formValue(form, 'amount'),
    occurredOn: formValue(form, 'occurredOn'),
    fromAccountId: formValue(form, 'fromAccountId'),
    toAccountId: formValue(form, 'toAccountId'),
    description: formValue(form, 'description'),
    note: formValue(form, 'note'),
  };
}

function restoreForm(form, values, config) {
  const names = ['amount', 'occurredOn', 'accountId', 'categoryId', 'description', 'note'];
  if (config.payerEnabled) names.splice(4, 0, 'paidByMemberId');
  for (const name of names) setFormValue(form, name, values[name]);
}

function restoreTransferForm(form, values) {
  for (const name of ['amount', 'occurredOn', 'fromAccountId', 'toAccountId', 'description', 'note']) setFormValue(form, name, values[name]);
}

function amountText(amountMinor) {
  const whole = Math.floor(amountMinor / 100);
  const fraction = String(amountMinor % 100).padStart(2, '0');
  return `${whole},${fraction}`;
}

function intentFormValues(intent) {
  if (intent.kind === 'CREATE_EXPENSE') return {
    amount: amountText(intent.payload.amountMinor),
    occurredOn: intent.payload.occurredOn,
    accountId: intent.payload.fromAccount.id,
    categoryId: intent.payload.category.id,
    paidByMemberId: intent.payload.paidByMember?.id ?? '',
    description: intent.payload.description ?? '',
    note: intent.payload.note ?? '',
  };
  if (intent.kind === 'CREATE_INCOME') return {
    amount: amountText(intent.payload.amountMinor),
    occurredOn: intent.payload.occurredOn,
    accountId: intent.payload.toAccount.id,
    categoryId: intent.payload.category.id,
    description: intent.payload.description ?? '',
    note: intent.payload.note ?? '',
  };
  if (intent.kind === 'CREATE_TRANSFER') return {
    amount: amountText(intent.payload.amountMinor),
    occurredOn: intent.payload.occurredOn,
    fromAccountId: intent.payload.fromAccount.id,
    toAccountId: intent.payload.toAccount.id,
    description: intent.payload.description ?? '',
    note: intent.payload.note ?? '',
  };
  throw new Error('PREVIEW_WRITER_EDIT_INTENT_INVALID');
}

function sanitizeMoneyInput(value) {
  const raw = String(value ?? '').replace(/[^0-9.,]/gu, '');
  const separatorIndex = raw.search(/[.,]/u);
  let whole = separatorIndex === -1 ? raw : raw.slice(0, separatorIndex);
  const fraction = separatorIndex === -1 ? '' : raw.slice(separatorIndex + 1).replace(/[.,]/gu, '').slice(0, 2);
  whole = whole.replace(/^0+(?=\d)/u, '') || (separatorIndex === -1 ? '' : '0');
  return separatorIndex === -1 ? whole : `${whole},${fraction}`;
}

function installMoneyGuard(form) {
  const field = form.elements.namedItem('amount');
  field?.addEventListener('input', () => {
    const safe = sanitizeMoneyInput(field.value);
    if (field.value !== safe) field.value = safe;
  });
}

function clearErrors(form) {
  for (const error of form.querySelectorAll('[data-preview-field-error]')) error.textContent = '';
  for (const field of form.querySelectorAll('[aria-invalid="true"]')) field.removeAttribute('aria-invalid');
}

function setError(form, name, message) {
  const field = form.elements.namedItem(name);
  const error = form.querySelector(`[data-preview-field-error="${name}"]`);
  field?.setAttribute('aria-invalid', 'true');
  if (error) error.textContent = message;
}

function validateCommon(form, { amountParser, accountName = 'accountId', categoryRequired = true }) {
  clearErrors(form);
  const errors = [];
  try { amountParser(formValue(form, 'amount')); } catch { errors.push(['amount', 'Введите сумму больше нуля.']); }
  if (!formValue(form, 'occurredOn')) errors.push(['occurredOn', 'Укажите дату.']);
  if (!formValue(form, accountName)) errors.push([accountName, 'Выберите счёт.']);
  if (categoryRequired && !formValue(form, 'categoryId')) errors.push(['categoryId', 'Выберите категорию.']);
  if (!formValue(form, 'description').trim()) errors.push(['description', 'Введите описание.']);
  for (const [name, message] of errors) setError(form, name, message);
  if (errors.length > 0) form.elements.namedItem(errors[0][0])?.focus?.();
  return errors.length === 0;
}

function validateTransfer(form) {
  const validCommon = validateCommon(form, { amountParser: parsePreviewTransferAmountMinor, accountName: 'fromAccountId', categoryRequired: false });
  let valid = validCommon;
  if (!formValue(form, 'toAccountId')) { setError(form, 'toAccountId', 'Выберите счёт.'); valid = false; }
  else if (formValue(form, 'fromAccountId') === formValue(form, 'toAccountId')) {
    setError(form, 'toAccountId', 'Счета должны различаться.'); valid = false;
  }
  return valid;
}

function activatePrimaryWriter(document, slug) {
  for (const panel of document.querySelectorAll('[data-preview-writer="expense"], [data-preview-writer="income"]')) {
    const active = panel.dataset.previewWriter === slug;
    panel.hidden = !active;
    for (const button of panel.querySelectorAll('[data-preview-writer-type]')) button.setAttribute('aria-selected', String(button.dataset.previewWriterType === slug));
  }
}

function wireTypeSwitch(document) {
  for (const button of document.querySelectorAll('[data-preview-writer-type]')) {
    if (button.dataset.previewWriterTypeWired === 'true') continue;
    button.dataset.previewWriterTypeWired = 'true';
    button.addEventListener('click', () => activatePrimaryWriter(document, button.dataset.previewWriterType));
  }
}

function dispatchOutboxChanged(document) {
  document.dispatchEvent(new CustomEvent(OUTBOX_CHANGED_EVENT));
}

async function mountSyntheticPreviewWriter(config, {
  document = globalThis.document,
  indexedDb = globalThis.indexedDB,
  randomUuid = () => globalThis.crypto?.randomUUID?.(),
  now = () => new Date().toISOString(),
  today = () => financialDateInMoscow(new Date()),
} = {}) {
  if (!document?.querySelector) throw new Error('PREVIEW_WRITER_DOCUMENT_REQUIRED');
  const selector = `[data-preview-writer="${config.slug}"]`;
  if (document.querySelector(selector)) return;
  const main = document.querySelector('main');
  if (!main) throw new Error('PREVIEW_WRITER_MAIN_REQUIRED');

  const expensePanel = document.querySelector('[data-preview-writer="expense"]');
  if (config.slug === 'income' && expensePanel) expensePanel.insertAdjacentHTML('afterend', panelMarkup(config));
  else main.insertAdjacentHTML('afterbegin', panelMarkup(config));

  const panel = document.querySelector(selector);
  const form = panel.querySelector(`[data-preview-${config.slug}-form]`);
  const button = panel.querySelector(`[data-preview-${config.slug}-save]`);
  const cancelEdit = panel.querySelector(`[data-preview-${config.slug}-cancel-edit]`);
  const pending = panel.querySelector(`[data-preview-${config.slug}-pending-count]`);
  const status = panel.querySelector(`[data-preview-${config.slug}-writer-status]`);
  const outbox = createIndexedDbPreviewOutbox(indexedDb);
  const draftStore = config.createDraftStore(indexedDb);
  let editingIntent = null;
  let draftWrite = Promise.resolve();

  wireTypeSwitch(document);
  installMoneyGuard(form);
  setFormValue(form, 'occurredOn', today());

  async function refreshPending() {
    try {
      const intents = await outbox.listPending();
      const count = intents.filter((intent) => intent.kind === config.intentKind).length;
      pending.textContent = `${config.queueLabel}: ${count}`;
    } catch {
      pending.textContent = `${config.queueLabel}: недоступно`;
    }
  }

  function exitEditMode() {
    editingIntent = null;
    button.textContent = 'Сохранить локально';
    cancelEdit.hidden = true;
  }

  try {
    const draft = await draftStore.load();
    if (draft) {
      const restored = { ...config.restoreDraft(draft, {
        accounts: syntheticPreviewEvidence.accounts,
        categories: syntheticPreviewEvidence.categories,
        members: SYNTHETIC_MEMBER_REFERENCES,
      }) };
      if (!restored.occurredOn) restored.occurredOn = today();
      restoreForm(form, restored, config);
      status.textContent = 'Черновик восстановлен локально · демо';
    }
  } catch {
    status.textContent = 'Локальный черновик недоступен';
  }

  await refreshPending();

  const saveDraft = () => {
    if (editingIntent) return;
    const snapshot = formInput(form, config);
    draftWrite = draftWrite.then(async () => {
      try {
        await draftStore.save(config.createDraft(snapshot, { now }));
        status.textContent = 'Черновик сохранён локально · демо';
      } catch {
        status.textContent = 'Не удалось сохранить черновик локально.';
      }
    });
  };

  form.addEventListener('input', saveDraft);
  form.addEventListener('change', saveDraft);
  document.addEventListener(OUTBOX_CHANGED_EVENT, refreshPending);

  document.addEventListener(EDIT_PENDING_EVENT, (event) => {
    const intent = event.detail?.intent;
    if (!intent || intent.kind !== config.intentKind) return;
    editingIntent = intent;
    restoreForm(form, intentFormValues(intent), config);
    activatePrimaryWriter(document, config.slug);
    button.textContent = 'Сохранить изменения';
    cancelEdit.hidden = false;
    status.textContent = 'Редактируется локальная запись. Отправки в сеть нет.';
    panel.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  });

  cancelEdit.addEventListener('click', () => {
    exitEditMode();
    status.textContent = DRAFT_STATUS;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!validateCommon(form, config)) {
      status.textContent = 'Заполните обязательные поля.';
      return;
    }
    button.disabled = true;
    try {
      await draftWrite;
      const input = formInput(form, config);
      if (editingIntent) {
        const intent = config.createIntent(input, {
          accounts: syntheticPreviewEvidence.accounts,
          categories: syntheticPreviewEvidence.categories,
          members: SYNTHETIC_MEMBER_REFERENCES,
          randomUuid: () => editingIntent.intentId,
          now: () => editingIntent.createdAt,
        });
        await outbox.replace(intent);
        exitEditMode();
        status.textContent = 'Локальная запись обновлена · демо · не отправлено';
      } else {
        const intent = config.createIntent(input, {
          accounts: syntheticPreviewEvidence.accounts,
          categories: syntheticPreviewEvidence.categories,
          members: SYNTHETIC_MEMBER_REFERENCES,
          randomUuid,
          now,
        });
        const result = await config.enqueueThenClearDraft({ outbox, draftStore, intent });
        status.textContent = result.draftCleared
          ? 'Сохранено локально · демо · не отправлено'
          : 'Сохранено локально · демо · не отправлено · черновик не очищен';
      }
      await refreshPending();
      dispatchOutboxChanged(document);
    } catch (error) {
      status.textContent = error?.message === config.invalidInputCode ? 'Проверьте обязательные поля.' : 'Не удалось сохранить локально.';
    } finally {
      button.disabled = false;
    }
  });
}

export async function mountSyntheticPreviewTransferWriter({
  document = globalThis.document,
  indexedDb = globalThis.indexedDB,
  randomUuid = () => globalThis.crypto?.randomUUID?.(),
  now = () => new Date().toISOString(),
  today = () => financialDateInMoscow(new Date()),
} = {}) {
  if (!document?.querySelector) throw new Error('PREVIEW_WRITER_DOCUMENT_REQUIRED');
  if (document.querySelector('[data-preview-writer="transfer"]')) return;
  const main = document.querySelector('main');
  if (!main) throw new Error('PREVIEW_WRITER_MAIN_REQUIRED');

  const incomePanel = document.querySelector('[data-preview-writer="income"]');
  const expensePanel = document.querySelector('[data-preview-writer="expense"]');
  if (incomePanel) incomePanel.insertAdjacentHTML('afterend', transferPanelMarkup());
  else if (expensePanel) expensePanel.insertAdjacentHTML('afterend', transferPanelMarkup());
  else main.insertAdjacentHTML('afterbegin', transferPanelMarkup());

  const panel = document.querySelector('[data-preview-writer="transfer"]');
  const form = panel.querySelector('[data-preview-transfer-form]');
  const button = panel.querySelector('[data-preview-transfer-save]');
  const cancelEdit = panel.querySelector('[data-preview-transfer-cancel-edit]');
  const pending = panel.querySelector('[data-preview-transfer-pending-count]');
  const status = panel.querySelector('[data-preview-transfer-writer-status]');
  const outbox = createIndexedDbPreviewOutbox(indexedDb);
  const draftStore = createIndexedDbPreviewTransferDraftStore(indexedDb);
  let editingIntent = null;
  let draftWrite = Promise.resolve();

  installMoneyGuard(form);
  setFormValue(form, 'occurredOn', today());

  async function refreshPending() {
    try {
      const intents = await outbox.listPending();
      pending.textContent = `Ожидают отправки: ${intents.filter((intent) => intent.kind === 'CREATE_TRANSFER').length}`;
    } catch {
      pending.textContent = 'Ожидают отправки: недоступно';
    }
  }

  function exitEditMode() {
    editingIntent = null;
    button.textContent = 'Сохранить локально';
    cancelEdit.hidden = true;
  }

  try {
    const draft = await draftStore.load();
    if (draft) {
      const restored = { ...restorePreviewTransferDraft(draft, { accounts: syntheticPreviewEvidence.accounts }) };
      if (!restored.occurredOn) restored.occurredOn = today();
      restoreTransferForm(form, restored);
      status.textContent = 'Черновик восстановлен локально · демо';
    }
  } catch {
    status.textContent = 'Локальный черновик недоступен';
  }

  await refreshPending();

  const saveDraft = () => {
    if (editingIntent) return;
    const snapshot = transferFormInput(form);
    draftWrite = draftWrite.then(async () => {
      try {
        await draftStore.save(createPreviewTransferDraft(snapshot, { now }));
        status.textContent = 'Черновик сохранён локально · демо';
      } catch {
        status.textContent = 'Не удалось сохранить черновик локально.';
      }
    });
  };

  form.addEventListener('input', saveDraft);
  form.addEventListener('change', saveDraft);
  document.addEventListener(OUTBOX_CHANGED_EVENT, refreshPending);
  document.addEventListener(EDIT_PENDING_EVENT, (event) => {
    const intent = event.detail?.intent;
    if (!intent || intent.kind !== 'CREATE_TRANSFER') return;
    editingIntent = intent;
    restoreTransferForm(form, intentFormValues(intent));
    panel.open = true;
    button.textContent = 'Сохранить изменения';
    cancelEdit.hidden = false;
    status.textContent = 'Редактируется локальная запись. Отправки в сеть нет.';
    panel.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  });

  cancelEdit.addEventListener('click', () => {
    exitEditMode();
    status.textContent = DRAFT_STATUS;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!validateTransfer(form)) {
      status.textContent = 'Заполните обязательные поля.';
      return;
    }
    button.disabled = true;
    try {
      await draftWrite;
      const input = transferFormInput(form);
      if (editingIntent) {
        const intent = createPreviewTransferIntent(input, {
          accounts: syntheticPreviewEvidence.accounts,
          randomUuid: () => editingIntent.intentId,
          now: () => editingIntent.createdAt,
        });
        await outbox.replace(intent);
        exitEditMode();
        status.textContent = 'Локальная запись обновлена · демо · не отправлено';
      } else {
        const intent = createPreviewTransferIntent(input, { accounts: syntheticPreviewEvidence.accounts, randomUuid, now });
        const result = await enqueuePreviewTransferThenClearDraft({ outbox, draftStore, intent });
        status.textContent = result.draftCleared
          ? 'Сохранено локально · демо · не отправлено'
          : 'Сохранено локально · демо · не отправлено · черновик не очищен';
      }
      await refreshPending();
      dispatchOutboxChanged(document);
    } catch (error) {
      status.textContent = error?.message === 'INVALID_PREVIEW_TRANSFER_INPUT' ? 'Проверьте обязательные поля и счета.' : 'Не удалось сохранить локально.';
    } finally {
      button.disabled = false;
    }
  });
}

export async function mountSyntheticPreviewExpenseWriter(options = {}) {
  return mountSyntheticPreviewWriter(WRITER_CONFIGS.expense, options);
}

export async function mountSyntheticPreviewIncomeWriter(options = {}) {
  return mountSyntheticPreviewWriter(WRITER_CONFIGS.income, options);
}

export const previewWriterEvents = Object.freeze({ outboxChanged: OUTBOX_CHANGED_EVENT, editPending: EDIT_PENDING_EVENT });
