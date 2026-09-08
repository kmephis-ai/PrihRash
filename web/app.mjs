import { createIndexedDbReaderCache } from './reader-cache.mjs';
import { refreshRecentOperations } from './reader-load.mjs';

const list = document.querySelector('[data-operations]');
const state = document.querySelector('[data-state]');
const syncState = document.querySelector('[data-sync-state]');
const cache = createIndexedDbReaderCache();

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function render(items) {
  list.innerHTML = '';
  state.hidden = true;
  if (!items.length) {
    state.textContent = 'Операций пока нет.';
    state.hidden = false;
    return;
  }
  list.innerHTML = items.map((item) => `
    <article class="operation-card">
      <div class="operation-card__top"><strong>${escapeHtml(item.description)}</strong><span>${escapeHtml(item.amountLabel)}</span></div>
      <div class="operation-card__meta">${escapeHtml(item.typeLabel)} · ${escapeHtml(item.dateLabel)}${item.meta ? ` · ${escapeHtml(item.meta)}` : ''}</div>
      ${item.quality.length ? `<div class="badges">${item.quality.map((badge) => `<span>${escapeHtml(badge)}</span>`).join('')}</div>` : ''}
    </article>`).join('');
}

function savedLabel(savedAt) {
  try {
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(savedAt));
  } catch {
    return 'ранее';
  }
}

function setStatus(status) {
  state.hidden = true;
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
  syncState.textContent = '';
  state.textContent = 'Не удалось загрузить операции. Попробуйте обновить экран.';
  state.hidden = false;
}

async function fetchRecent() {
  const response = await fetch('/api/v1/operations/recent?limit=50', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('REQUEST_FAILED');
  return response.json();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
refreshRecentOperations({ cache, fetchRecent, render, setStatus });
