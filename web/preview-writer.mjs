import { createIndexedDbPreviewOutbox, createPreviewExpenseIntent } from './preview-writer-outbox.mjs';
import { syntheticPreviewEvidence } from './preview-transport.mjs';

function optionMarkup(items) {
  return items.map((item) => `<option value="${item.id}">${item.label}</option>`).join('');
}

function panelMarkup() {
  const accounts = syntheticPreviewEvidence.accounts;
  const expenseCategories = syntheticPreviewEvidence.categories.filter((item) => item.kind === 'EXPENSE');
  return `
    <section class="panel preview-writer" data-preview-writer>
      <div class="section-head">
        <div><span class="eyebrow">R3A · synthetic only</span><h2>Новый расход · демо</h2></div>
        <span>Только локально</span>
      </div>
      <p class="preview-writer__notice">Эта форма проверяет новый local-first UX. Она не отправляет данные и пока не заявляет совпадение с Google Form/GAS.</p>
      <form class="preview-writer__form" data-preview-expense-form novalidate>
        <label class="preview-writer__field"><span>Сумма, ₽</span><input name="amount" inputmode="decimal" autocomplete="off" placeholder="0,00" required></label>
        <label class="preview-writer__field"><span>Дата</span><input name="occurredOn" type="date" required></label>
        <label class="preview-writer__field"><span>Счёт</span><select name="accountId" required><option value="">Выберите счёт</option>${optionMarkup(accounts)}</select></label>
        <label class="preview-writer__field"><span>Категория</span><select name="categoryId" required><option value="">Выберите категорию</option>${optionMarkup(expenseCategories)}</select></label>
        <label class="preview-writer__field preview-writer__field--wide"><span>Описание</span><input name="description" autocomplete="off" placeholder="Необязательно"></label>
        <label class="preview-writer__field preview-writer__field--wide"><span>Заметка</span><textarea name="note" rows="2" placeholder="Необязательно"></textarea></label>
        <div class="preview-writer__actions">
          <button type="submit" data-preview-expense-save>Сохранить локально</button>
          <span data-preview-pending-count>Локальная очередь: проверяем…</span>
        </div>
        <p class="preview-writer__status" data-preview-writer-status role="status" aria-live="polite" aria-atomic="true"></p>
      </form>
    </section>`;
}

function formValue(form, name) {
  const field = form.elements.namedItem(name);
  if (!field || typeof field.value !== 'string') throw new Error('PREVIEW_WRITER_FORM_INVALID');
  return field.value;
}

export async function mountSyntheticPreviewExpenseWriter({
  document = globalThis.document,
  indexedDb = globalThis.indexedDB,
  randomUuid = () => globalThis.crypto?.randomUUID?.(),
  now = () => new Date().toISOString(),
} = {}) {
  if (!document?.querySelector) throw new Error('PREVIEW_WRITER_DOCUMENT_REQUIRED');
  if (document.querySelector('[data-preview-writer]')) return;
  const main = document.querySelector('main');
  if (!main) throw new Error('PREVIEW_WRITER_MAIN_REQUIRED');
  main.insertAdjacentHTML('afterbegin', panelMarkup());

  const panel = document.querySelector('[data-preview-writer]');
  const form = panel.querySelector('[data-preview-expense-form]');
  const button = panel.querySelector('[data-preview-expense-save]');
  const pending = panel.querySelector('[data-preview-pending-count]');
  const status = panel.querySelector('[data-preview-writer-status]');
  const outbox = createIndexedDbPreviewOutbox(indexedDb);

  async function refreshPending() {
    try {
      pending.textContent = `Локальная очередь: ${await outbox.countPending()}`;
    } catch {
      pending.textContent = 'Локальная очередь недоступна';
    }
  }

  await refreshPending();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    button.disabled = true;
    status.textContent = '';
    try {
      const intent = createPreviewExpenseIntent({
        amount: formValue(form, 'amount'),
        occurredOn: formValue(form, 'occurredOn'),
        accountId: formValue(form, 'accountId'),
        categoryId: formValue(form, 'categoryId'),
        description: formValue(form, 'description'),
        note: formValue(form, 'note'),
      }, {
        accounts: syntheticPreviewEvidence.accounts,
        categories: syntheticPreviewEvidence.categories,
        randomUuid,
        now,
      });
      await outbox.enqueue(intent);
      status.textContent = 'Сохранено локально · демо · не отправлено';
      await refreshPending();
    } catch (error) {
      status.textContent = error?.message === 'INVALID_PREVIEW_EXPENSE_INPUT'
        ? 'Проверьте сумму, дату, счёт и категорию.'
        : 'Не удалось сохранить локально.';
    } finally {
      button.disabled = false;
    }
  });
}
