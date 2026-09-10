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
  restorePreviewExpenseDraft,
  restorePreviewIncomeDraft,
  restorePreviewTransferDraft,
} from './preview-writer-outbox.mjs';
import { syntheticPreviewEvidence } from './preview-transport.mjs';

const DRAFT_STATUS = 'Черновик сохраняется локально · демо';

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
    title: 'Новый расход · демо',
    accountLabel: 'Счёт списания',
    categoryLabel: 'Категория расхода',
    queueLabel: 'Локальная очередь расходов',
    invalidInputCode: 'INVALID_PREVIEW_EXPENSE_INPUT',
    payerEnabled: true,
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
    title: 'Новый доход · демо',
    accountLabel: 'Счёт зачисления',
    categoryLabel: 'Категория дохода',
    queueLabel: 'Локальная очередь доходов',
    invalidInputCode: 'INVALID_PREVIEW_INCOME_INPUT',
    payerEnabled: false,
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

function panelMarkup(config) {
  const accounts = syntheticPreviewEvidence.accounts;
  const categories = syntheticPreviewEvidence.categories.filter((item) => item.kind === config.categoryKind);
  const payerField = config.payerEnabled
    ? `<label class="preview-writer__field"><span>Кто оплатил</span><select name="paidByMemberId"><option value="">Не указан</option>${optionMarkup(SYNTHETIC_MEMBER_REFERENCES)}</select></label>`
    : '';
  return `
    <section class="panel preview-writer" data-preview-writer="${config.slug}">
      <div class="section-head">
        <div><span class="eyebrow">R3A · synthetic only</span><h2>${config.title}</h2></div>
        <span>Только локально</span>
      </div>
      <p class="preview-writer__notice">Эта форма проверяет новый local-first UX. Она не отправляет данные и пока не заявляет совпадение с Google Form/GAS.</p>
      <form class="preview-writer__form" data-preview-${config.slug}-form novalidate>
        <label class="preview-writer__field"><span>Сумма, ₽</span><input name="amount" inputmode="decimal" autocomplete="off" placeholder="0,00" required></label>
        <label class="preview-writer__field"><span>Дата</span><input name="occurredOn" type="date" required></label>
        <label class="preview-writer__field"><span>${config.accountLabel}</span><select name="accountId" required><option value="">Выберите счёт</option>${optionMarkup(accounts)}</select></label>
        <label class="preview-writer__field"><span>${config.categoryLabel}</span><select name="categoryId" required><option value="">Выберите категорию</option>${optionMarkup(categories)}</select></label>
        ${payerField}
        <label class="preview-writer__field preview-writer__field--wide"><span>Описание</span><input name="description" autocomplete="off" placeholder="Необязательно"></label>
        <label class="preview-writer__field preview-writer__field--wide"><span>Заметка</span><textarea name="note" rows="2" placeholder="Необязательно"></textarea></label>
        <div class="preview-writer__actions">
          <button type="submit" data-preview-${config.slug}-save>Сохранить локально</button>
          <span data-preview-${config.slug}-pending-count>${config.queueLabel}: проверяем…</span>
        </div>
        <p class="preview-writer__status" data-preview-${config.slug}-writer-status role="status" aria-live="polite" aria-atomic="true">${DRAFT_STATUS}</p>
      </form>
    </section>`;
}

function transferPanelMarkup() {
  const accounts = syntheticPreviewEvidence.accounts;
  return `
    <section class="panel preview-writer" data-preview-writer="transfer">
      <div class="section-head">
        <div><span class="eyebrow">R3A · synthetic only</span><h2>Новый перевод · демо</h2></div>
        <span>Только локально</span>
      </div>
      <p class="preview-writer__notice">Эта форма проверяет local-first перевод между выбранными демо-счетами. Вид перевода не угадывается и остаётся не задан.</p>
      <form class="preview-writer__form" data-preview-transfer-form novalidate>
        <label class="preview-writer__field"><span>Сумма, ₽</span><input name="amount" inputmode="decimal" autocomplete="off" placeholder="0,00" required></label>
        <label class="preview-writer__field"><span>Дата</span><input name="occurredOn" type="date" required></label>
        <label class="preview-writer__field"><span>Счёт списания</span><select name="fromAccountId" required><option value="">Выберите счёт</option>${optionMarkup(accounts)}</select></label>
        <label class="preview-writer__field"><span>Счёт зачисления</span><select name="toAccountId" required><option value="">Выберите счёт</option>${optionMarkup(accounts)}</select></label>
        <label class="preview-writer__field preview-writer__field--wide"><span>Описание</span><input name="description" autocomplete="off" placeholder="Необязательно"></label>
        <label class="preview-writer__field preview-writer__field--wide"><span>Заметка</span><textarea name="note" rows="2" placeholder="Необязательно"></textarea></label>
        <div class="preview-writer__actions">
          <button type="submit" data-preview-transfer-save>Сохранить локально</button>
          <span data-preview-transfer-pending-count>Локальная очередь переводов: проверяем…</span>
        </div>
        <p class="preview-writer__status" data-preview-transfer-writer-status role="status" aria-live="polite" aria-atomic="true">${DRAFT_STATUS}</p>
      </form>
    </section>`;
}

