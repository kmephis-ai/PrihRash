import { createIndexedDbPreviewOutbox } from './preview-writer-outbox.mjs';
import { previewWriterEvents } from './preview-writer.mjs';

const CREATE_KINDS = new Set(['CREATE_EXPENSE', 'CREATE_INCOME', 'CREATE_TRANSFER']);

function rub(amountMinor) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 }).format(amountMinor / 100);
}

function typeLabel(kind) {
  if (kind === 'CREATE_EXPENSE') return 'Расход';
  if (kind === 'CREATE_INCOME') return 'Доход';
  if (kind === 'CREATE_TRANSFER') return 'Перевод';
  return 'Операция';
}

function contextLabel(intent) {
  if (intent.kind === 'CREATE_EXPENSE') return `${intent.payload.fromAccount.label} · ${intent.payload.category.label}`;
  if (intent.kind === 'CREATE_INCOME') return `${intent.payload.toAccount.label} · ${intent.payload.category.label}`;
  return `${intent.payload.fromAccount.label} → ${intent.payload.toAccount.label}`;
}

function createRow(document, intent) {
  const item = document.createElement('li');
  item.className = 'preview-queue__item';
  item.dataset.previewQueueIntent = intent.intentId;

  const main = document.createElement('div');
  main.className = 'preview-queue__main';
  const heading = document.createElement('strong');
  heading.textContent = `${typeLabel(intent.kind)} · ${rub(intent.payload.amountMinor)}`;
  const description = document.createElement('span');
  description.textContent = intent.payload.description ?? 'Без описания';
  const context = document.createElement('small');
  context.textContent = `${intent.payload.occurredOn} · ${contextLabel(intent)}`;
  main.append(heading, description, context);

  const aside = document.createElement('div');
  aside.className = 'preview-queue__aside';
  const state = document.createElement('span');
  state.className = 'preview-queue__state';
  state.textContent = 'Сохранено локально';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.textContent = 'Редактировать';
  edit.dataset.previewQueueEdit = intent.intentId;
  edit.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent(previewWriterEvents.editPending, { detail: { intent } }));
  });
  aside.append(state, edit);
  item.append(main, aside);
  return item;
}

export async function mountSyntheticPreviewWriterQueue({ document = globalThis.document, indexedDb = globalThis.indexedDB } = {}) {
  if (!document?.querySelector) throw new Error('PREVIEW_WRITER_QUEUE_DOCUMENT_REQUIRED');
  if (document.querySelector('[data-preview-writer-queue]')) return;
  const transfer = document.querySelector('[data-preview-writer="transfer"]');
  const anchor = transfer ?? document.querySelector('[data-preview-writer="income"]') ?? document.querySelector('[data-preview-writer="expense"]');
  if (!anchor) throw new Error('PREVIEW_WRITER_QUEUE_ANCHOR_REQUIRED');

  const panel = document.createElement('section');
  panel.className = 'panel preview-queue';
  panel.dataset.previewWriterQueue = 'true';
  panel.innerHTML = '<div class="section-head"><div><span class="eyebrow">LOCAL-FIRST</span><h2>Ожидают отправки</h2></div><span data-preview-queue-count>Проверяем…</span></div><p class="preview-writer__notice">Здесь можно проверить и изменить ещё не отправленные операции. Редактирование не создаёт вторую запись.</p><ul class="preview-queue__list" data-preview-queue-list></ul><p class="preview-writer__status" data-preview-queue-empty hidden>Очередь пуста.</p>';
  anchor.insertAdjacentElement('afterend', panel);

  const count = panel.querySelector('[data-preview-queue-count]');
  const list = panel.querySelector('[data-preview-queue-list]');
  const empty = panel.querySelector('[data-preview-queue-empty]');
  const outbox = createIndexedDbPreviewOutbox(indexedDb);

  async function refresh() {
    try {
      const intents = (await outbox.listPending()).filter((intent) => CREATE_KINDS.has(intent.kind));
      count.textContent = String(intents.length);
      list.replaceChildren(...intents.map((intent) => createRow(document, intent)));
      empty.hidden = intents.length !== 0;
    } catch {
      count.textContent = 'Недоступно';
      list.replaceChildren();
      empty.hidden = false;
      empty.textContent = 'Локальная очередь недоступна.';
    }
  }

  document.addEventListener(previewWriterEvents.outboxChanged, refresh);
  await refresh();
}
