import {
  YdbAdapter,
  writeStatement,
  type YdbStatement,
} from '../integration/ydb/adapter.js';
import {
  listStructParameter,
  type YdbListStructColumn,
  type YdbScalarParameter,
} from '../integration/ydb/parameters.js';
import {
  PRELIVE_PROMOTION_QUERY_BYTES_LIMIT,
  assessAtomicPromotionWrites,
  type PromotionWrite,
} from './atomicPromotion.js';
import type {
  ControlledInitialRebuildBatch,
  ControlledInitialRebuildPlan,
} from './initialControlledRebuild.js';
import { retargetInitialVerifiedCurrentWritesToStaging } from './initialControlledRebuildRetarget.js';
import type {
  InitialVerifiedCurrentWriteRole,
  PreparedInitialVerifiedCurrentWrite,
} from './initialVerifiedCurrentPersistence.js';

export interface PreparedControlledRebuildStagingBatch {
  readonly index: number;
  readonly writes: readonly Readonly<PreparedInitialVerifiedCurrentWrite>[];
  readonly estimatedParameterBytes: number;
}

export interface ControlledRebuildStagingExecutionResult {
  readonly completedBatchIndexes: readonly number[];
  readonly completedWriteCount: number;
}

export type ControlledRebuildStagingExecutorErrorCode =
  | 'INVALID_BATCH_INDEX'
  | 'INVALID_STAGING_BATCH'
  | 'STAGING_BATCH_NOT_ATOMIC_ELIGIBLE'
  | 'STAGING_WRITE_SHAPE_INVALID'
  | 'STAGING_BATCH_QUERY_TOO_LARGE';

export class ControlledRebuildStagingExecutorError extends Error {
  readonly code: ControlledRebuildStagingExecutorErrorCode;

  constructor(code: ControlledRebuildStagingExecutorErrorCode) {
    super(code);
    this.name = 'ControlledRebuildStagingExecutorError';
    this.code = code;
  }
}

interface ParsedStagingWrite {
  readonly role: InitialVerifiedCurrentWriteRole;
  readonly path: string;
  readonly columns: readonly string[];
  readonly row: Readonly<Record<string, YdbScalarParameter>>;
}

interface StagingBulkGroup {
  readonly role: InitialVerifiedCurrentWriteRole;
  readonly path: string;
  readonly columns: readonly string[];
  readonly tableColumns: readonly Readonly<YdbListStructColumn>[];
  readonly rows: YdbScalarParameterRow[];
}

type YdbScalarParameterRow = Readonly<Record<string, YdbScalarParameter>>;

const STAGING_UPSERT_PATTERN = /^UPSERT INTO `(rebuild\/r_[0-9a-f]{32}\/(transactions|source_records))` \(([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*)\) VALUES \((\$[A-Za-z_][A-Za-z0-9_]*(?:, \$[A-Za-z_][A-Za-z0-9_]*)*)\)$/;
const TEXT_ENCODER = new TextEncoder();

function asPromotionWrite(write: Readonly<PreparedInitialVerifiedCurrentWrite>): PromotionWrite {
  return Object.freeze({
    statement: write.statement,
    estimatedParameterBytes: write.estimatedParameterBytes,
  });
}

function prepareBatch(
  batch: Readonly<ControlledInitialRebuildBatch>,
  controlled: Readonly<ControlledInitialRebuildPlan>,
): Readonly<PreparedControlledRebuildStagingBatch> {
  if (!Number.isSafeInteger(batch.index) || batch.index < 0 || batch.writes.length === 0) {
    throw new ControlledRebuildStagingExecutorError('INVALID_STAGING_BATCH');
  }

  const writes = retargetInitialVerifiedCurrentWritesToStaging(batch.writes, controlled.stagingTables);
  const assessment = assessAtomicPromotionWrites(writes.map(asPromotionWrite));
  if (!assessment.eligible) {
    throw new ControlledRebuildStagingExecutorError('STAGING_BATCH_NOT_ATOMIC_ELIGIBLE');
  }

  return Object.freeze({
    index: batch.index,
    writes,
    estimatedParameterBytes: assessment.totalEstimatedParameterBytes,
  });
}

function parseRetargetedWrite(
  write: Readonly<PreparedInitialVerifiedCurrentWrite>,
): Readonly<ParsedStagingWrite> {
  const match = STAGING_UPSERT_PATTERN.exec(write.statement.text);
  if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined || match[4] === undefined) {
    throw new ControlledRebuildStagingExecutorError('STAGING_WRITE_SHAPE_INVALID');
  }

  const expectedLeaf = write.role === 'TRANSACTION' ? 'transactions' : 'source_records';
  if (match[2] !== expectedLeaf) {
    throw new ControlledRebuildStagingExecutorError('STAGING_WRITE_SHAPE_INVALID');
  }

  const columns = match[3].split(', ');
  const parameters = match[4].split(', ').map((value) => value.slice(1));
  if (
    columns.length === 0
    || columns.length !== parameters.length
    || columns.some((column, index) => column !== parameters[index])
    || new Set(columns).size !== columns.length
  ) {
    throw new ControlledRebuildStagingExecutorError('STAGING_WRITE_SHAPE_INVALID');
  }

  const actualParameters = Object.keys(write.statement.parameters).sort();
  const expectedParameters = [...columns].sort();
  if (
    actualParameters.length !== expectedParameters.length
    || actualParameters.some((name, index) => name !== expectedParameters[index])
  ) {
    throw new ControlledRebuildStagingExecutorError('STAGING_WRITE_SHAPE_INVALID');
  }

  const row: Record<string, YdbScalarParameter> = {};
  for (const column of columns) {
    const parameter = write.statement.parameters[column];
    if (parameter === undefined || parameter.type === 'ListStruct') {
      throw new ControlledRebuildStagingExecutorError('STAGING_WRITE_SHAPE_INVALID');
    }
    if (column === 'id' && (parameter.type !== 'Uuid' || parameter.value === null)) {
      throw new ControlledRebuildStagingExecutorError('STAGING_WRITE_SHAPE_INVALID');
    }
    row[column] = parameter;
  }

  return Object.freeze({
    role: write.role,
    path: match[1],
    columns: Object.freeze(columns),
    row: Object.freeze(row),
  });
}

