import { readStatement, type YdbReadScope } from '../integration/ydb/adapter.js';

export type InitialBootstrapStaleStagingRetirementDiagnostic =
  | 'STALE_STAGING_CURRENT_STATE_EMPTY'
  | 'STALE_STAGING_CURRENT_STATE_NOT_EMPTY'
  | 'STALE_STAGING_CURRENT_STATE_DIAGNOSTIC_FAILED';

interface CountRow {
  readonly row_count?: unknown;
}

function exactCount(rows: readonly Readonly<CountRow>[]): number | null {
  if (rows.length !== 1) return null;
  const value = rows[0]?.row_count;
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

async function readCount(reader: YdbReadScope, table: 'source_records' | 'transactions'): Promise<number | null> {
  const result = await reader.read<CountRow>(readStatement(
    `SELECT COUNT(*) AS row_count FROM ${table}`,
  ));
  return exactCount(result.rows);
}

export async function readInitialBootstrapStaleStagingRetirementCurrentState(
  reader: YdbReadScope,
): Promise<InitialBootstrapStaleStagingRetirementDiagnostic> {
  const sourceRecordCount = await readCount(reader, 'source_records');
  const transactionCount = await readCount(reader, 'transactions');
  if (sourceRecordCount === null || transactionCount === null) {
    return 'STALE_STAGING_CURRENT_STATE_DIAGNOSTIC_FAILED';
  }
  return sourceRecordCount === 0 && transactionCount === 0
    ? 'STALE_STAGING_CURRENT_STATE_EMPTY'
    : 'STALE_STAGING_CURRENT_STATE_NOT_EMPTY';
}

export function diagnoseInitialBootstrapStaleStagingRetirementCurrentState(
  reader: YdbReadScope,
): Promise<InitialBootstrapStaleStagingRetirementDiagnostic> {
  // Keep provider/query failures outside this helper. Transactional callers must
  // let the YDB SDK observe retryable errors; recovery callers already sanitize
  // failures at their external enum-only boundary.
  return readInitialBootstrapStaleStagingRetirementCurrentState(reader);
}
