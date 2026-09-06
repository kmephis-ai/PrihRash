import {
  type YdbParameter,
  dateParameter,
  int64Parameter,
  timestampParameter,
  uint64Parameter,
  utf8Parameter,
  uuidParameter,
} from '../integration/ydb/parameters.js';
import { type YdbStatement, writeStatement } from '../integration/ydb/adapter.js';
import type { MigrationRun } from './migrationRunState.js';
import type {
  InitialVerifiedCurrentPlan,
  InitialVerifiedSourceRecordCandidate,
  InitialVerifiedTransactionCandidate,
} from './initialVerifiedCurrentPlan.js';

export type InitialVerifiedCurrentWriteRole = 'SOURCE_RECORD' | 'TRANSACTION';

export interface PreparedInitialVerifiedCurrentWrite {
  readonly role: InitialVerifiedCurrentWriteRole;
  readonly sourceRecordId: string;
  readonly statement: YdbStatement;
  readonly estimatedParameterBytes: number;
}

export type InitialVerifiedCurrentPersistenceErrorCode =
  | 'RUN_NOT_VALIDATED'
  | 'PLAN_SOURCE_COUNT_MISMATCH'
  | 'DUPLICATE_SOURCE_RECORD_ID'
  | 'DUPLICATE_TRANSACTION_ID'
  | 'TRANSACTION_SOURCE_NOT_FOUND'
  | 'TRANSACTION_LINK_MISMATCH'
  | 'NON_FINANCIAL_TRANSACTION_LINK'
  | 'FINANCIAL_TRANSACTION_LINK_MISSING';

export class InitialVerifiedCurrentPersistenceError extends Error {
  readonly code: InitialVerifiedCurrentPersistenceErrorCode;

  constructor(code: InitialVerifiedCurrentPersistenceErrorCode) {
    super(code);
    this.name = 'InitialVerifiedCurrentPersistenceError';
    this.code = code;
  }
}

const TEXT_ENCODER = new TextEncoder();
const PARAMETER_VALUE_OVERHEAD_BYTES = 16;

function parameterValueBytes(parameter: YdbParameter): number {
  if (parameter.value === null) return 0;
  return TEXT_ENCODER.encode(String(parameter.value)).byteLength;
}

function estimateParameterBytes(parameters: Readonly<Record<string, YdbParameter>>): number {
  return Object.values(parameters).reduce(
    (total, parameter) => total + PARAMETER_VALUE_OVERHEAD_BYTES + parameterValueBytes(parameter),
    0,
  );
}

function prepared(
  role: InitialVerifiedCurrentWriteRole,
  sourceRecordId: string,
  statement: YdbStatement,
): Readonly<PreparedInitialVerifiedCurrentWrite> {
  return Object.freeze({
    role,
    sourceRecordId,
    statement,
    estimatedParameterBytes: estimateParameterBytes(statement.parameters),
  });
}

function sourceRecordStatement(record: Readonly<InitialVerifiedSourceRecordCandidate>): YdbStatement {
  const parameters = {
    id: uuidParameter(record.id),
    source_type: utf8Parameter(record.sourceType),
    source_sheet: utf8Parameter(record.sourceSheet),
    first_seen_at: timestampParameter(record.firstSeenAt),
    last_seen_at: timestampParameter(record.lastSeenAt),
    last_row_hint: uint64Parameter(record.lastRowHint),
    current_digest: { type: 'String' as const, value: record.currentDigest },
    state: utf8Parameter(record.state),
    classification: utf8Parameter(record.classification),
    normalization_status: utf8Parameter(record.normalizationStatus),
    transaction_id: uuidParameter(record.transactionId),
    current_revision: uint64Parameter(record.currentRevision),
    resolution_code: utf8Parameter(record.resolutionCode),
    resolved_at: timestampParameter(record.resolvedAt),
    resolved_by: utf8Parameter(record.resolvedBy),
  };

  return writeStatement(
    'UPSERT INTO source_records '
      + '(id, source_type, source_sheet, first_seen_at, last_seen_at, last_row_hint, current_digest, state, '
      + 'classification, normalization_status, transaction_id, current_revision, resolution_code, resolved_at, resolved_by) '
      + 'VALUES ($id, $source_type, $source_sheet, $first_seen_at, $last_seen_at, $last_row_hint, $current_digest, '
      + '$state, $classification, $normalization_status, $transaction_id, $current_revision, $resolution_code, '
      + '$resolved_at, $resolved_by)',
    parameters,
  );
}