function formValue(form, name) {
  const field = form.elements.namedItem(name);
  if (!field || typeof field.value !== 'string') throw new Error('PREVIEW_WRITER_FORM_INVALID');
  return field.value;
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
  return config.payerEnabled
    ? { ...base, paidByMemberId: formValue(form, 'paidByMemberId') }
    : base;
}

function setFormValue(form, name, value) {
  const field = form.elements.namedItem(name);
  if (!field || typeof field.value !== 'string') throw new Error('PREVIEW_WRITER_FORM_INVALID');
  field.value = value;
}

function restoreForm(form, values, config) {
  const names = ['amount', 'occurredOn', 'accountId', 'categoryId', 'description', 'note'];
  if (config.payerEnabled) names.splice(4, 0, 'paidByMemberId');
  for (const name of names) setFormValue(form, name, values[name]);
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

function restoreTransferForm(form, values) {
  for (const name of ['amount', 'occurredOn', 'fromAccountId', 'toAccountId', 'description', 'note']) {
    setFormValue(form, name, values[name]);
  }
}

async function mountSyntheticPreviewWriter(config, {
  document = globalThis.document,
  indexedDb = globalThis.indexedDB,
  randomUuid = () => globalThis.crypto?.randomUUID?.(),
  now = () => new Date().toISOString(),
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
  const pending = panel.querySelector(`[data-preview-${config.slug}-pending-count]`);
  const status = panel.querySelector(`[data-preview-${config.slug}-writer-status]`);
  const outbox = createIndexedDbPreviewOutbox(indexedDb);
  const draftStore = config.createDraftStore(indexedDb);

  async function refreshPending() {
    try {
      const intents = await outbox.listPending();
      const count = intents.filter((intent) => intent.kind === config.intentKind).length;
      pending.textContent = `${config.queueLabel}: ${count}`;
    } catch {
      pending.textContent = `${config.queueLabel} недоступна`;
    }
  }

  try {
    const draft = await draftStore.load();
    if (draft) {
      restoreForm(form, config.restoreDraft(draft, {
        accounts: syntheticPreviewEvidence.accounts,
        categories: syntheticPreviewEvidence.categories,
        members: SYNTHETIC_MEMBER_REFERENCES,
      }), config);
      status.textContent = 'Черновик восстановлен локально · демо';
    }
  } catch {
    status.textContent = 'Локальный черновик недоступен';
  }

  await refreshPending();

  let draftWrite = Promise.resolve();
  const saveDraft = () => {
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

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    button.disabled = true;
    try {
      await draftWrite;
      const intent = config.createIntent(formInput(form, config), {
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
      await refreshPending();
    } catch (error) {
      status.textContent = error?.message === config.invalidInputCode
        ? 'Проверьте сумму, дату, счёт и категорию.'
        : 'Не удалось сохранить локально.';
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
  const pending = panel.querySelector('[data-preview-transfer-pending-count]');
  const status = panel.querySelector('[data-preview-transfer-writer-status]');
  const outbox = createIndexedDbPreviewOutbox(indexedDb);
  const draftStore = createIndexedDbPreviewTransferDraftStore(indexedDb);

  async function refreshPending() {
    try {
      const intents = await outbox.listPending();
      const count = intents.filter((intent) => intent.kind === 'CREATE_TRANSFER').length;
      pending.textContent = `Локальная очередь переводов: ${count}`;
    } catch {
      pending.textContent = 'Локальная очередь переводов недоступна';
    }
  }

  try {
    const draft = await draftStore.load();
    if (draft) {
      restoreTransferForm(form, restorePreviewTransferDraft(draft, { accounts: syntheticPreviewEvidence.accounts }));
      status.textContent = 'Черновик восстановлен локально · демо';
    }
  } catch {
    status.textContent = 'Локальный черновик недоступен';
  }

  await refreshPending();

  let draftWrite = Promise.resolve();
  const saveDraft = () => {
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

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    button.disabled = true;
    try {
      await draftWrite;
      const intent = createPreviewTransferIntent(transferFormInput(form), {
        accounts: syntheticPreviewEvidence.accounts,
        randomUuid,
        now,
      });
      const result = await enqueuePreviewTransferThenClearDraft({ outbox, draftStore, intent });
      status.textContent = result.draftCleared
        ? 'Сохранено локально · демо · не отправлено'
        : 'Сохранено локально · демо · не отправлено · черновик не очищен';
      await refreshPending();
    } catch (error) {
      status.textContent = error?.message === 'INVALID_PREVIEW_TRANSFER_INPUT'
        ? 'Проверьте сумму, дату и счета. Счета должны различаться.'
        : 'Не удалось сохранить локально.';
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
