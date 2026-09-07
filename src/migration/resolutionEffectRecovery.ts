import { readStatement, YdbAdapter } from '../integration/ydb/adapter.js';
import { uuidParameter } from '../integration/ydb/parameters.js';
import type { PreparedResolutionEffectWrite } from './resolutionEffectPersistence.js';

interface SourceRecoveryRow {
  readonly state?: unknown;
  readonly classification?: unknown;
  readonly transaction_id?: unknown;
  readonly current_revision?: unknown;
  readonly resolution_code?: unknown;
  readonly resolved_at?: unknown;
  readonly resolved_by?: unknown;
}

interface IdentityRow {
  readonly id?: unknown;
}

interface TransactionRecoveryRow {
  readonly type?: unknown;
  readonly occurred_on?: unknown;
  readonly record_granularity?: unknown;
  readonly date_precision?: unknown;
  readonly aggregate_period_month?: unknown;
  readonly financial_period_id?: unknown;
  readonly period_assignment_quality?: unknown;
  readonly amount_minor?: unknown;
  readonly currency?: unknown;
  readonly from_account_id?: unknown;
  readonly to_account_id?: unknown;
  readonly category_id?: unknown;
  readonly paid_by_member_id?: unknown;
  readonly description?: unknown;
  readonly note?: unknown;
  readonly status?: unknown;
  readonly analytics_state?: unknown;
  readonly flow_kind?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
}

export type ResolutionEffectCommitRecoveryStatus =
  | 'APPLIED'
  | 'NOT_APPLIED'
  | 'RECOVERY_REQUIRED';

export interface ResolutionEffectCommitRecoveryResult {
  readonly status: ResolutionEffectCommitRecoveryStatus;
}

function normalizedUuid(value: string): string {
  return value.toLowerCase();
}

function uuidMatches(value: unknown, expected: string): boolean {
  return typeof value === 'string' && normalizedUuid(value) === normalizedUuid(expected);
}

function nullableUuidMatches(value: unknown, expected: string | null): boolean {
  return expected === null ? value === null : uuidMatches(value, expected);
}

function nullableValueMatches(value: unknown, expected: string | null): boolean {
  return expected === null ? value === null : value === expected;
}

function integerMatches(value: unknown, expected: number | bigint): boolean {
  const expectedBigInt = typeof expected === 'bigint' ? expected : BigInt(expected);
  if (typeof value === 'bigint') return value === expectedBigInt;
  return typeof value === 'number' && Number.isSafeInteger(value) && BigInt(value) === expectedBigInt;
}

function sourceLineageMatches(
  row: SourceRecoveryRow,
  prepared: Readonly<PreparedResolutionEffectWrite>,
  transactionId: string | null,
): boolean {
  return (
    nullableValueMatches(row.state, prepared.expectation.sourceState)
    && nullableValueMatches(row.classification, prepared.expectation.classification)
    && nullableUuidMatches(row.transaction_id, transactionId)
    && integerMatches(row.current_revision, prepared.expectation.currentRevision)
  );
}

function sourcePreStateMatches(
  row: SourceRecoveryRow,
  prepared: Readonly<PreparedResolutionEffectWrite>,
): boolean {
  return (
    sourceLineageMatches(row, prepared, prepared.expectation.transactionId)
    && row.resolution_code === null
    && row.resolved_at === null
    && row.resolved_by === null
  );
}

function sourceFinalStateMatches(
  row: SourceRecoveryRow,
  prepared: Readonly<PreparedResolutionEffectWrite>,
): boolean {
  return (
    sourceLineageMatches(row, prepared, prepared.finalTransactionId)
    && row.resolution_code === prepared.resolved.resolutionCode
    && row.resolved_at === prepared.resolved.resolvedAt
    && row.resolved_by === prepared.resolved.resolvedBy
  );
}

function identityRead(transactionId: string) {
  return readStatement(
    'SELECT id FROM transactions WHERE id = $id',
    { id: uuidParameter(transactionId) },
  );
}

function voidRead(transactionId: string) {
  return readStatement(
    'SELECT status, updated_at, version FROM transactions WHERE id = $id',
    { id: uuidParameter(transactionId) },
  );
}

function replacementRead(transactionId: string) {
  return readStatement(
    'SELECT type, occurred_on, record_granularity, date_precision, aggregate_period_month, financial_period_id, '
      + 'period_assignment_quality, amount_minor, currency, from_account_id, to_account_id, category_id, '
      + 'paid_by_member_id, description, note, status, analytics_state, flow_kind, updated_at, version '
      + 'FROM transactions WHERE id = $id',
    { id: uuidParameter(transactionId) },
  );
}

function oneIdentityMatches(rows: readonly IdentityRow[], transactionId: string): boolean {
  const row = rows.length === 1 ? rows[0] : undefined;
  return row !== undefined && uuidMatches(row.id, transactionId);
}

