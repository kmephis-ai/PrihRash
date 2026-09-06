import type { SourceRowClassification } from '../classification/sourceRow.js';
import type { CanonicalTransaction } from '../domain/transaction.js';
import {
  INITIAL_RECONCILIATION_CHECKS,
  type InitialReconciliationCheck,
  type InitialReconciliationEvidence,
} from './initialValidationGate.js';
import type { InitialVerifiedCurrentPlan } from './initialVerifiedCurrentPlan.js';

export type InitialFinancialTransactionType = 'EXPENSE' | 'INCOME';

export interface StagingTypeAggregate {
  readonly type: InitialFinancialTransactionType;
  readonly count: number;
  readonly totalAmountMinor: bigint;
}

export interface StagingDimensionAggregate extends StagingTypeAggregate {
  readonly dimensionId: string;
}

export interface InitialControlledRebuildReconciliationSnapshot {
  readonly sourceRecordCount: number;
  readonly transactionCount: number;
  readonly typeAggregates: readonly Readonly<StagingTypeAggregate>[];
  readonly categoryAggregates: readonly Readonly<StagingDimensionAggregate>[];
  readonly accountAggregates: readonly Readonly<StagingDimensionAggregate>[];
  readonly classificationCounts: Readonly<Record<SourceRowClassification, number>>;
  readonly missingSourceRecordCount: number;
}

export type InitialControlledRebuildReconciliationErrorCode =
  | 'UNSUPPORTED_TRANSACTION_TYPE'
  | 'INVALID_TRANSACTION_SHAPE'
  | 'INVALID_TRANSACTION_AMOUNT'
  | 'INVALID_SOURCE_CLASSIFICATION';

export class InitialControlledRebuildReconciliationError extends Error {
  readonly code: InitialControlledRebuildReconciliationErrorCode;

  constructor(code: InitialControlledRebuildReconciliationErrorCode) {
    super(code);
    this.name = 'InitialControlledRebuildReconciliationError';
    this.code = code;
  }
}

const CLASSIFICATIONS: readonly SourceRowClassification[] = Object.freeze([
  'FINANCIAL_RECORD',
  'LEGACY_PERIOD_CLOSE',
  'NON_FINANCIAL',
  'INVALID',
  'AMBIGUOUS',
]);

function emptyClassificationCounts(): Record<SourceRowClassification, number> {
  return {
    FINANCIAL_RECORD: 0,
    LEGACY_PERIOD_CLOSE: 0,
    NON_FINANCIAL: 0,
    INVALID: 0,
    AMBIGUOUS: 0,
  };
}

function transactionAccountId(transaction: Readonly<CanonicalTransaction>): string {
  if (transaction.type === 'EXPENSE') {
    if (transaction.fromAccountId === null || transaction.toAccountId !== null || transaction.categoryId === null) {
      throw new InitialControlledRebuildReconciliationError('INVALID_TRANSACTION_SHAPE');
    }
    return transaction.fromAccountId;
  }
  if (transaction.type === 'INCOME') {
    if (transaction.toAccountId === null || transaction.fromAccountId !== null || transaction.categoryId === null) {
      throw new InitialControlledRebuildReconciliationError('INVALID_TRANSACTION_SHAPE');
    }
    return transaction.toAccountId;
  }
  throw new InitialControlledRebuildReconciliationError('UNSUPPORTED_TRANSACTION_TYPE');
}

function aggregateKey(type: InitialFinancialTransactionType, dimensionId: string): string {
  return `${type}|${dimensionId.toLowerCase()}`;
}

function addTypeAggregate(
  map: Map<InitialFinancialTransactionType, { count: number; totalAmountMinor: bigint }>,
  type: InitialFinancialTransactionType,
  amountMinor: number,
): void {
  const current = map.get(type) ?? { count: 0, totalAmountMinor: 0n };
  current.count += 1;
  current.totalAmountMinor += BigInt(amountMinor);
  map.set(type, current);
}

