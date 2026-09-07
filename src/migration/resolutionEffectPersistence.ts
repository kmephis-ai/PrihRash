import {
  readStatement,
  type YdbStatement,
  writeStatement,
  YdbAdapter,
} from '../integration/ydb/adapter.js';
import {
  dateParameter,
  int64Parameter,
  timestampParameter,
  uint64Parameter,
  utf8Parameter,
  uuidParameter,
} from '../integration/ydb/parameters.js';
import {
  resolveReviewItem,
  type ReconciliationItem,
  type ResolutionAudit,
} from './resolution.js';
import type { ResolutionEffectPlan } from './resolutionEffectPlan.js';
import {
  prepareResolutionMetadataWrite,
  type ResolutionPersistenceExpectation,
} from './resolutionPersistence.js';

export interface PreparedResolutionEffectWrite {
  readonly pending: Readonly<ReconciliationItem>;
  readonly resolved: Readonly<ReconciliationItem>;
  readonly expectation: Readonly<ResolutionPersistenceExpectation>;
  readonly plan: Readonly<ResolutionEffectPlan>;
  readonly effectStatement: YdbStatement | null;
  readonly prerequisiteRead: YdbStatement | null;
  readonly transactionReadBack: YdbStatement | null;
  readonly metadataStatement: YdbStatement;
  readonly sourceReadBack: YdbStatement;
  readonly finalTransactionId: string | null;
}

interface IdentityRow {
  readonly id?: unknown;
}

interface SourceReadBackRow {
  readonly state?: unknown;
  readonly classification?: unknown;
  readonly transaction_id?: unknown;
  readonly current_revision?: unknown;
  readonly resolution_code?: unknown;
  readonly resolved_at?: unknown;
  readonly resolved_by?: unknown;
}

interface TransactionEffectReadBackRow {
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

export type ResolutionEffectPersistenceErrorCode =
  | 'PLAN_SOURCE_RECORD_ID_MISMATCH'
  | 'PLAN_EFFECT_SHAPE_MISMATCH'
  | 'PLAN_TRANSACTION_ID_MISMATCH'
  | 'SOURCE_REVISION_PRECONDITION_MISMATCH'
  | 'PREREQUISITE_TRANSACTION_NOT_FOUND'
  | 'PREREQUISITE_TRANSACTION_RESULT_AMBIGUOUS'
  | 'TRANSACTION_NOT_FOUND_AFTER_EFFECT'
  | 'TRANSACTION_RESULT_AMBIGUOUS'
  | 'TRANSACTION_EFFECT_EVIDENCE_MISMATCH'
  | 'SOURCE_RECORD_NOT_FOUND_AFTER_RESOLUTION'
  | 'SOURCE_RECORD_RESULT_AMBIGUOUS'
  | 'SOURCE_EFFECT_EVIDENCE_MISMATCH';

export class ResolutionEffectPersistenceError extends Error {
  readonly code: ResolutionEffectPersistenceErrorCode;

