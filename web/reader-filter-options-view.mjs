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
  let hasVisibleOptions = false;

  function replaceVisible(options) {
    render(options);
    hasVisibleOptions = true;
  }

  async function load() {
    const currentGeneration = ++generation;
    let cached = null;

    try {
      cached = await cache.read();
    } catch {
      // IndexedDB availability must not block the network Reader path.
    }

    if (cached !== null && currentGeneration === generation) {
      replaceVisible(cached.response);
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

      replaceVisible(safe);
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


  async function refresh() {
    const currentGeneration = ++generation;
    const hadVisibleOptions = hasVisibleOptions;
    try {
      const safe = sanitizeReaderFilterOptions(await fetchOptions());
      if (currentGeneration !== generation) return false;

      const savedAt = clock().toISOString();
      let persisted = true;
      try {
        await cache.write(safe, savedAt);
      } catch {
        persisted = false;
      }
      if (currentGeneration !== generation) return false;

      replaceVisible(safe);
      setStatus({ kind: persisted ? 'fresh' : 'fresh-uncached', savedAt });
      return true;
    } catch {
      if (currentGeneration !== generation) return false;
      setStatus({ kind: 'refresh-error', hasVisibleOptions: hadVisibleOptions });
      return false;
    }
  }

  return Object.freeze({ load, refresh });
}
