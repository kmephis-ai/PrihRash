import { parseReaderResponse, sanitizeReaderResponse } from './presentation.mjs';

function isoNow(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('INVALID_CLOCK');
  return date.toISOString();
}

export async function refreshRecentOperations({
  cache,
  fetchRecent,
  render,
  setStatus,
  onFreshResponse = () => {},
  clock = () => new Date(),
}) {
  let cached = null;
  try {
    cached = await cache.read();
  } catch {
    cached = null;
  }

  if (cached) {
    render(parseReaderResponse(cached.response));
    setStatus({ kind: 'cached', savedAt: cached.savedAt });
  }

  try {
    const networkValue = await fetchRecent();
    const safeResponse = sanitizeReaderResponse(networkValue);
    const items = parseReaderResponse(safeResponse);
    const savedAt = isoNow(clock);

    try {
      await cache.write(safeResponse, savedAt);
      render(items);
      setStatus({ kind: 'fresh', savedAt });
    } catch {
      render(items);
      setStatus({ kind: 'fresh-uncached', savedAt });
    }
    onFreshResponse(safeResponse);
  } catch {
    if (cached) {
      setStatus({ kind: 'offline', savedAt: cached.savedAt });
      return;
    }
    setStatus({ kind: 'error', savedAt: null });
  }
}
