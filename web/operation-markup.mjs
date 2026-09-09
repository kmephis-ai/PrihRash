function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function qualityBadgesMarkup(quality, className = 'badges') {
  if (!quality.length) return '';
  return `<div class="${className}">${quality.map((badge) => `<span>${escapeHtml(badge)}</span>`).join('')}</div>`;
}

function noteMarkup(note, className) {
  if (!note) return '';
  return `<div class="${className}"><span class="operation-note__label">Примечание:</span> ${escapeHtml(note)}</div>`;
}

function tableContextMarkup(item) {
  const structured = item.meta ? `<div class="operation-table__context-main">${escapeHtml(item.meta)}</div>` : '';
  return `${structured}${noteMarkup(item.note, 'operation-table__note')}` || '—';
}

export function operationCardsMarkup(items) {
  return items.map((item) => `
    <article class="operation-card" data-operation-id="${escapeHtml(item.id)}">
      <div class="operation-card__top"><strong>${escapeHtml(item.description)}</strong><span>${escapeHtml(item.amountLabel)}</span></div>
      <div class="operation-card__meta">${escapeHtml(item.typeLabel)} · ${escapeHtml(item.dateLabel)}${item.meta ? ` · ${escapeHtml(item.meta)}` : ''}</div>
      ${noteMarkup(item.note, 'operation-card__note')}
      ${qualityBadgesMarkup(item.quality)}
    </article>`).join('');
}

export function operationTableRowsMarkup(items) {
  return items.map((item) => `
    <tr data-operation-id="${escapeHtml(item.id)}">
      <td class="operation-table__date">${escapeHtml(item.dateLabel)}</td>
      <td class="operation-table__description"><strong>${escapeHtml(item.description)}</strong></td>
      <td>${escapeHtml(item.typeLabel)}</td>
      <td class="operation-table__context">${tableContextMarkup(item)}</td>
      <td class="operation-table__amount">${escapeHtml(item.amountLabel)}</td>
      <td class="operation-table__quality">${item.quality.length ? qualityBadgesMarkup(item.quality, 'table-badges') : '—'}</td>
    </tr>`).join('');
}
