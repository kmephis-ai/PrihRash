import { syntheticPreviewEvidence } from './preview-transport.mjs';
import {
  createIndexedDbPreviewOutbox,
  createPreviewVoidIntent,
  parsePreviewVoidIntent,
} from './preview-writer-outbox.mjs';
import { deliverPreviewTransactionVoidIntent } from './preview-transaction-void-delivery.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const ORDINARY_TYPES = Object.freeze(['EXPENSE', 'INCOME', 'TRANSFER']);

function fail(code) {
  throw new Error(code);
}

function canonicalUuid(value, code = 'PREVIEW_VOID_EVIDENCE_INVALID') {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail(code);
  return value;
}

function canonicalDate(value, code = 'PREVIEW_VOID_EVIDENCE_INVALID') {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) fail(code);
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) fail(code);
  return value;
}

function positiveVersion(value, code = 'PREVIEW_VOID_EVIDENCE_INVALID') {
  if (!Number.isSafeInteger(value) || value <= 0) fail(code);
  return value;
}

function canonicalLabel(value, code = 'PREVIEW_VOID_EVIDENCE_INVALID') {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) fail(code);
  return value;
}

function candidateFromOperation(operation) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) fail('PREVIEW_VOID_EVIDENCE_INVALID');
  if (!ORDINARY_TYPES.includes(operation.type)) fail('PREVIEW_VOID_EVIDENCE_INVALID');
  if (operation.recordGranularity !== 'TRANSACTION' || operation.datePrecision !== 'DAY' || operation.status !== 'POSTED') {
    fail('PREVIEW_VOID_EVIDENCE_INVALID');
  }
  return Object.freeze({
    transactionId: canonicalUuid(operation.id),
    type: operation.type,
    occurredOn: canonicalDate(operation.occurredOn),
    version: positiveVersion(operation.version),
    label: canonicalLabel(operation.description),
  });
}

export function listPreviewTransactionVoidCandidates(operations = syntheticPreviewEvidence.operations) {
  if (!Array.isArray(operations)) return Object.freeze([]);
  const byId = new Map();
  const duplicateIds = new Set();
  for (const operation of operations) {
    try {
      const candidate = candidateFromOperation(operation);
      if (byId.has(candidate.transactionId)) duplicateIds.add(candidate.transactionId);
      else byId.set(candidate.transactionId, candidate);
    } catch {
      // Unsafe, coarse, already-VOIDED or malformed evidence never gets an active VOID action.
    }
  }
  return Object.freeze([...byId.values()].filter((candidate) => !duplicateIds.has(candidate.transactionId)));
}

function stateSnapshot(state) {
  return Object.freeze({
    ...state,
    candidate: state.candidate === null ? null : Object.freeze({ ...state.candidate }),
    pendingIntent: state.pendingIntent === null ? null : parsePreviewVoidIntent(state.pendingIntent),
  });
}

function requirePorts(outbox, sender) {
  if (
    !outbox
    || typeof outbox.enqueue !== 'function'
    || typeof outbox.listPending !== 'function'
    || typeof outbox.acknowledge !== 'function'
    || !sender
    || typeof sender.sendTransactionVoid !== 'function'
  ) fail('PREVIEW_VOID_UI_PORT_REQUIRED');
}

function candidateById(candidates, transactionId) {
  const matches = candidates.filter((candidate) => candidate.transactionId === transactionId);
  if (matches.length !== 1) fail('PREVIEW_VOID_EVIDENCE_INVALID');
  return matches[0];
}

function voidIntents(intents) {
  if (!Array.isArray(intents)) fail('PREVIEW_VOID_OUTBOX_INVALID');
  const valid = [];
  for (const intent of intents) {
    if (intent?.kind !== 'VOID_TRANSACTION') continue;
    try {
      valid.push(parsePreviewVoidIntent(intent));
    } catch {
      fail('PREVIEW_VOID_OUTBOX_INVALID');
    }
  }
  return valid;
}

function pendingForCandidate(intents, candidate) {
  return intents.filter((intent) => intent.payload.transactionId === candidate.transactionId);
}

