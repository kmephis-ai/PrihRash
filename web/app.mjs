import { parseReaderResponse } from './presentation.mjs';

const list = document.querySelector('[data-operations]');
const state = document.querySelector('[data-state]');

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function render(items) {
  if (!items.length) {
    state.textContent = 'Операций пока нет.';
    return;
  }
  state.hidden = true;
  list.innerHTML = items.map((item) => `
    <article class="operation-card">
      <div class="operation-card__top"><strong>${escapeHtml(item.description)}</strong><span>${escapeHtml(item.amountLabel)}</span></div>
      <div class="operation-card__meta">${escapeHtml(item.typeLabel)} · ${escapeHtml(item.dateLabel)}${item.meta ? ` · ${escapeHtml(item.meta)}` : ''}</div>
      ${item.quality.length ? `<div class="badges">${item.quality.map((badge) => `<span>${escapeHtml(badge)}</span>`).join('')}</div>` : ''}
    </article>`).join('');
}

async function loadOperations() {
  try {
    const response = await fetch('/api/v1/operations/recent?limit=50', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('REQUEST_FAILED');
    render(parseReaderResponse(await response.json()));
  } catch {
    state.textContent = 'Не удалось загрузить операции. Попробуйте обновить экран.';
  }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
loadOperations();