function transactionStatement(
  candidate: Readonly<InitialVerifiedTransactionCandidate>,
  promotedAt: string,
): YdbStatement {
  const tx = candidate.transaction;
  const parameters = {
    id: uuidParameter(candidate.transactionId),
    type: utf8Parameter(tx.type),
    occurred_on: dateParameter(tx.occurredOn),
    captured_at: timestampParameter(null),
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
    created_at: timestampParameter(promotedAt),
    updated_at: timestampParameter(promotedAt),
    version: uint64Parameter(1),
  };

  return writeStatement(
    'UPSERT INTO transactions '
      + '(id, type, occurred_on, captured_at, record_granularity, date_precision, aggregate_period_month, '
      + 'financial_period_id, period_assignment_quality, amount_minor, currency, from_account_id, to_account_id, '
      + 'category_id, paid_by_member_id, description, note, status, analytics_state, flow_kind, created_at, updated_at, version) '
      + 'VALUES ($id, $type, $occurred_on, $captured_at, $record_granularity, $date_precision, $aggregate_period_month, '
      + '$financial_period_id, $period_assignment_quality, $amount_minor, $currency, $from_account_id, $to_account_id, '
      + '$category_id, $paid_by_member_id, $description, $note, $status, $analytics_state, $flow_kind, $created_at, '
      + '$updated_at, $version)',
    parameters,
  );
}

function validatePlan(run: Readonly<MigrationRun>, plan: Readonly<InitialVerifiedCurrentPlan>): void {
  if (run.state !== 'VALIDATED' || run.finishedAt !== null || run.errorCode !== null) {
    throw new InitialVerifiedCurrentPersistenceError('RUN_NOT_VALIDATED');
  }
  if (run.rowsSeen !== plan.sourceRecords.length) {
    throw new InitialVerifiedCurrentPersistenceError('PLAN_SOURCE_COUNT_MISMATCH');
  }

  const recordsById = new Map<string, Readonly<InitialVerifiedSourceRecordCandidate>>();
  for (const record of plan.sourceRecords) {
    const sourceId = record.id.toLowerCase();
    if (recordsById.has(sourceId)) {
      throw new InitialVerifiedCurrentPersistenceError('DUPLICATE_SOURCE_RECORD_ID');
    }
    recordsById.set(sourceId, record);

    if (record.classification === 'FINANCIAL_RECORD' && record.transactionId === null) {
      throw new InitialVerifiedCurrentPersistenceError('FINANCIAL_TRANSACTION_LINK_MISSING');
    }
    if (record.classification !== 'FINANCIAL_RECORD' && record.transactionId !== null) {
      throw new InitialVerifiedCurrentPersistenceError('NON_FINANCIAL_TRANSACTION_LINK');
    }
  }

  const transactionIds = new Set<string>();
  for (const candidate of plan.transactions) {
    const sourceId = candidate.sourceRecordId.toLowerCase();
    const record = recordsById.get(sourceId);
    if (record === undefined) {
      throw new InitialVerifiedCurrentPersistenceError('TRANSACTION_SOURCE_NOT_FOUND');
    }
    if (record.transactionId !== candidate.transactionId) {
      throw new InitialVerifiedCurrentPersistenceError('TRANSACTION_LINK_MISMATCH');
    }
    const transactionId = candidate.transactionId.toLowerCase();
    if (transactionIds.has(transactionId)) {
      throw new InitialVerifiedCurrentPersistenceError('DUPLICATE_TRANSACTION_ID');
    }
    transactionIds.add(transactionId);
  }

  const linkedFinancialCount = plan.sourceRecords.filter(
    (record) => record.classification === 'FINANCIAL_RECORD',
  ).length;
  if (linkedFinancialCount !== plan.transactions.length) {
    throw new InitialVerifiedCurrentPersistenceError('FINANCIAL_TRANSACTION_LINK_MISSING');
  }
}

export function prepareInitialVerifiedCurrentWrites(
  run: Readonly<MigrationRun>,
  plan: Readonly<InitialVerifiedCurrentPlan>,
  promotedAt: string,
): readonly Readonly<PreparedInitialVerifiedCurrentWrite>[] {
  validatePlan(run, plan);
  timestampParameter(promotedAt);

  const transactionBySource = new Map(
    plan.transactions.map((candidate) => [candidate.sourceRecordId.toLowerCase(), candidate] as const),
  );
  const writes: Readonly<PreparedInitialVerifiedCurrentWrite>[] = [];

  for (const record of plan.sourceRecords) {
    const sourceId = record.id.toLowerCase();
    const transaction = transactionBySource.get(sourceId);
    if (transaction !== undefined) {
      writes.push(prepared('TRANSACTION', sourceId, transactionStatement(transaction, promotedAt)));
    }
    writes.push(prepared('SOURCE_RECORD', sourceId, sourceRecordStatement(record)));
  }

  return Object.freeze(writes);
}