function errorMessage(error) {
  if (error?.message === 'PREVIEW_VOID_SEND_FAILED') {
    return 'Не удалось отправить демо-запрос. Он сохранён локально; повтор возможен только явным действием.';
  }
  if (error?.message === 'INVALID_PREVIEW_VOID_ACK') {
    return 'Ответ не прошёл проверку. Локальный запрос сохранён и не считается подтверждённым.';
  }
  if (error?.message === 'PREVIEW_VOID_LOCAL_ACK_FAILED') {
    return 'Подтверждение получено, но локальную очередь очистить не удалось. Запрос сохранён; автоматического повтора нет.';
  }
  return 'Не удалось завершить демо-аннулирование. Локальный запрос сохранён.';
}

export function createPreviewTransactionVoidController({
  candidates = listPreviewTransactionVoidCandidates(),
  outbox,
  sender,
  randomUuid = () => globalThis.crypto?.randomUUID?.(),
  now = () => new Date().toISOString(),
} = {}) {
  requirePorts(outbox, sender);
  if (!Array.isArray(candidates) || candidates.length === 0) fail('PREVIEW_VOID_EVIDENCE_INVALID');
  const safeCandidates = Object.freeze(candidates.map((candidate) => candidateFromOperation({
    id: candidate.transactionId,
    type: candidate.type,
    occurredOn: candidate.occurredOn,
    version: candidate.version,
    description: candidate.label,
    recordGranularity: 'TRANSACTION',
    datePrecision: 'DAY',
    status: 'POSTED',
  })));
  const confirmedIds = new Set();
  let state = stateSnapshot({
    status: 'READY',
    candidate: safeCandidates[0],
    pendingIntent: null,
    pendingCount: 0,
    conflictVersion: null,
    message: 'Выберите демо-операцию. Аннулирование сначала сохраняется локально.',
  });

  function getState() {
    return state;
  }

  async function restore() {
    let pending;
    try {
      pending = voidIntents(await outbox.listPending());
    } catch {
      state = stateSnapshot({ ...state, status: 'DEGRADED', pendingCount: 0, message: 'Локальную очередь аннулирований прочитать не удалось.' });
      return state;
    }
    if (pending.length === 0) {
      state = stateSnapshot({ ...state, status: 'READY', pendingIntent: null, pendingCount: 0, conflictVersion: null });
      return state;
    }

    const exact = [];
    for (const intent of pending) {
      const matches = safeCandidates.filter((candidate) => candidate.transactionId === intent.payload.transactionId);
      if (matches.length !== 1 || matches[0].version !== intent.payload.expectedVersion) continue;
      exact.push({ intent, candidate: matches[0] });
    }
    if (exact.length === 0) {
      state = stateSnapshot({
        ...state,
        status: 'DEGRADED',
        pendingIntent: null,
        pendingCount: pending.length,
        conflictVersion: null,
        message: 'Есть локальный запрос аннулирования, который нельзя безопасно связать с текущей демо-операцией.',
      });
      return state;
    }
    const selected = exact[0];
    const sameTarget = pendingForCandidate(pending, selected.candidate);
    if (sameTarget.length !== 1) {
      state = stateSnapshot({
        ...state,
        status: 'DEGRADED',
        candidate: selected.candidate,
        pendingIntent: null,
        pendingCount: pending.length,
        conflictVersion: null,
        message: 'Для одной операции найдено несколько локальных запросов. Автоматические действия заблокированы.',
      });
      return state;
    }
    state = stateSnapshot({
      ...state,
      status: 'PENDING',
      candidate: selected.candidate,
      pendingIntent: selected.intent,
      pendingCount: pending.length,
      conflictVersion: null,
      message: 'Аннулирование сохранено локально · демо · ещё не подтверждено.',
    });
    return state;
  }

  function selectTransaction(transactionId) {
    if (!['READY', 'CONFIRMED'].includes(state.status)) fail('PREVIEW_VOID_UI_ACTION_BLOCKED');
    const candidate = candidateById(safeCandidates, canonicalUuid(transactionId, 'PREVIEW_VOID_EVIDENCE_INVALID'));
    state = stateSnapshot({
      ...state,
      status: confirmedIds.has(candidate.transactionId) ? 'CONFIRMED' : 'READY',
      candidate,
      pendingIntent: null,
      conflictVersion: null,
      message: confirmedIds.has(candidate.transactionId)
        ? 'Эта демо-операция уже подтверждённо аннулирована в текущей сессии.'
        : 'Готово к подтверждению. До подтверждения локальная очередь не меняется.',
    });
    return state;
  }

  function openConfirmation() {
    if (state.status !== 'READY' || state.candidate === null) fail('PREVIEW_VOID_UI_ACTION_BLOCKED');
    state = stateSnapshot({ ...state, status: 'CONFIRMING', message: 'Подтвердите аннулирование. Это demo-only локальный сценарий.' });
    return state;
  }

  function cancelConfirmation() {
    if (state.status !== 'CONFIRMING') fail('PREVIEW_VOID_UI_ACTION_BLOCKED');
    state = stateSnapshot({ ...state, status: 'READY', message: 'Аннулирование отменено. Локальная очередь не изменена.' });
    return state;
  }

  async function confirm() {
    if (state.status !== 'CONFIRMING' || state.candidate === null) fail('PREVIEW_VOID_UI_ACTION_BLOCKED');
    const candidate = state.candidate;
    let pending;
    try {
      pending = voidIntents(await outbox.listPending());
    } catch {
      state = stateSnapshot({ ...state, status: 'DEGRADED', message: 'Локальную очередь проверить не удалось. Новый запрос не создан.' });
      return state;
    }
    const sameTarget = pendingForCandidate(pending, candidate);
    if (sameTarget.length > 1 || (sameTarget.length === 1 && sameTarget[0].payload.expectedVersion !== candidate.version)) {
      state = stateSnapshot({
        ...state,
        status: 'DEGRADED',
        pendingIntent: sameTarget.length === 1 ? sameTarget[0] : null,
        pendingCount: pending.length,
        message: 'Существующий локальный запрос не совпадает с текущей версией. Новый запрос не создан.',
      });
      return state;
    }
    if (sameTarget.length === 1) {
      state = stateSnapshot({
        ...state,
        status: 'PENDING',
        pendingIntent: sameTarget[0],
        pendingCount: pending.length,
        conflictVersion: null,
        message: 'Аннулирование уже сохранено локально · демо · ещё не подтверждено.',
      });
      return state;
    }

    let intent;
    try {
      intent = createPreviewVoidIntent({ transactionId: candidate.transactionId, expectedVersion: candidate.version }, { randomUuid, now });
      await outbox.enqueue(intent);
    } catch {
      state = stateSnapshot({ ...state, status: 'DEGRADED', pendingIntent: null, pendingCount: pending.length, message: 'Не удалось сохранить аннулирование локально. Отправка не выполнялась.' });
      return state;
    }
    state = stateSnapshot({
      ...state,
      status: 'PENDING',
      pendingIntent: intent,
      pendingCount: pending.length + 1,
      conflictVersion: null,
      message: 'Сохранено локально · демо · отправка выполняется только отдельным действием.',
    });
    return state;
  }

  async function deliver() {
    if (!['PENDING', 'DEGRADED'].includes(state.status) || state.pendingIntent === null) fail('PREVIEW_VOID_UI_ACTION_BLOCKED');
    const intent = state.pendingIntent;
    state = stateSnapshot({ ...state, status: 'DELIVERING', message: 'Проверяем демо-подтверждение…' });
    try {
      const ack = await deliverPreviewTransactionVoidIntent({ outbox, sender, intent });
      if (ack.outcome === 'VERSION_CONFLICT') {
        state = stateSnapshot({
          ...state,
          status: 'CONFLICT',
          pendingIntent: intent,
          conflictVersion: ack.currentVersion,
          message: `Есть более новая версия ${ack.currentVersion}. Локальный запрос сохранён; автоматической повторной отправки нет.`,
        });
        return state;
      }
      confirmedIds.add(intent.payload.transactionId);
      state = stateSnapshot({
        ...state,
        status: 'CONFIRMED',
        pendingIntent: null,
        pendingCount: Math.max(0, state.pendingCount - 1),
        conflictVersion: null,
        message: `Аннулирование подтверждено · ${ack.outcome === 'VOIDED' ? 'операция аннулирована' : 'операция уже была аннулирована'} · демо.`,
      });
      return state;
    } catch (error) {
      state = stateSnapshot({ ...state, status: 'DEGRADED', pendingIntent: intent, conflictVersion: null, message: errorMessage(error) });
      return state;
    }
  }

  return Object.freeze({
    getState,
    restore,
    selectTransaction,
    openConfirmation,
    cancelConfirmation,
    confirm,
    deliver,
  });
}