function addDimensionAggregate(
  map: Map<string, { type: InitialFinancialTransactionType; dimensionId: string; count: number; totalAmountMinor: bigint }>,
  type: InitialFinancialTransactionType,
  dimensionId: string,
  amountMinor: number,
): void {
  const normalizedId = dimensionId.toLowerCase();
  const key = aggregateKey(type, normalizedId);
  const current = map.get(key) ?? {
    type,
    dimensionId: normalizedId,
    count: 0,
    totalAmountMinor: 0n,
  };
  current.count += 1;
  current.totalAmountMinor += BigInt(amountMinor);
  map.set(key, current);
}

function freezeTypeAggregates(
  map: Map<InitialFinancialTransactionType, { count: number; totalAmountMinor: bigint }>,
): readonly Readonly<StagingTypeAggregate>[] {
  return Object.freeze(
    [...map.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([type, value]) => Object.freeze({ type, ...value })),
  );
}

function freezeDimensionAggregates(
  map: Map<string, { type: InitialFinancialTransactionType; dimensionId: string; count: number; totalAmountMinor: bigint }>,
): readonly Readonly<StagingDimensionAggregate>[] {
  return Object.freeze(
    [...map.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, value]) => Object.freeze({ ...value })),
  );
}

export function buildExpectedControlledRebuildReconciliation(
  plan: Readonly<InitialVerifiedCurrentPlan>,
): Readonly<InitialControlledRebuildReconciliationSnapshot> {
  const classificationCounts = emptyClassificationCounts();
  for (const record of plan.sourceRecords) {
    if (!CLASSIFICATIONS.includes(record.classification)) {
      throw new InitialControlledRebuildReconciliationError('INVALID_SOURCE_CLASSIFICATION');
    }
    classificationCounts[record.classification] += 1;
  }

  const typeMap = new Map<InitialFinancialTransactionType, { count: number; totalAmountMinor: bigint }>();
  const categoryMap = new Map<string, { type: InitialFinancialTransactionType; dimensionId: string; count: number; totalAmountMinor: bigint }>();
  const accountMap = new Map<string, { type: InitialFinancialTransactionType; dimensionId: string; count: number; totalAmountMinor: bigint }>();

  for (const candidate of plan.transactions) {
    const transaction = candidate.transaction;
    if (transaction.type !== 'EXPENSE' && transaction.type !== 'INCOME') {
      throw new InitialControlledRebuildReconciliationError('UNSUPPORTED_TRANSACTION_TYPE');
    }
    if (!Number.isSafeInteger(transaction.amountMinor) || transaction.amountMinor <= 0) {
      throw new InitialControlledRebuildReconciliationError('INVALID_TRANSACTION_AMOUNT');
    }
    const accountId = transactionAccountId(transaction);
    const categoryId = transaction.categoryId;
    if (categoryId === null) {
      throw new InitialControlledRebuildReconciliationError('INVALID_TRANSACTION_SHAPE');
    }
    addTypeAggregate(typeMap, transaction.type, transaction.amountMinor);
    addDimensionAggregate(categoryMap, transaction.type, categoryId, transaction.amountMinor);
    addDimensionAggregate(accountMap, transaction.type, accountId, transaction.amountMinor);
  }

  return Object.freeze({
    sourceRecordCount: plan.sourceRecords.length,
    transactionCount: plan.transactions.length,
    typeAggregates: freezeTypeAggregates(typeMap),
    categoryAggregates: freezeDimensionAggregates(categoryMap),
    accountAggregates: freezeDimensionAggregates(accountMap),
    classificationCounts: Object.freeze(classificationCounts),
    missingSourceRecordCount: plan.sourceRecords.filter((record) => record.state === 'MISSING').length,
  });
}

function safeCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function typeAggregateMap(
  values: readonly Readonly<StagingTypeAggregate>[],
): ReadonlyMap<string, string> | null {
  const map = new Map<string, string>();
  for (const value of values) {
    if (
      (value.type !== 'EXPENSE' && value.type !== 'INCOME')
      || !safeCount(value.count)
      || typeof value.totalAmountMinor !== 'bigint'
      || map.has(value.type)
    ) return null;
    map.set(value.type, `${value.count}|${value.totalAmountMinor}`);
  }
  return map;
}