  constructor(code: ResolutionEffectPersistenceErrorCode) {
    super(code);
    this.name = 'ResolutionEffectPersistenceError';
    this.code = code;
  }
}

function normalizedUuid(value: string): string {
  return value.toLowerCase();
}

function uuidMatches(value: unknown, expected: string): boolean {
  return typeof value === 'string' && normalizedUuid(value) === normalizedUuid(expected);
}

function nullableUuidMatches(value: unknown, expected: string | null): boolean {
  if (expected === null) return value === null;
  return uuidMatches(value, expected);
}

function nullableValueMatches(value: unknown, expected: string | null): boolean {
  return expected === null ? value === null : value === expected;
}

function integerMatches(value: unknown, expected: number | bigint): boolean {
  const expectedBigInt = typeof expected === 'bigint' ? expected : BigInt(expected);
  if (typeof value === 'bigint') return value === expectedBigInt;
  return typeof value === 'number' && Number.isSafeInteger(value) && BigInt(value) === expectedBigInt;
}

function nextVersion(expectedVersion: number): bigint {
  return BigInt(expectedVersion) + 1n;
}

function sourceReadBackStatement(sourceRecordId: string): YdbStatement {
  return readStatement(
    'SELECT state, classification, transaction_id, current_revision, resolution_code, resolved_at, resolved_by '
      + 'FROM source_records WHERE id = $id',
    { id: uuidParameter(sourceRecordId) },
  );
}

function identityReadStatement(transactionId: string): YdbStatement {
  return readStatement(
    'SELECT id FROM transactions WHERE id = $id',
    { id: uuidParameter(transactionId) },
  );
}

function voidStatement(transactionId: string, expectedVersion: number, resolvedAt: string): YdbStatement {
  return writeStatement(
    'UPDATE transactions SET status = $status, updated_at = $updated_at, version = $next_version '
      + 'WHERE id = $id AND version = $expected_version AND status = $expected_status',
    {
      id: uuidParameter(transactionId),
      expected_version: uint64Parameter(expectedVersion),
      expected_status: utf8Parameter('POSTED'),
      status: utf8Parameter('VOIDED'),
      updated_at: timestampParameter(resolvedAt),
      next_version: uint64Parameter(nextVersion(expectedVersion)),
    },
  );
}

function voidReadBackStatement(transactionId: string): YdbStatement {
  return readStatement(
    'SELECT status, updated_at, version FROM transactions WHERE id = $id',
    { id: uuidParameter(transactionId) },
  );
}

function replacementStatement(
  transactionId: string,
  expectedVersion: number,
  resolvedAt: string,
  plan: Extract<ResolutionEffectPlan['transactionEffect'], { kind: 'REPLACE' }>,
): YdbStatement {
  const tx = plan.canonicalTransaction;
  return writeStatement(
    'UPDATE transactions SET type = $type, occurred_on = $occurred_on, record_granularity = $record_granularity, '
      + 'date_precision = $date_precision, aggregate_period_month = $aggregate_period_month, '
      + 'financial_period_id = $financial_period_id, period_assignment_quality = $period_assignment_quality, '
      + 'amount_minor = $amount_minor, currency = $currency, from_account_id = $from_account_id, '
      + 'to_account_id = $to_account_id, category_id = $category_id, paid_by_member_id = $paid_by_member_id, '
      + 'description = $description, note = $note, status = $status, analytics_state = $analytics_state, '
      + 'flow_kind = $flow_kind, updated_at = $updated_at, version = $next_version '
      + 'WHERE id = $id AND version = $expected_version',
    {
      id: uuidParameter(transactionId),
      expected_version: uint64Parameter(expectedVersion),
      type: utf8Parameter(tx.type),
      occurred_on: dateParameter(tx.occurredOn),
      record_granularity: utf8Parameter(tx.recordGranularity),
      date_precision: utf8Parameter(tx.datePrecision),
      aggregate_period_month: dateParameter(tx.aggregatePeriodMonth),
      financial_period_id: uuidParameter(tx.financialPeriodId),
      period_assignment_quality: utf8Parameter(tx.periodAssignmentQuality),
      amount_minor: int64Parameter(tx.amountMinor),
      currency: utf8Parameter(tx.currency),
      from_account_id: uuidParameter(tx.fromAccountId),
      to_account_id: uuidParameter(tx.toAccountId),
      category_id: uuidParameter(tx.categoryId),
      paid_by_member_id: uuidParameter(tx.paidByMemberId),
      description: utf8Parameter(tx.description),
      note: utf8Parameter(tx.note),
      status: utf8Parameter(tx.status),
      analytics_state: utf8Parameter(tx.analyticsState),
      flow_kind: utf8Parameter(tx.flowKind),
      updated_at: timestampParameter(resolvedAt),
      next_version: uint64Parameter(nextVersion(expectedVersion)),
    },
  );
}

function replacementReadBackStatement(transactionId: string): YdbStatement {
  return readStatement(
    'SELECT type, occurred_on, record_granularity, date_precision, aggregate_period_month, financial_period_id, '
      + 'period_assignment_quality, amount_minor, currency, from_account_id, to_account_id, category_id, '
      + 'paid_by_member_id, description, note, status, analytics_state, flow_kind, updated_at, version '
      + 'FROM transactions WHERE id = $id',
    { id: uuidParameter(transactionId) },
  );
}

function relinkStatement(
  sourceRecordId: string,
  expectedTransactionId: string | null,
  targetTransactionId: string,
  expectedSourceRevision: number,
): YdbStatement {
  const oldLinkPredicate = expectedTransactionId === null
    ? 'transaction_id IS NULL'
    : 'transaction_id = $expected_transaction_id';
  const parameters = {
    id: uuidParameter(sourceRecordId),
    current_revision: uint64Parameter(expectedSourceRevision),
    target_transaction_id: uuidParameter(targetTransactionId),
    ...(expectedTransactionId === null
      ? {}
      : { expected_transaction_id: uuidParameter(expectedTransactionId) }),
  };
  return writeStatement(
    'UPDATE source_records SET transaction_id = $target_transaction_id '
      + `WHERE id = $id AND current_revision = $current_revision AND ${oldLinkPredicate} `
      + 'AND resolution_code IS NULL AND resolved_at IS NULL AND resolved_by IS NULL',
    parameters,
  );
}

function validatePlanShape(
  pending: Readonly<ReconciliationItem>,
  plan: Readonly<ResolutionEffectPlan>,
  expectation: Readonly<ResolutionPersistenceExpectation>,
): void {
  if (normalizedUuid(pending.sourceRecordId) !== normalizedUuid(plan.sourceRecordId)) {
    throw new ResolutionEffectPersistenceError('PLAN_SOURCE_RECORD_ID_MISMATCH');
  }

  switch (plan.resolutionCode) {
    case 'KEEP_CANONICAL':
      if (plan.transactionEffect.kind !== 'NONE' || plan.sourceLinkEffect.kind !== 'KEEP') {
        throw new ResolutionEffectPersistenceError('PLAN_EFFECT_SHAPE_MISMATCH');
      }
      if (pending.transactionId === null) {
        throw new ResolutionEffectPersistenceError('PLAN_TRANSACTION_ID_MISMATCH');
      }
      break;

    case 'RESOLVED_NO_CHANGE':
      if (plan.transactionEffect.kind !== 'NONE' || plan.sourceLinkEffect.kind !== 'KEEP') {
        throw new ResolutionEffectPersistenceError('PLAN_EFFECT_SHAPE_MISMATCH');
      }
      break;

    case 'VOID_CANONICAL_CONFIRMED':
      if (plan.transactionEffect.kind !== 'VOID' || plan.sourceLinkEffect.kind !== 'KEEP') {
        throw new ResolutionEffectPersistenceError('PLAN_EFFECT_SHAPE_MISMATCH');
      }
      if (
        pending.transactionId === null
        || normalizedUuid(pending.transactionId) !== normalizedUuid(plan.transactionEffect.transactionId)
      ) {
        throw new ResolutionEffectPersistenceError('PLAN_TRANSACTION_ID_MISMATCH');
      }
      break;

    case 'RELINK_SOURCE':
      if (plan.transactionEffect.kind !== 'NONE' || plan.sourceLinkEffect.kind !== 'RELINK') {
        throw new ResolutionEffectPersistenceError('PLAN_EFFECT_SHAPE_MISMATCH');
      }
      if (plan.sourceLinkEffect.expectedSourceRevision !== expectation.currentRevision) {
        throw new ResolutionEffectPersistenceError('SOURCE_REVISION_PRECONDITION_MISMATCH');
      }
      break;

    case 'ACCEPT_SOURCE_CORRECTION':
      if (plan.transactionEffect.kind !== 'REPLACE' || plan.sourceLinkEffect.kind !== 'KEEP') {
        throw new ResolutionEffectPersistenceError('PLAN_EFFECT_SHAPE_MISMATCH');
      }
      if (
        pending.transactionId === null
        || normalizedUuid(pending.transactionId) !== normalizedUuid(plan.transactionEffect.transactionId)
      ) {
        throw new ResolutionEffectPersistenceError('PLAN_TRANSACTION_ID_MISMATCH');
      }
      break;
  }
}

function sourceRowMatches(
  row: SourceReadBackRow,
  prepared: Readonly<PreparedResolutionEffectWrite>,
): boolean {
  return (
    nullableValueMatches(row.state, prepared.expectation.sourceState)
    && nullableValueMatches(row.classification, prepared.expectation.classification)
    && nullableUuidMatches(row.transaction_id, prepared.finalTransactionId)
    && integerMatches(row.current_revision, prepared.expectation.currentRevision)
    && row.resolution_code === prepared.resolved.resolutionCode
    && row.resolved_at === prepared.resolved.resolvedAt
    && row.resolved_by === prepared.resolved.resolvedBy
  );
}

function replacementRowMatches(
  row: TransactionEffectReadBackRow,
  effect: Extract<ResolutionEffectPlan['transactionEffect'], { kind: 'REPLACE' }>,
  resolvedAt: string,
): boolean {
  const tx = effect.canonicalTransaction;
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
    && row.updated_at === resolvedAt
    && integerMatches(row.version, nextVersion(effect.expectedVersion))
  );
}