function voidEffectMatches(
  rows: readonly TransactionRecoveryRow[],
  prepared: Readonly<PreparedResolutionEffectWrite>,
): boolean {
  if (
    prepared.plan.resolutionCode !== 'VOID_CANONICAL_CONFIRMED'
    || prepared.plan.transactionEffect.kind !== 'VOID'
  ) {
    return false;
  }
  const row = rows.length === 1 ? rows[0] : undefined;
  if (row === undefined) return false;
  return (
    row.status === 'VOIDED'
    && row.updated_at === prepared.resolved.resolvedAt
    && integerMatches(row.version, BigInt(prepared.plan.transactionEffect.expectedVersion) + 1n)
  );
}

function replacementEffectMatches(
  rows: readonly TransactionRecoveryRow[],
  prepared: Readonly<PreparedResolutionEffectWrite>,
): boolean {
  if (
    prepared.plan.resolutionCode !== 'ACCEPT_SOURCE_CORRECTION'
    || prepared.plan.transactionEffect.kind !== 'REPLACE'
  ) {
    return false;
  }
  const row = rows.length === 1 ? rows[0] : undefined;
  if (row === undefined) return false;
  const tx = prepared.plan.transactionEffect.canonicalTransaction;
  return (
    row.type === tx.type
    && row.occurred_on === tx.occurredOn
    && row.record_granularity === tx.recordGranularity
    && row.date_precision === tx.datePrecision
    && nullableValueMatches(row.aggregate_period_month, tx.aggregatePeriodMonth)
    && nullableUuidMatches(row.financial_period_id, tx.financialPeriodId)
    && row.period_assignment_quality === tx.periodAssignmentQuality
    && integerMatches(row.amount_minor, tx.amountMinor)
    && row.currency === tx.currency
    && nullableUuidMatches(row.from_account_id, tx.fromAccountId)
    && nullableUuidMatches(row.to_account_id, tx.toAccountId)
    && nullableUuidMatches(row.category_id, tx.categoryId)
    && nullableUuidMatches(row.paid_by_member_id, tx.paidByMemberId)
    && nullableValueMatches(row.description, tx.description)
    && nullableValueMatches(row.note, tx.note)
    && row.status === tx.status
    && row.analytics_state === tx.analyticsState
    && nullableValueMatches(row.flow_kind, tx.flowKind)
    && row.updated_at === prepared.resolved.resolvedAt
    && integerMatches(row.version, BigInt(prepared.plan.transactionEffect.expectedVersion) + 1n)
  );
}

function result(status: ResolutionEffectCommitRecoveryStatus): Readonly<ResolutionEffectCommitRecoveryResult> {
  return Object.freeze({ status });
}

export async function recoverResolutionEffectCommit(
  adapter: YdbAdapter,
  prepared: Readonly<PreparedResolutionEffectWrite>,
): Promise<Readonly<ResolutionEffectCommitRecoveryResult>> {
  const source = await adapter.read<SourceRecoveryRow>(prepared.sourceReadBack);
  if (source.rows.length !== 1) return result('RECOVERY_REQUIRED');
  const sourceRow = source.rows[0];
  if (sourceRow === undefined) return result('RECOVERY_REQUIRED');

  if (sourcePreStateMatches(sourceRow, prepared)) {
    return result('NOT_APPLIED');
  }
  if (!sourceFinalStateMatches(sourceRow, prepared)) {
    return result('RECOVERY_REQUIRED');
  }

  switch (prepared.plan.resolutionCode) {
    case 'RESOLVED_NO_CHANGE':
      return result('APPLIED');

    case 'KEEP_CANONICAL': {
      const transactionId = prepared.pending.transactionId;
      if (transactionId === null) return result('RECOVERY_REQUIRED');
      const identity = await adapter.read<IdentityRow>(identityRead(transactionId));
      return result(oneIdentityMatches(identity.rows, transactionId) ? 'APPLIED' : 'RECOVERY_REQUIRED');
    }

    case 'RELINK_SOURCE': {
      if (prepared.plan.sourceLinkEffect.kind !== 'RELINK') return result('RECOVERY_REQUIRED');
      const targetId = prepared.plan.sourceLinkEffect.targetTransactionId;
      const identity = await adapter.read<IdentityRow>(identityRead(targetId));
      return result(oneIdentityMatches(identity.rows, targetId) ? 'APPLIED' : 'RECOVERY_REQUIRED');
    }

    case 'VOID_CANONICAL_CONFIRMED': {
      if (prepared.plan.transactionEffect.kind !== 'VOID') return result('RECOVERY_REQUIRED');
      const transaction = await adapter.read<TransactionRecoveryRow>(
        voidRead(prepared.plan.transactionEffect.transactionId),
      );
      return result(voidEffectMatches(transaction.rows, prepared) ? 'APPLIED' : 'RECOVERY_REQUIRED');
    }

    case 'ACCEPT_SOURCE_CORRECTION': {
      if (prepared.plan.transactionEffect.kind !== 'REPLACE') return result('RECOVERY_REQUIRED');
      const transaction = await adapter.read<TransactionRecoveryRow>(
        replacementRead(prepared.plan.transactionEffect.transactionId),
      );
      return result(replacementEffectMatches(transaction.rows, prepared) ? 'APPLIED' : 'RECOVERY_REQUIRED');
    }
  }
}
