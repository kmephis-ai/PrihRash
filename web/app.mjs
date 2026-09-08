import { createIndexedDbReaderCache } from './reader-cache.mjs';
import { buildRecentOperationsUrl, hasActiveReaderFilters } from './reader-filters.mjs';
import { createRecentOperationsView } from './reader-view.mjs';

const list = document.querySelector('[data-operations]');
const state = document.querySelector('[data-state]');
const syncState = document.querySelector('[data-sync-state]');
const typeFilter = document.querySelector('[data-filter-type]');
const statusFilter = document.querySelector('[data-filter-status]');
const resetFilters = document.querySelector('[data-reset-filters]');
const loadMore = document.querySelector('[data-load-more]');
const pageState = document.querySelector('[data-page-state]');
const cache = createIndexedDbReaderCache();

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function operationMarkup(items) {
  return items.map((item) => `
    <article class="operation-card">
      <div class="operation-card__top"><strong>${escapeHtml(item.description)}</strong><span>${escapeHtml(item.amountLabel)}</span></div>
      <div class="operation-card__meta">${escapeHtml(item.typeLabel)} · ${escapeHtml(item.dateLabel)}${item.meta ? ` · ${escapeHtml(item.meta)}` : ''}</div>
      ${item.quality.length ? `<div class="badges">${item.quality.map((badge) => `<span>${escapeHtml(badge)}</span>`).join('')}</div>` : ''}
    </article>`).join('');
}

function render(items) {
  list.innerHTML = '';
  if (!items.length) {
    state.textContent = 'Операций пока нет.';
    state.hidden = false;
    return;
  }
  state.hidden = true;
  list.innerHTML = operationMarkup(items);
}

function append(items) {
  if (!items.length) return;
  state.hidden = true;
  list.insertAdjacentHTML('beforeend', operationMarkup(items));
}

function savedLabel(savedAt) {
  try {
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(savedAt));
  } catch {
    return 'ранее';
  }
}

function setStatus(status) {
  if (status.kind === 'cached') {
    syncState.textContent = `Локальные данные от ${savedLabel(status.savedAt)} · обновляем…`;
    return;
  }
  if (status.kind === 'offline') {
    syncState.textContent = `Офлайн · локальные данные от ${savedLabel(status.savedAt)}`;
    return;
  }
  if (status.kind === 'fresh-uncached') {
    syncState.textContent = 'Обновлено · локальное сохранение недоступно';
    return;
  }
  if (status.kind === 'fresh') {
    syncState.textContent = 'Обновлено';
    return;
  }
  if (status.kind === 'filter-loading') {
    syncState.textContent = 'Фильтр · загрузка…';
    state.textContent = 'Загрузка выбранного фильтра…';
    state.hidden = false;
    return;
  }
  if (status.kind === 'filtered-fresh') {
    syncState.textContent = 'Фильтр применён';
    return;
  }
  if (status.kind === 'filtered-error') {
    syncState.textContent = '';
    state.textContent = 'Не удалось загрузить выбранный фильтр.';
    state.hidden = false;
    return;
  }
  syncState.textContent = '';
  state.textContent = 'Не удалось загрузить операции. Попробуйте обновить экран.';
  state.hidden = false;
}

async function fetchRecent(filters, cursor = null) {
  const response = await fetch(buildRecentOperationsUrl(filters, cursor), {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('REQUEST_FAILED');
  return response.json();
}

function selectedFilters() {
  return {
    type: typeFilter.value || null,
    status: statusFilter.value || null,
  };
}

function setPagination(status) {
  pageState.textContent = '';
  loadMore.hidden = status.kind === 'hidden';
  loadMore.disabled = false;
  loadMore.textContent = 'Загрузить ещё';
  if (status.kind === 'ready') {
    loadMore.hidden = false;
    return;
  }
  if (status.kind === 'loading') {
    loadMore.hidden = false;
    loadMore.disabled = true;
    loadMore.textContent = 'Загружаем…';
    return;
  }
  if (status.kind === 'error') {
    loadMore.hidden = false;
    pageState.textContent = 'Не удалось загрузить ещё. Можно повторить.';
    return;
  }
  if (status.kind === 'done') {
    loadMore.hidden = true;
    pageState.textContent = 'Больше операций нет.';
  }
}

const view = createRecentOperationsView({ cache, fetchRecent, render, append, setStatus, setPagination });

function applyFilters() {
  const filters = selectedFilters();
  resetFilters.hidden = !hasActiveReaderFilters(filters);
  view.load(filters);
}

typeFilter.addEventListener('change', applyFilters);
statusFilter.addEventListener('change', applyFilters);
loadMore.addEventListener('click', () => { view.loadMore(); });
resetFilters.addEventListener('click', () => {
  typeFilter.value = '';
  statusFilter.value = '';
  applyFilters();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
applyFilters();