function voidRowMatches(
  row: TransactionEffectReadBackRow,
  expectedVersion: number,
  resolvedAt: string,
): boolean {
  return (
    row.status === 'VOIDED'
    && row.updated_at === resolvedAt
    && integerMatches(row.version, nextVersion(expectedVersion))
  );
}

export function prepareResolutionEffectWrite(
  pending: Readonly<ReconciliationItem>,
  plan: Readonly<ResolutionEffectPlan>,
  audit: Readonly<ResolutionAudit>,
  expectation: Readonly<ResolutionPersistenceExpectation>,
): Readonly<PreparedResolutionEffectWrite> {
  validatePlanShape(pending, plan, expectation);
  const auditResolved = resolveReviewItem(pending, plan.resolutionCode, audit);
  const metadata = prepareResolutionMetadataWrite(auditResolved, expectation);

  let effectStatement: YdbStatement | null = null;
  let prerequisiteRead: YdbStatement | null = null;
  let transactionReadBack: YdbStatement | null = null;
  let finalTransactionId = expectation.transactionId;

  switch (plan.resolutionCode) {
    case 'KEEP_CANONICAL':
      if (pending.transactionId === null) {
        throw new ResolutionEffectPersistenceError('PLAN_TRANSACTION_ID_MISMATCH');
      }
      prerequisiteRead = identityReadStatement(pending.transactionId);
      break;

    case 'RESOLVED_NO_CHANGE':
      break;

    case 'VOID_CANONICAL_CONFIRMED':
      if (plan.transactionEffect.kind !== 'VOID') {
        throw new ResolutionEffectPersistenceError('PLAN_EFFECT_SHAPE_MISMATCH');
      }
      effectStatement = voidStatement(
        plan.transactionEffect.transactionId,
        plan.transactionEffect.expectedVersion,
        auditResolved.resolvedAt ?? '',
      );
      transactionReadBack = voidReadBackStatement(plan.transactionEffect.transactionId);
      break;

    case 'RELINK_SOURCE':
      if (plan.sourceLinkEffect.kind !== 'RELINK') {
        throw new ResolutionEffectPersistenceError('PLAN_EFFECT_SHAPE_MISMATCH');
      }
      prerequisiteRead = identityReadStatement(plan.sourceLinkEffect.targetTransactionId);
      effectStatement = relinkStatement(
        expectation.sourceRecordId,
        expectation.transactionId,
        plan.sourceLinkEffect.targetTransactionId,
        plan.sourceLinkEffect.expectedSourceRevision,
      );
      finalTransactionId = plan.sourceLinkEffect.targetTransactionId;
      break;

    case 'ACCEPT_SOURCE_CORRECTION':
      if (plan.transactionEffect.kind !== 'REPLACE') {
        throw new ResolutionEffectPersistenceError('PLAN_EFFECT_SHAPE_MISMATCH');
      }
      effectStatement = replacementStatement(
        plan.transactionEffect.transactionId,
        plan.transactionEffect.expectedVersion,
        auditResolved.resolvedAt ?? '',
        plan.transactionEffect,
      );
      transactionReadBack = replacementReadBackStatement(plan.transactionEffect.transactionId);
      break;
  }

  const finalResolved = Object.freeze({
    ...auditResolved,
    transactionId: finalTransactionId,
  });

  return Object.freeze({
    pending: Object.freeze({ ...pending }),
    resolved: finalResolved,
    expectation: Object.freeze({ ...expectation }),
    plan,
    effectStatement,
    prerequisiteRead,
    transactionReadBack,
    metadataStatement: metadata.statement,
    sourceReadBack: sourceReadBackStatement(expectation.sourceRecordId),
    finalTransactionId,
  });
}

