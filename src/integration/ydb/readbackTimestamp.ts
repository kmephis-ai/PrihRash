/**
 * Normalize a YDB Timestamp value returned by the pinned JS SDK.
 *
 * @ydbjs/value decodes Timestamp columns to native Date instances, while
 * synthetic transports and some callers may still provide the original ISO
 * string. Keep strings byte-for-byte stable after validation and convert only
 * native Dates to ISO so higher layers do not depend on provider object types.
 */
export function normalizeYdbTimestampReadback(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (
    typeof value !== 'string'
    || value.length === 0
    || value !== value.trim()
    || !Number.isFinite(Date.parse(value))
  ) {
    return null;
  }
  return value;
}

export function ydbTimestampReadbackMatches(value: unknown, expected: string | null): boolean {
  if (expected === null) return value === null;

  const actualTimestamp = normalizeYdbTimestampReadback(value);
  const expectedTimestamp = normalizeYdbTimestampReadback(expected);
  if (actualTimestamp === null || expectedTimestamp === null) return false;

  return Date.parse(actualTimestamp) === Date.parse(expectedTimestamp);
}
