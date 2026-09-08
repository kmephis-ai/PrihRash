import { hasActiveReaderFilters, normalizeReaderFilters } from './reader-filters.mjs';
import { refreshRecentOperations } from './reader-load.mjs';
import { parseReaderResponse, sanitizeReaderResponse } from './presentation.mjs';

export function createRecentOperationsView({ cache, fetchRecent, render, setStatus, clock = () => new Date() }) {
  let generation = 0;

  function isCurrent(value) {
    return value === generation;
  }

  async function load(selection = {}) {
    const filters = normalizeReaderFilters(selection);
    const currentGeneration = ++generation;

    if (!hasActiveReaderFilters(filters)) {
      await refreshRecentOperations({
        cache,
        fetchRecent: () => fetchRecent(filters),
        render: (items) => { if (isCurrent(currentGeneration)) render(items); },
        setStatus: (status) => { if (isCurrent(currentGeneration)) setStatus(status); },
        clock,
      });
      return;
    }

    if (isCurrent(currentGeneration)) {
      render([]);
      setStatus({ kind: 'filter-loading' });
    }

    try {
      const networkValue = await fetchRecent(filters);
      const safeResponse = sanitizeReaderResponse(networkValue);
      const items = parseReaderResponse(safeResponse);
      if (!isCurrent(currentGeneration)) return;
      render(items);
      setStatus({ kind: 'filtered-fresh' });
    } catch {
      if (!isCurrent(currentGeneration)) return;
      setStatus({ kind: 'filtered-error' });
    }
  }

  return { load };
}
