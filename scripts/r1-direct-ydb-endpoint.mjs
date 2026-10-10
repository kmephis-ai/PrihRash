// Strict, side-effect-free validation of the exact provider-supplied YDB DSN.
export function isExactYdbEndpoint(dsn, databasePath) {
  if (typeof dsn !== 'string' || typeof databasePath !== 'string') return false;
  if (!/^\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+$/.test(databasePath)) return false;
  try {
    const url = new URL(dsn);
    return url.protocol === 'grpcs:'
      && url.hostname.length > 0
      && url.port === '2135'
      && url.pathname === ''
      && url.username === ''
      && url.password === ''
      && url.hash === ''
      && url.searchParams.size === 1
      && url.searchParams.get('database') === databasePath;
  } catch {
    return false;
  }
}