function dimensionAggregateMap(
  values: readonly Readonly<StagingDimensionAggregate>[],
): ReadonlyMap<string, string> | null {
  const map = new Map<string, string>();
  for (const value of values) {
    if (
      (value.type !== 'EXPENSE' && value.type !== 'INCOME')
      || value.dimensionId.trim().length === 0
      || !safeCount(value.count)
      || typeof value.totalAmountMinor !== 'bigint'
    ) return null;
    const key = aggregateKey(value.type, value.dimensionId);
    if (map.has(key)) return null;
    map.set(key, `${value.count}|${value.totalAmountMinor}`);
  }
  return map;
}

function mapsEqual(left: ReadonlyMap<string, string> | null, right: ReadonlyMap<string, string> | null): boolean {
  if (left === null || right === null || left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false;
  }
  return true;
}

function classificationCountsValid(counts: Readonly<Record<SourceRowClassification, number>>): boolean {
  return CLASSIFICATIONS.every((classification) => safeCount(counts[classification]));
}

function classificationCountsEqual(
  left: Readonly<Record<SourceRowClassification, number>>,
  right: Readonly<Record<SourceRowClassification, number>>,
): boolean {
  return classificationCountsValid(left)
    && classificationCountsValid(right)
    && CLASSIFICATIONS.every((classification) => left[classification] === right[classification]);
}

export function compareControlledRebuildStagingReconciliation(
  expected: Readonly<InitialControlledRebuildReconciliationSnapshot>,
  observed: Readonly<InitialControlledRebuildReconciliationSnapshot>,
): Readonly<InitialReconciliationEvidence> {
  const checks: Record<InitialReconciliationCheck, 'MATCHED' | 'MISMATCH'> = {
    SOURCE_RECORD_COUNT: safeCount(observed.sourceRecordCount)
      && observed.sourceRecordCount === expected.sourceRecordCount ? 'MATCHED' : 'MISMATCH',
    TRANSACTION_COUNTS: safeCount(observed.transactionCount)
      && observed.transactionCount === expected.transactionCount
      && mapsEqual(
        new Map([...typeAggregateMap(expected.typeAggregates) ?? []].map(([key, value]) => [key, value.split('|')[0] ?? ''])),
        typeAggregateMap(observed.typeAggregates) === null
          ? null
          : new Map([...typeAggregateMap(observed.typeAggregates) ?? []].map(([key, value]) => [key, value.split('|')[0] ?? ''])),
      ) ? 'MATCHED' : 'MISMATCH',
    TOTALS_BY_TYPE: mapsEqual(typeAggregateMap(expected.typeAggregates), typeAggregateMap(observed.typeAggregates))
      ? 'MATCHED' : 'MISMATCH',
    CATEGORY_AGGREGATES: mapsEqual(
      dimensionAggregateMap(expected.categoryAggregates),
      dimensionAggregateMap(observed.categoryAggregates),
    ) ? 'MATCHED' : 'MISMATCH',
    ACCOUNT_AGGREGATES: mapsEqual(
      dimensionAggregateMap(expected.accountAggregates),
      dimensionAggregateMap(observed.accountAggregates),
    ) ? 'MATCHED' : 'MISMATCH',
    CLASSIFICATION_COUNTS: classificationCountsEqual(expected.classificationCounts, observed.classificationCounts)
      ? 'MATCHED' : 'MISMATCH',
    LEGACY_PERIOD_CLOSE_COUNT:
      safeCount(observed.classificationCounts.LEGACY_PERIOD_CLOSE)
      && observed.classificationCounts.LEGACY_PERIOD_CLOSE === expected.classificationCounts.LEGACY_PERIOD_CLOSE
        ? 'MATCHED' : 'MISMATCH',
    INVALID_AMBIGUOUS_MISSING_COUNTS:
      safeCount(observed.missingSourceRecordCount)
      && observed.classificationCounts.INVALID === expected.classificationCounts.INVALID
      && observed.classificationCounts.AMBIGUOUS === expected.classificationCounts.AMBIGUOUS
      && observed.missingSourceRecordCount === expected.missingSourceRecordCount
        ? 'MATCHED' : 'MISMATCH',
  };

  const mismatchCount = INITIAL_RECONCILIATION_CHECKS.filter((check) => checks[check] !== 'MATCHED').length;
  return Object.freeze({
    checks: Object.freeze(checks),
    unexplainedHighImpactMismatchCount: mismatchCount,
  });
}
