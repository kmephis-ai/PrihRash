import { hasActiveReaderFilters, normalizeReaderCursor, normalizeReaderFilters } from './reader-filters.mjs';
import { refreshRecentOperations } from './reader-load.mjs';
import { parseReaderResponse, sanitizeReaderResponse } from './presentation.mjs';

function operationIds(response) {
  return response.items.map((item) => item.id);
}

function pageHasDuplicateIds(existingIds, response) {
  const pageIds = new Set();
  for (const id of operationIds(response)) {
    if (existingIds.has(id) || pageIds.has(id)) return true;
    pageIds.add(id);
  }
  return false;
}

export function createRecentOperationsView({
  cache,
  fetchRecent,
  render,
  append = render,
  setStatus,
  setPagination = () => {},
  clock = () => new Date(),
}) {
  let generation = 0;
  let currentFilters = normalizeReaderFilters();
  let nextCursor = null;
  let visibleIds = new Set();
  let pageLoading = false;

  function isCurrent(value) {
    return value === generation;
  }

  function resetPagination() {
    nextCursor = null;
    visibleIds = new Set();
    pageLoading = false;
    setPagination({ kind: 'hidden' });
  }

  function acceptFreshFirstPage(response) {
    nextCursor = normalizeReaderCursor(response.nextCursor);
    visibleIds = new Set(operationIds(response));
    setPagination({ kind: nextCursor === null ? 'hidden' : 'ready' });
  }

  async function load(selection = {}) {
    const filters = normalizeReaderFilters(selection);
    const currentGeneration = ++generation;
    currentFilters = filters;
    resetPagination();

    if (!hasActiveReaderFilters(filters)) {
      await refreshRecentOperations({
        cache,
        fetchRecent: () => fetchRecent(filters, null),
        render: (items) => { if (isCurrent(currentGeneration)) render(items); },
        setStatus: (status) => { if (isCurrent(currentGeneration)) setStatus(status); },
        onFreshResponse: (response) => { if (isCurrent(currentGeneration)) acceptFreshFirstPage(response); },
        clock,
      });
      return;
    }

    if (isCurrent(currentGeneration)) {
      render([]);
      setStatus({ kind: 'filter-loading' });
    }

    try {
      const networkValue = await fetchRecent(filters, null);
      const safeResponse = sanitizeReaderResponse(networkValue);
      const items = parseReaderResponse(safeResponse);
      if (!isCurrent(currentGeneration)) return;
      render(items);
      setStatus({ kind: 'filtered-fresh' });
      acceptFreshFirstPage(safeResponse);
    } catch {
      if (!isCurrent(currentGeneration)) return;
      setStatus({ kind: 'filtered-error' });
      setPagination({ kind: 'hidden' });
    }
  }

  async function loadMore() {
    if (pageLoading || nextCursor === null) return false;
    const currentGeneration = generation;
    const requestCursor = nextCursor;
    const filters = currentFilters;
    pageLoading = true;
    setPagination({ kind: 'loading' });

    try {
      const networkValue = await fetchRecent(filters, requestCursor);
      const safeResponse = sanitizeReaderResponse(networkValue);
      const items = parseReaderResponse(safeResponse);
      if (!isCurrent(currentGeneration)) return false;
      if (pageHasDuplicateIds(visibleIds, safeResponse)) throw new Error('INCONSISTENT_READER_PAGE');

      append(items);
      for (const id of operationIds(safeResponse)) visibleIds.add(id);
      nextCursor = normalizeReaderCursor(safeResponse.nextCursor);
      setPagination({ kind: nextCursor === null ? 'done' : 'ready' });
      return true;
    } catch {
      if (!isCurrent(currentGeneration)) return false;
      setPagination({ kind: 'error' });
      return false;
    } finally {
      if (isCurrent(currentGeneration)) pageLoading = false;
    }
  }

  return Object.freeze({ load, loadMore });
}
