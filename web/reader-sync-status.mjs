const STATES = new Set(['READY', 'DEGRADED', 'UNAVAILABLE']);
const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;

function invalidSyncStatus() {
  throw new Error('INVALID_READER_SYNC_STATUS');
}

function safeTimestamp(value) {
  if (
    typeof value !== 'string'
    || !RFC3339_UTC_PATTERN.test(value)
    || !Number.isFinite(Date.parse(value))
  ) {
    invalidSyncStatus();
  }
  return value;
}

export function sanitizeReaderSyncStatus(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidSyncStatus();
  if (Object.keys(value).sort().join(',') !== 'apiVersion,hasIncompleteRun,lastCommittedAt,state') invalidSyncStatus();
  if (value.apiVersion !== 1 || !STATES.has(value.state) || typeof value.hasIncompleteRun !== 'boolean') invalidSyncStatus();

  if (value.state === 'UNAVAILABLE') {
    if (value.lastCommittedAt !== null) invalidSyncStatus();
    return Object.freeze({
      apiVersion: 1,
      state: 'UNAVAILABLE',
      lastCommittedAt: null,
      hasIncompleteRun: value.hasIncompleteRun,
    });
  }

  if (value.lastCommittedAt === null) invalidSyncStatus();
  if (value.state === 'READY' && value.hasIncompleteRun) invalidSyncStatus();
  if (value.state === 'DEGRADED' && !value.hasIncompleteRun) invalidSyncStatus();

  return Object.freeze({
    apiVersion: 1,
    state: value.state,
    lastCommittedAt: safeTimestamp(value.lastCommittedAt),
    hasIncompleteRun: value.hasIncompleteRun,
  });
}

export function formatReaderSyncStatus(value, formatter = null) {
  const safe = sanitizeReaderSyncStatus(value);
  if (safe.state === 'UNAVAILABLE') return 'Синхронизация: подтверждённой копии ещё нет';

  const format = formatter ?? ((timestamp) => new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp)));
  const lastCommittedLabel = format(safe.lastCommittedAt);

  if (safe.state === 'DEGRADED') {
    return `Синхронизация: требуется проверка · последняя успешная ${lastCommittedLabel}`;
  }
  return `Синхронизация: ${lastCommittedLabel}`;
}