async function requirePrerequisiteTransaction(
  rows: readonly IdentityRow[],
  expectedTransactionId: string,
): Promise<void> {
  if (rows.length === 0) {
    throw new ResolutionEffectPersistenceError('PREREQUISITE_TRANSACTION_NOT_FOUND');
  }
  if (rows.length !== 1) {
    throw new ResolutionEffectPersistenceError('PREREQUISITE_TRANSACTION_RESULT_AMBIGUOUS');
  }
  const row = rows[0];
  if (row === undefined || !uuidMatches(row.id, expectedTransactionId)) {
    throw new ResolutionEffectPersistenceError('PREREQUISITE_TRANSACTION_RESULT_AMBIGUOUS');
  }
}

function prerequisiteTransactionId(prepared: Readonly<PreparedResolutionEffectWrite>): string | null {
  if (prepared.plan.resolutionCode === 'KEEP_CANONICAL') return prepared.pending.transactionId;
  if (prepared.plan.resolutionCode === 'RELINK_SOURCE' && prepared.plan.sourceLinkEffect.kind === 'RELINK') {
    return prepared.plan.sourceLinkEffect.targetTransactionId;
  }
  return null;
}

function requireTransactionEffectReadBack(
  rows: readonly TransactionEffectReadBackRow[],
  prepared: Readonly<PreparedResolutionEffectWrite>,
): void {
  if (rows.length === 0) {
    throw new ResolutionEffectPersistenceError('TRANSACTION_NOT_FOUND_AFTER_EFFECT');
  }
  if (rows.length !== 1) {
    throw new ResolutionEffectPersistenceError('TRANSACTION_RESULT_AMBIGUOUS');
  }
  const row = rows[0];
  if (row === undefined) {
    throw new ResolutionEffectPersistenceError('TRANSACTION_EFFECT_EVIDENCE_MISMATCH');
  }

  let matches = false;
  if (prepared.plan.resolutionCode === 'VOID_CANONICAL_CONFIRMED' && prepared.plan.transactionEffect.kind === 'VOID') {
    matches = voidRowMatches(
      row,
      prepared.plan.transactionEffect.expectedVersion,
      prepared.resolved.resolvedAt ?? '',
    );
  } else if (
    prepared.plan.resolutionCode === 'ACCEPT_SOURCE_CORRECTION'
    && prepared.plan.transactionEffect.kind === 'REPLACE'
  ) {
    matches = replacementRowMatches(
      row,
      prepared.plan.transactionEffect,
      prepared.resolved.resolvedAt ?? '',
    );
  }

  if (!matches) {
    throw new ResolutionEffectPersistenceError('TRANSACTION_EFFECT_EVIDENCE_MISMATCH');
  }
}

