import { readStatement, YdbAdapter, type YdbTransaction } from '../integration/ydb/adapter.js';
import type { SourceRowClassification } from '../classification/sourceRow.js';
import type { ControlledInitialRebuildTablePaths } from './initialControlledRebuild.js';
import type {
  InitialControlledRebuildReconciliationSnapshot,
  InitialFinancialTransactionType,
  StagingDimensionAggregate,
  StagingTypeAggregate,
} from './initialControlledRebuildReconciliation.js';

export type ControlledRebuildEvidenceReaderErrorCode =
  | 'INVALID_STAGING_TABLE_PATH'
  | 'MALFORMED_SOURCE_AGGREGATE_ROW'
  | 'MALFORMED_TRANSACTION_AGGREGATE_ROW'
  | 'MALFORMED_DIMENSION_AGGREGATE_ROW'
  | 'DUPLICATE_AGGREGATE_ROW'
  | 'COUNT_OUT_OF_RANGE';

export class ControlledRebuildEvidenceReaderError extends Error {
  readonly code: ControlledRebuildEvidenceReaderErrorCode;

  constructor(code: ControlledRebuildEvidenceReaderErrorCode) {
    super(code);
    this.name = 'ControlledRebuildEvidenceReaderError';
    this.code = code;
  }
}

const STAGING_PATH_PATTERN = /^rebuild\/r_[0-9a-f]{32}\/(transactions|source_records)$/;
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CLASSIFICATIONS: readonly SourceRowClassification[] = Object.freeze([
  'FINANCIAL_RECORD', 'LEGACY_PERIOD_CLOSE', 'NON_FINANCIAL', 'INVALID', 'AMBIGUOUS',
]);

type EvidenceScope = 'STAGING' | 'CURRENT';

interface SourceAggregateRow {
  readonly classification?: unknown;
  readonly state?: unknown;
  readonly row_count?: unknown;
}

interface TransactionAggregateRow {
  readonly type?: unknown;
  readonly row_count?: unknown;
  readonly total_amount_minor?: unknown;
}

interface DimensionAggregateRow extends TransactionAggregateRow {
  readonly dimension_id?: unknown;
}

function quotedPath(
  path: string,
  expectedLeaf: 'transactions' | 'source_records',
  scope: EvidenceScope,
): string {
  if (scope === 'CURRENT') {
    if (path !== expectedLeaf) throw new ControlledRebuildEvidenceReaderError('INVALID_STAGING_TABLE_PATH');
    return `\`${path}\``;
  }
  const match = STAGING_PATH_PATTERN.exec(path);
  if (match === null || match[1] !== expectedLeaf) {
    throw new ControlledRebuildEvidenceReaderError('INVALID_STAGING_TABLE_PATH');
  }
  return `\`${path}\``;
}

function countValue(value: unknown): number {
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ControlledRebuildEvidenceReaderError('COUNT_OUT_OF_RANGE');
    }
    return Number(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  throw new ControlledRebuildEvidenceReaderError('COUNT_OUT_OF_RANGE');
}

function amountValue(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  throw new ControlledRebuildEvidenceReaderError('MALFORMED_TRANSACTION_AGGREGATE_ROW');
}

function addSafe(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new ControlledRebuildEvidenceReaderError('COUNT_OUT_OF_RANGE');
  return value;
}

function classificationCounts(): Record<SourceRowClassification, number> {
  return { FINANCIAL_RECORD: 0, LEGACY_PERIOD_CLOSE: 0, NON_FINANCIAL: 0, INVALID: 0, AMBIGUOUS: 0 };
}

function parseSourceRows(rows: readonly SourceAggregateRow[]): {
  readonly sourceRecordCount: number;
  readonly classificationCounts: Readonly<Record<SourceRowClassification, number>>;
  readonly missingSourceRecordCount: number;
} {
  const counts = classificationCounts();
  const seen = new Set<string>();
  let sourceRecordCount = 0;
  let missingSourceRecordCount = 0;

  for (const row of rows) {
    if (typeof row.classification !== 'string' || !CLASSIFICATIONS.includes(row.classification as SourceRowClassification)) {
      throw new ControlledRebuildEvidenceReaderError('MALFORMED_SOURCE_AGGREGATE_ROW');
    }
    if (row.state !== null && row.state !== 'MISSING') {
      throw new ControlledRebuildEvidenceReaderError('MALFORMED_SOURCE_AGGREGATE_ROW');
    }
    const key = `${row.classification}|${String(row.state)}`;
    if (seen.has(key)) throw new ControlledRebuildEvidenceReaderError('DUPLICATE_AGGREGATE_ROW');
    seen.add(key);

    const count = countValue(row.row_count);
    const classification = row.classification as SourceRowClassification;
    counts[classification] = addSafe(counts[classification], count);
    sourceRecordCount = addSafe(sourceRecordCount, count);
    if (row.state === 'MISSING') missingSourceRecordCount = addSafe(missingSourceRecordCount, count);
  }

  return Object.freeze({
    sourceRecordCount,
    classificationCounts: Object.freeze(counts),
    missingSourceRecordCount,
  });
}