export function createSyntheticPreviewTransactionVoidSender() {
  return Object.freeze({
    async sendTransactionVoid(request) {
      if (request.transactionId === '40000000-0000-0000-0000-000000000002') {
        return Object.freeze({
          apiVersion: 1,
          outcome: 'VERSION_CONFLICT',
          transactionId: request.transactionId,
          currentVersion: request.expectedVersion + 1,
        });
      }
      return Object.freeze({
        apiVersion: 1,
        outcome: 'VOIDED',
        transactionId: request.transactionId,
        version: request.expectedVersion + 1,
      });
    },
  });
}

function typeLabel(type) {
  if (type === 'EXPENSE') return 'Расход';
  if (type === 'INCOME') return 'Доход';
  return 'Перевод';
}

function panelMarkup(candidates) {
  const options = candidates.map((candidate) => (
    `<option value="${candidate.transactionId}">${typeLabel(candidate.type)} · ${candidate.label} · версия ${candidate.version}</option>`
  )).join('');
  return `<section class="preview-writer preview-void" data-preview-transaction-void aria-labelledby="preview-void-title">
    <div class="preview-writer__head">
      <div><span class="eyebrow">R3A · VOID · демо</span><h2 id="preview-void-title">Аннулирование операции</h2></div>
      <span class="preview-writer__pending" data-preview-void-pending-count>Локально ожидают: 0</span>
    </div>
    <p class="preview-writer__hint">Только synthetic preview. «Удалить» означает VOIDED; production write path не подключён.</p>
    <div class="preview-void__controls">
      <label class="preview-writer__field preview-writer__field--wide"><span>Операция</span><select data-preview-void-operation>${options}</select></label>
      <button type="button" data-preview-void-open>Аннулировать</button>
    </div>
    <p class="preview-writer__status" data-preview-void-status role="status" aria-live="polite" aria-atomic="true"></p>
    <section class="preview-void__confirmation" data-preview-void-confirmation role="dialog" aria-modal="false" aria-labelledby="preview-void-confirm-title" hidden>
      <h3 id="preview-void-confirm-title">Подтвердить аннулирование?</h3>
      <p data-preview-void-confirm-copy></p>
      <div class="preview-writer__actions">
        <button type="button" data-preview-void-confirm>Подтвердить аннулирование</button>
        <button type="button" data-preview-void-cancel>Отмена</button>
      </div>
    </section>
    <section class="preview-void__pending" data-preview-void-pending hidden>
      <p>Запрос уже сохранён в IndexedDB и не зависит от доступности сети.</p>
      <button type="button" data-preview-void-deliver>Отправить демо-запрос</button>
    </section>
    <section class="preview-void__conflict" data-preview-void-conflict hidden>
      <h3>Ничего не перезаписано</h3>
      <p>На серверной стороне есть более новая версия <strong data-preview-void-conflict-version></strong>. Локальный запрос остаётся pending. Разрешение конфликта — отдельное явное действие будущего flow.</p>
    </section>
  </section>`;
}