function newBulkGroup(parsed: Readonly<ParsedStagingWrite>): StagingBulkGroup {
  const tableColumns = parsed.columns.map((name): Readonly<YdbListStructColumn> => {
    const parameter = parsed.row[name];
    if (parameter === undefined) {
      throw new ControlledRebuildStagingExecutorError('STAGING_WRITE_SHAPE_INVALID');
    }
    return Object.freeze({
      name,
      type: parameter.type,
      // R1 transactions/source_records have only the primary-key id as NOT NULL.
      nullable: name !== 'id',
    });
  });
  return {
    role: parsed.role,
    path: parsed.path,
    columns: parsed.columns,
    tableColumns: Object.freeze(tableColumns),
    rows: [parsed.row],
  };
}

function appendBulkRow(group: StagingBulkGroup, parsed: Readonly<ParsedStagingWrite>): void {
  if (
    parsed.role !== group.role
    || parsed.path !== group.path
    || parsed.columns.length !== group.columns.length
    || parsed.columns.some((name, index) => name !== group.columns[index])
  ) {
    throw new ControlledRebuildStagingExecutorError('STAGING_WRITE_SHAPE_INVALID');
  }

  for (const column of group.tableColumns) {
    const parameter = parsed.row[column.name];
    if (
      parameter === undefined
      || parameter.type !== column.type
      || (!column.nullable && parameter.value === null)
    ) {
      throw new ControlledRebuildStagingExecutorError('STAGING_WRITE_SHAPE_INVALID');
    }
  }
  group.rows.push(parsed.row);
}

function buildBulkStatement(group: Readonly<StagingBulkGroup>): Readonly<YdbStatement> {
  const columnList = group.columns.join(', ');
  const statement = writeStatement(
    `UPSERT INTO \`${group.path}\` (${columnList}) SELECT ${columnList} FROM AS_TABLE($rows)`,
    { rows: listStructParameter(group.tableColumns, group.rows) },
  );
  if (TEXT_ENCODER.encode(statement.text).byteLength > PRELIVE_PROMOTION_QUERY_BYTES_LIMIT) {
    throw new ControlledRebuildStagingExecutorError('STAGING_BATCH_QUERY_TOO_LARGE');
  }
  return statement;
}

function buildBulkBatchStatements(
  writes: readonly Readonly<PreparedInitialVerifiedCurrentWrite>[],
): readonly Readonly<YdbStatement>[] {
  const groups = new Map<InitialVerifiedCurrentWriteRole, StagingBulkGroup>();
  const order: InitialVerifiedCurrentWriteRole[] = [];

  for (const write of writes) {
    const parsed = parseRetargetedWrite(write);
    const existing = groups.get(parsed.role);
    if (existing === undefined) {
      groups.set(parsed.role, newBulkGroup(parsed));
      order.push(parsed.role);
    } else {
      appendBulkRow(existing, parsed);
    }
  }

  return Object.freeze(order.map((role) => {
    const group = groups.get(role);
    if (group === undefined) {
      throw new ControlledRebuildStagingExecutorError('STAGING_WRITE_SHAPE_INVALID');
    }
    return buildBulkStatement(group);
  }));
}

export function prepareControlledRebuildStagingBatches(
  controlled: Readonly<ControlledInitialRebuildPlan>,
): readonly Readonly<PreparedControlledRebuildStagingBatch>[] {
  const prepared = controlled.batches.map((batch, expectedIndex) => {
    if (batch.index !== expectedIndex) {
      throw new ControlledRebuildStagingExecutorError('INVALID_BATCH_INDEX');
    }
    return prepareBatch(batch, controlled);
  });
  return Object.freeze(prepared);
}

export async function executeControlledRebuildStagingBatches(
  adapter: YdbAdapter,
  batches: readonly Readonly<PreparedControlledRebuildStagingBatch>[],
): Promise<Readonly<ControlledRebuildStagingExecutionResult>> {
  const completedBatchIndexes: number[] = [];
  let completedWriteCount = 0;

  for (const [expectedIndex, batch] of batches.entries()) {
    if (batch.index !== expectedIndex || batch.writes.length === 0) {
      throw new ControlledRebuildStagingExecutorError('INVALID_BATCH_INDEX');
    }
    const assessment = assessAtomicPromotionWrites(batch.writes.map(asPromotionWrite));
    if (!assessment.eligible) {
      throw new ControlledRebuildStagingExecutorError('STAGING_BATCH_NOT_ATOMIC_ELIGIBLE');
    }
    const statements = buildBulkBatchStatements(batch.writes);

    await adapter.serializableReadWrite(async (transaction) => {
      // The batch remains one atomic transaction, but uses at most one AS_TABLE UPSERT per
      // staging table instead of one provider round-trip per row.
      for (const statement of statements) {
        await transaction.execute(statement);
      }
    });

    completedBatchIndexes.push(batch.index);
    completedWriteCount += batch.writes.length;
  }

  return Object.freeze({
    completedBatchIndexes: Object.freeze(completedBatchIndexes),
    completedWriteCount,
  });
}
