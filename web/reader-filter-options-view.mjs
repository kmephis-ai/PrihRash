import { normalizeReaderFilters, sanitizeReaderFilterOptions } from './reader-filters.mjs';

export function reconcileReaderFilterSelection(options, selection = {}) {
  const safe = sanitizeReaderFilterOptions(options);
  const current = normalizeReaderFilters(selection);
  const accountId = current.accountId ?? null;
  const categoryId = current.categoryId ?? null;
  const nextAccountId = accountId !== null && safe.accounts.some((option) => option.id === accountId) ? accountId : null;
  const nextCategoryId = categoryId !== null && safe.categories.some((option) => option.id === categoryId) ? categoryId : null;
  return Object.freeze({
    accountId: nextAccountId,
    categoryId: nextCategoryId,
    accountReset: accountId !== null && nextAccountId === null,
    categoryReset: categoryId !== null && nextCategoryId === null,
  });
}

export function createReaderFilterOptionsView({
  cache,
  fetchOptions,
  render,
  setStatus,
  clock = () => new Date(),
}) {
  let generation = 0;

  async function load() {
    const currentGeneration = ++generation;
    let cached = null;

    try {
      cached = await cache.read();
    } catch {
      // IndexedDB availability must not block the network Reader path.
    }

    if (cached !== null && currentGeneration === generation) {
      render(cached.response);
      setStatus({ kind: 'cached', savedAt: cached.savedAt });
    }

    try {
      const safe = sanitizeReaderFilterOptions(await fetchOptions());
      if (currentGeneration !== generation) return;

      const savedAt = clock().toISOString();
      let persisted = true;
      try {
        await cache.write(safe, savedAt);
      } catch {
        persisted = false;
      }
      if (currentGeneration !== generation) return;

      render(safe);
      setStatus({ kind: persisted ? 'fresh' : 'fresh-uncached', savedAt });
    } catch {
      if (currentGeneration !== generation) return;
      if (cached !== null) {
        setStatus({ kind: 'offline', savedAt: cached.savedAt });
      } else {
        setStatus({ kind: 'error', savedAt: null });
      }
    }
  }

  return Object.freeze({ load });
}