function parseTypeRows(rows: readonly TransactionAggregateRow[]): {
  readonly transactionCount: number;
  readonly typeAggregates: readonly Readonly<StagingTypeAggregate>[];
} {
  const seen = new Set<string>();
  const values: Readonly<StagingTypeAggregate>[] = [];
  let transactionCount = 0;

  for (const row of rows) {
    if (row.type !== 'EXPENSE' && row.type !== 'INCOME') {
      throw new ControlledRebuildEvidenceReaderError('MALFORMED_TRANSACTION_AGGREGATE_ROW');
    }
    if (seen.has(row.type)) throw new ControlledRebuildEvidenceReaderError('DUPLICATE_AGGREGATE_ROW');
    seen.add(row.type);
    const count = countValue(row.row_count);
    const totalAmountMinor = amountValue(row.total_amount_minor);
    transactionCount = addSafe(transactionCount, count);
    values.push(Object.freeze({ type: row.type, count, totalAmountMinor }));
  }

  return Object.freeze({
    transactionCount,
    typeAggregates: Object.freeze(values.sort((a, b) => a.type.localeCompare(b.type))),
  });
}

function parseDimensionRows(
  rows: readonly DimensionAggregateRow[],
  requiredType?: InitialFinancialTransactionType,
): readonly Readonly<StagingDimensionAggregate>[] {
  const seen = new Set<string>();
  const values: Readonly<StagingDimensionAggregate>[] = [];

  for (const row of rows) {
    if (
      (row.type !== 'EXPENSE' && row.type !== 'INCOME')
      || (requiredType !== undefined && row.type !== requiredType)
      || typeof row.dimension_id !== 'string'
      || !UUID_PATTERN.test(row.dimension_id)
    ) {
      throw new ControlledRebuildEvidenceReaderError('MALFORMED_DIMENSION_AGGREGATE_ROW');
    }
    const dimensionId = row.dimension_id.toLowerCase();
    const key = `${row.type}|${dimensionId}`;
    if (seen.has(key)) throw new ControlledRebuildEvidenceReaderError('DUPLICATE_AGGREGATE_ROW');
    seen.add(key);
    values.push(Object.freeze({
      type: row.type,
      dimensionId,
      count: countValue(row.row_count),
      totalAmountMinor: amountValue(row.total_amount_minor),
    }));
  }

  return Object.freeze(values.sort((a, b) => `${a.type}|${a.dimensionId}`.localeCompare(`${b.type}|${b.dimensionId}`)));
}

async function readSnapshot(
  transaction: YdbTransaction,
  tables: Readonly<ControlledInitialRebuildTablePaths>,
  scope: EvidenceScope,
): Promise<Readonly<InitialControlledRebuildReconciliationSnapshot>> {
  const sourceTable = quotedPath(tables.sourceRecords, 'source_records', scope);
  const transactionTable = quotedPath(tables.transactions, 'transactions', scope);

  const source = await transaction.execute<SourceAggregateRow>(readStatement(
    `SELECT classification, state, COUNT(*) AS row_count FROM ${sourceTable} GROUP BY classification, state`,
  ));
  const types = await transaction.execute<TransactionAggregateRow>(readStatement(
    `SELECT type, COUNT(*) AS row_count, SUM(amount_minor) AS total_amount_minor FROM ${transactionTable} GROUP BY type`,
  ));
  const categories = await transaction.execute<DimensionAggregateRow>(readStatement(
    `SELECT type, category_id AS dimension_id, COUNT(*) AS row_count, SUM(amount_minor) AS total_amount_minor FROM ${transactionTable} GROUP BY type, category_id`,
  ));
  const expenseAccounts = await transaction.execute<DimensionAggregateRow>(readStatement(
    `SELECT type, from_account_id AS dimension_id, COUNT(*) AS row_count, SUM(amount_minor) AS total_amount_minor FROM ${transactionTable} WHERE type = 'EXPENSE' GROUP BY type, from_account_id`,
  ));
  const incomeAccounts = await transaction.execute<DimensionAggregateRow>(readStatement(
    `SELECT type, to_account_id AS dimension_id, COUNT(*) AS row_count, SUM(amount_minor) AS total_amount_minor FROM ${transactionTable} WHERE type = 'INCOME' GROUP BY type, to_account_id`,
  ));

  const sourceEvidence = parseSourceRows(source.rows);
  const transactionEvidence = parseTypeRows(types.rows);
  const categoryAggregates = parseDimensionRows(categories.rows);
  const expenseAccountAggregates = parseDimensionRows(expenseAccounts.rows, 'EXPENSE');
  const incomeAccountAggregates = parseDimensionRows(incomeAccounts.rows, 'INCOME');

  return Object.freeze({
    ...sourceEvidence,
    ...transactionEvidence,
    categoryAggregates,
    accountAggregates: Object.freeze([...expenseAccountAggregates, ...incomeAccountAggregates]
      .sort((a, b) => `${a.type}|${a.dimensionId}`.localeCompare(`${b.type}|${b.dimensionId}`))),
  });
}

export async function readControlledRebuildStagingEvidence(
  adapter: YdbAdapter,
  tables: Readonly<ControlledInitialRebuildTablePaths>,
): Promise<Readonly<InitialControlledRebuildReconciliationSnapshot>> {
  return adapter.serializableReadWrite((transaction) => readSnapshot(transaction, tables, 'STAGING'));
}

export async function readControlledRebuildCurrentEvidence(
  adapter: YdbAdapter,
): Promise<Readonly<InitialControlledRebuildReconciliationSnapshot>> {
  return adapter.serializableReadWrite((transaction) => readSnapshot(transaction, {
    transactions: 'transactions',
    sourceRecords: 'source_records',
  }, 'CURRENT'));
}