function requireSourceReadBack(
  rows: readonly SourceReadBackRow[],
  prepared: Readonly<PreparedResolutionEffectWrite>,
): void {
  if (rows.length === 0) {
    throw new ResolutionEffectPersistenceError('SOURCE_RECORD_NOT_FOUND_AFTER_RESOLUTION');
  }
  if (rows.length !== 1) {
    throw new ResolutionEffectPersistenceError('SOURCE_RECORD_RESULT_AMBIGUOUS');
  }
  const row = rows[0];
  if (row === undefined || !sourceRowMatches(row, prepared)) {
    throw new ResolutionEffectPersistenceError('SOURCE_EFFECT_EVIDENCE_MISMATCH');
  }
}

export async function executeResolutionEffectWrite(
  adapter: YdbAdapter,
  prepared: Readonly<PreparedResolutionEffectWrite>,
): Promise<Readonly<ReconciliationItem>> {
  await adapter.serializableReadWrite(async (transaction) => {
    if (prepared.prerequisiteRead !== null) {
      const prerequisite = await transaction.execute<IdentityRow>(prepared.prerequisiteRead);
      const expectedId = prerequisiteTransactionId(prepared);
      if (expectedId === null) {
        throw new ResolutionEffectPersistenceError('PLAN_EFFECT_SHAPE_MISMATCH');
      }
      await requirePrerequisiteTransaction(prerequisite.rows, expectedId);
    }

    if (prepared.effectStatement !== null) {
      await transaction.execute(prepared.effectStatement);
    }

    if (prepared.transactionReadBack !== null) {
      const transactionResult = await transaction.execute<TransactionEffectReadBackRow>(
        prepared.transactionReadBack,
      );
      requireTransactionEffectReadBack(transactionResult.rows, prepared);
    }

    await transaction.execute(prepared.metadataStatement);
    const sourceResult = await transaction.execute<SourceReadBackRow>(prepared.sourceReadBack);
    requireSourceReadBack(sourceResult.rows, prepared);
  });

  return Object.freeze({ ...prepared.resolved });
}