export async function mountSyntheticPreviewTransactionVoid({
  document = globalThis.document,
  indexedDb = globalThis.indexedDB,
  sender = createSyntheticPreviewTransactionVoidSender(),
  candidates = listPreviewTransactionVoidCandidates(),
  randomUuid = () => globalThis.crypto?.randomUUID?.(),
  now = () => new Date().toISOString(),
} = {}) {
  if (!document?.querySelector) fail('PREVIEW_VOID_DOCUMENT_REQUIRED');
  if (document.querySelector('[data-preview-transaction-void]')) return;
  const main = document.querySelector('main');
  if (!main) fail('PREVIEW_VOID_MAIN_REQUIRED');
  if (!Array.isArray(candidates) || candidates.length === 0) fail('PREVIEW_VOID_EVIDENCE_INVALID');

  const outbox = createIndexedDbPreviewOutbox(indexedDb);
  const controller = createPreviewTransactionVoidController({ candidates, outbox, sender, randomUuid, now });
  main.insertAdjacentHTML('beforeend', panelMarkup(candidates));

  const panel = document.querySelector('[data-preview-transaction-void]');
  const operationSelect = panel.querySelector('[data-preview-void-operation]');
  const openButton = panel.querySelector('[data-preview-void-open]');
  const status = panel.querySelector('[data-preview-void-status]');
  const pendingCount = panel.querySelector('[data-preview-void-pending-count]');
  const confirmation = panel.querySelector('[data-preview-void-confirmation]');
  const confirmationCopy = panel.querySelector('[data-preview-void-confirm-copy]');
  const confirmButton = panel.querySelector('[data-preview-void-confirm]');
  const cancelButton = panel.querySelector('[data-preview-void-cancel]');
  const pendingPanel = panel.querySelector('[data-preview-void-pending]');
  const deliverButton = panel.querySelector('[data-preview-void-deliver]');
  const conflictPanel = panel.querySelector('[data-preview-void-conflict]');
  const conflictVersion = panel.querySelector('[data-preview-void-conflict-version]');
  if (!operationSelect || !openButton || !status || !pendingCount || !confirmation || !confirmationCopy || !confirmButton || !cancelButton || !pendingPanel || !deliverButton || !conflictPanel || !conflictVersion) {
    fail('PREVIEW_VOID_MARKUP_INVALID');
  }

  const render = () => {
    const state = controller.getState();
    status.textContent = state.message;
    pendingCount.textContent = `Локально ожидают: ${state.pendingCount}`;
    if (state.candidate !== null) operationSelect.value = state.candidate.transactionId;
    confirmation.hidden = state.status !== 'CONFIRMING';
    pendingPanel.hidden = !['PENDING', 'DEGRADED', 'DELIVERING'].includes(state.status) || state.pendingIntent === null;
    conflictPanel.hidden = state.status !== 'CONFLICT';
    if (state.conflictVersion !== null) conflictVersion.textContent = String(state.conflictVersion);
    if (state.candidate !== null) confirmationCopy.textContent = `${typeLabel(state.candidate.type)} · ${state.candidate.label} · версия ${state.candidate.version}`;
    const locked = ['CONFIRMING', 'PENDING', 'DELIVERING', 'CONFLICT'].includes(state.status) || (state.status === 'DEGRADED' && state.pendingIntent !== null);
    operationSelect.disabled = locked;
    openButton.disabled = state.status !== 'READY';
    confirmButton.disabled = state.status !== 'CONFIRMING';
    cancelButton.disabled = state.status !== 'CONFIRMING';
    deliverButton.disabled = state.status === 'DELIVERING' || state.status === 'CONFLICT' || state.pendingIntent === null;
    deliverButton.textContent = state.status === 'DEGRADED' ? 'Повторить демо-отправку' : 'Отправить демо-запрос';
  };

  operationSelect.addEventListener('change', () => {
    try {
      controller.selectTransaction(operationSelect.value);
    } catch {
      status.textContent = 'Нельзя выбрать операцию, пока текущий локальный запрос не завершён.';
    }
    render();
  });
  openButton.addEventListener('click', () => {
    controller.openConfirmation();
    render();
  });
  cancelButton.addEventListener('click', () => {
    controller.cancelConfirmation();
    render();
  });
  confirmButton.addEventListener('click', async () => {
    await controller.confirm();
    render();
  });
  deliverButton.addEventListener('click', async () => {
    await controller.deliver();
    render();
  });

  await controller.restore();
  render();
  return controller;
}

export const previewTransactionVoidContract = Object.freeze({
  allowedTypes: ORDINARY_TYPES,
  requiresGranularity: 'TRANSACTION',
  requiresDatePrecision: 'DAY',
  requiresStatus: 'POSTED',
});
