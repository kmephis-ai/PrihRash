import { writeStatement } from '../integration/ydb/adapter.js';
import type { ControlledInitialRebuildTablePaths } from './initialControlledRebuild.js';
import type { PreparedInitialVerifiedCurrentWrite } from './initialVerifiedCurrentPersistence.js';

export type ControlledRebuildRetargetErrorCode =
  | 'INVALID_STAGING_TABLE_PATH'
  | 'STATEMENT_ROLE_MISMATCH';

export class ControlledRebuildRetargetError extends Error {
  readonly code: ControlledRebuildRetargetErrorCode;

  constructor(code: ControlledRebuildRetargetErrorCode) {
    super(code);
    this.name = 'ControlledRebuildRetargetError';
    this.code = code;
  }
}

const STAGING_PATH_PATTERN = /^rebuild\/r_[0-9a-f]{32}\/(transactions|source_records)$/;
const TRANSACTION_PREFIX = 'UPSERT INTO transactions ';
const SOURCE_RECORD_PREFIX = 'UPSERT INTO source_records ';

function quotedStagingPath(path: string, expectedLeaf: 'transactions' | 'source_records'): string {
  const match = STAGING_PATH_PATTERN.exec(path);
  if (match === null || match[1] !== expectedLeaf) {
    throw new ControlledRebuildRetargetError('INVALID_STAGING_TABLE_PATH');
  }
  return `\`${path}\``;
}

function retargetOne(
  write: Readonly<PreparedInitialVerifiedCurrentWrite>,
  tables: Readonly<ControlledInitialRebuildTablePaths>,
): Readonly<PreparedInitialVerifiedCurrentWrite> {
  const expectedPrefix = write.role === 'TRANSACTION' ? TRANSACTION_PREFIX : SOURCE_RECORD_PREFIX;
  if (!write.statement.text.startsWith(expectedPrefix)) {
    throw new ControlledRebuildRetargetError('STATEMENT_ROLE_MISMATCH');
  }

  const target = write.role === 'TRANSACTION'
    ? quotedStagingPath(tables.transactions, 'transactions')
    : quotedStagingPath(tables.sourceRecords, 'source_records');
  const text = `UPSERT INTO ${target} ${write.statement.text.slice(expectedPrefix.length)}`;

  return Object.freeze({
    ...write,
    statement: writeStatement(text, write.statement.parameters),
  });
}

export function retargetInitialVerifiedCurrentWritesToStaging(
  writes: readonly Readonly<PreparedInitialVerifiedCurrentWrite>[],
  tables: Readonly<ControlledInitialRebuildTablePaths>,
): readonly Readonly<PreparedInitialVerifiedCurrentWrite>[] {
  return Object.freeze(writes.map((write) => retargetOne(write, tables)));
}
