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
  restorePreviewExpenseDraft,
  restorePreviewIncomeDraft,
} from './preview-writer-outbox.mjs';
import { syntheticPreviewEvidence } from './preview-transport.mjs';

const DRAFT_STATUS = 'Черновик сохраняется локально · демо';

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

function formValue(form, name) {
  const field = form.elements.namedItem(name);
  if (!field || typeof field.value !== 'string') throw new Error('PREVIEW_WRITER_FORM_INVALID');
  return field.value;
}

function formInput(form) {
  return {
    amount: formValue(form, 'amount'),
    occurredOn: formValue(form, 'occurredOn'),
    accountId: formValue(form, 'accountId'),
    categoryId: formValue(form, 'categoryId'),
    description: formValue(form, 'description'),
    note: formValue(form, 'note'),
  };
}

function setFormValue(form, name, value) {
  const field = form.elements.namedItem(name);
  if (!field || typeof field.value !== 'string') throw new Error('PREVIEW_WRITER_FORM_INVALID');
  field.value = value;
}

function restoreForm(form, values) {
  for (const name of ['amount', 'occurredOn', 'accountId', 'categoryId', 'description', 'note']) {
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
      }));
      status.textContent = 'Черновик восстановлен локально · демо';
    }
  } catch {
    status.textContent = 'Локальный черновик недоступен';
  }

  await refreshPending();

  let draftWrite = Promise.resolve();
  const saveDraft = () => {
    const snapshot = formInput(form);
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
      const intent = config.createIntent(formInput(form), {
        accounts: syntheticPreviewEvidence.accounts,
        categories: syntheticPreviewEvidence.categories,
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

export async function mountSyntheticPreviewExpenseWriter(options = {}) {
  return mountSyntheticPreviewWriter(WRITER_CONFIGS.expense, options);
}

export async function mountSyntheticPreviewIncomeWriter(options = {}) {
  return mountSyntheticPreviewWriter(WRITER_CONFIGS.income, options);
}
