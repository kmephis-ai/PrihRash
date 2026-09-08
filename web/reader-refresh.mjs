export function createReaderRefreshController({
  refreshOperations,
  refreshFilterOptions,
  refreshSyncStatus,
  setRefreshing = () => {},
}) {
  let active = null;

  function refresh() {
    if (active !== null) return active;
    setRefreshing(true);
    active = Promise.allSettled([
      Promise.resolve().then(refreshOperations),
      Promise.resolve().then(refreshFilterOptions),
      Promise.resolve().then(refreshSyncStatus),
    ]).finally(() => {
      active = null;
      setRefreshing(false);
    });
    return active;
  }

  return Object.freeze({ refresh });
}
