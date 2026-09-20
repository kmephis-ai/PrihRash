import { readStatement, type YdbStatement, YdbAdapter } from '../integration/ydb/adapter.js';

export const INITIAL_BOOTSTRAP_STALE_VALIDATED_FAILURE_CODE =
  'INITIAL_BOOTSTRAP_STALE_VALIDATED_SNAPSHOT';

export type InitialBootstrapGateCGuardErrorCode = 'MALFORMED_GATE_C_BLOCKER_EVIDENCE';

export class InitialBootstrapGateCGuardError extends Error {
  readonly code: InitialBootstrapGateCGuardErrorCode;

  constructor(code: InitialBootstrapGateCGuardErrorCode) {
    super(code);
    this.name = 'InitialBootstrapGateCGuardError';
    this.code = code;
  }
}

interface GateCBlockerRow {
  readonly row_count?: unknown;
}

function count(value: unknown): number {
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new InitialBootstrapGateCGuardError('MALFORMED_GATE_C_BLOCKER_EVIDENCE');
    }
    return Number(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  throw new InitialBootstrapGateCGuardError('MALFORMED_GATE_C_BLOCKER_EVIDENCE');
}

export function initialBootstrapGateCBlockerStatement(): Readonly<YdbStatement> {
  return readStatement(
    "SELECT COUNT(*) AS row_count FROM migration_runs WHERE state = 'FAILED' AND error_code = '"
      + INITIAL_BOOTSTRAP_STALE_VALIDATED_FAILURE_CODE + "'",
  );
}

export async function hasInitialBootstrapGateCBlocker(adapter: YdbAdapter): Promise<boolean> {
  const result = await adapter.read<GateCBlockerRow>(initialBootstrapGateCBlockerStatement());
  if (result.rows.length !== 1) {
    throw new InitialBootstrapGateCGuardError('MALFORMED_GATE_C_BLOCKER_EVIDENCE');
  }
  return count(result.rows[0]?.row_count) > 0;
}
