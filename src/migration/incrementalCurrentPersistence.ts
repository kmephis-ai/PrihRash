import type { CanonicalTransaction } from '../domain/transaction.js';
import { type YdbParameter, dateParameter, int64Parameter, jsonDocumentParameter, stringParameter, timestampParameter, uint64Parameter, utf8Parameter, uuidParameter } from '../integration/ydb/parameters.js';
import { type YdbStatement, writeStatement } from '../integration/ydb/adapter.js';
import { assessAtomicPromotionWrites, type AtomicPromotionPreflightAssessment, type PromotionWrite } from './atomicPromotion.js';
import type { IncrementalCurrentDeltaPlan, IncrementalSourceCurrentDeltaIntent, IncrementalTransactionCurrentDeltaIntent } from './incrementalCurrentDelta.js';
import type { IncrementalRevisionEvidencePlan, IncrementalSourceRecordRevisionProjection } from './incrementalRevisionEvidence.js';
import type { MigrationRun } from './migrationRunState.js';

export type IncrementalPromotionWriteRole = 'TRANSACTION' | 'SOURCE_REVISION' | 'SOURCE_RECORD';

export interface PreparedIncrementalPromotionWrite extends PromotionWrite {
  readonly role: IncrementalPromotionWriteRole;
  readonly entityId: string;
}

export interface IncrementalPromotionWritePlan {
  readonly writes: readonly Readonly<PreparedIncrementalPromotionWrite>[];
  readonly preflight: Readonly<AtomicPromotionPreflightAssessment>;
}

export type IncrementalCurrentPersistenceErrorCode =
  | 'RUN_NOT_VALIDATED'
  | 'PROMOTION_BLOCKED'
  | 'INVALID_PROMOTED_AT'
  | 'INVALID_SOURCE_REVISION_STEP'
  | 'MISSING_REVISION_EVIDENCE'
  | 'EXTRA_REVISION_EVIDENCE'
  | 'DUPLICATE_REVISION_EVIDENCE'
  | 'REVISION_RUN_MISMATCH'
  | 'REVISION_CURRENT_STATE_MISMATCH'
  | 'CREATE_REVISION_CHANGE_CLASS_INVALID'
  | 'REVISED_CHANGE_CLASS_MISSING';

export class IncrementalCurrentPersistenceError extends Error {
  readonly code: IncrementalCurrentPersistenceErrorCode;

  constructor(code: IncrementalCurrentPersistenceErrorCode) {
    super(code);
    this.name = 'IncrementalCurrentPersistenceError';
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
  role: IncrementalPromotionWriteRole,
  entityId: string,
  statement: YdbStatement,
): Readonly<PreparedIncrementalPromotionWrite> {
  return Object.freeze({
    role,
    entityId: entityId.toLowerCase(),
    statement,
    estimatedParameterBytes: estimateParameterBytes(statement.parameters),
    expectedReturnedRowCount: 1,
  });
}

function nullablePredicate(
  column: string,
  parameterName: string,
  value: string | null,
  parameters: Record<string, YdbParameter>,
  parameter: (value: string | null) => YdbParameter,
): string {
  if (value === null) return `${column} IS NULL`;
  parameters[parameterName] = parameter(value);
  return `${column} = $${parameterName}`;
}

function sourceCreateStatement(intent: Extract<IncrementalSourceCurrentDeltaIntent, { kind: 'CREATE_SOURCE_RECORD' }>): YdbStatement {
  const record = intent.candidate;
  const parameters = {
    id: uuidParameter(record.id),
    source_type: utf8Parameter(record.sourceType),
    source_sheet: utf8Parameter(record.sourceSheet),
    first_seen_at: timestampParameter(record.firstSeenAt),
    last_seen_at: timestampParameter(record.lastSeenAt),
    last_row_hint: uint64Parameter(record.lastRowHint),
    current_digest: stringParameter(record.currentDigest),
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
    'INSERT INTO source_records '
      + '(id, source_type, source_sheet, first_seen_at, last_seen_at, last_row_hint, current_digest, state, '
      + 'classification, normalization_status, transaction_id, current_revision, resolution_code, resolved_at, resolved_by) '
      + 'VALUES ($id, $source_type, $source_sheet, $first_seen_at, $last_seen_at, $last_row_hint, $current_digest, '
      + '$state, $classification, $normalization_status, $transaction_id, $current_revision, $resolution_code, '
      + '$resolved_at, $resolved_by) RETURNING id',
    parameters,
  );
}

function sourceUpdateStatement(intent: Extract<IncrementalSourceCurrentDeltaIntent, { kind: 'UPDATE_SOURCE_RECORD' }>): YdbStatement {
  const record = intent.candidate;
  const parameters: Record<string, YdbParameter> = {
    id: uuidParameter(record.id),
    last_seen_at: timestampParameter(record.lastSeenAt),
    last_row_hint: uint64Parameter(record.lastRowHint),
    current_digest: stringParameter(record.currentDigest),
    state: utf8Parameter(record.state),
    classification: utf8Parameter(record.classification),
    normalization_status: utf8Parameter(record.normalizationStatus),
    transaction_id: uuidParameter(record.transactionId),
    current_revision: uint64Parameter(record.currentRevision),
    resolution_code: utf8Parameter(record.resolutionCode),
    resolved_at: timestampParameter(record.resolvedAt),
    resolved_by: utf8Parameter(record.resolvedBy),
    expected_current_revision: uint64Parameter(intent.expectedCurrentRevision),
    expected_current_digest: stringParameter(intent.expectedCurrentDigest),
  };
  const statePredicate = nullablePredicate('state', 'expected_state', intent.expectedState, parameters, utf8Parameter);
  const transactionPredicate = nullablePredicate('transaction_id', 'expected_transaction_id', intent.expectedTransactionId, parameters, uuidParameter);
  const resolutionPredicate = nullablePredicate('resolution_code', 'expected_resolution_code', intent.expectedResolutionCode, parameters, utf8Parameter);
  return writeStatement(
    'UPDATE source_records SET '
      + 'last_seen_at = $last_seen_at, last_row_hint = $last_row_hint, current_digest = $current_digest, '
      + 'state = $state, classification = $classification, normalization_status = $normalization_status, '
      + 'transaction_id = $transaction_id, current_revision = $current_revision, resolution_code = $resolution_code, '
      + 'resolved_at = $resolved_at, resolved_by = $resolved_by '
      + 'WHERE id = $id AND current_revision = $expected_current_revision '
      + `AND current_digest = $expected_current_digest AND ${statePredicate} AND ${transactionPredicate} AND ${resolutionPredicate} `
      + 'RETURNING id',
    parameters,
  );
}

function transactionParameters(id: string, tx: Readonly<CanonicalTransaction>): Record<string, YdbParameter> {
  return {
    id: uuidParameter(id),
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
  };
}

function transactionCreateStatement(
  intent: Extract<IncrementalTransactionCurrentDeltaIntent, { kind: 'CREATE_TRANSACTION' }>,
  promotedAt: string,
): YdbStatement {
  const candidate = intent.candidate;
  const parameters = {
    ...transactionParameters(candidate.id, candidate.transaction),
    captured_at: timestampParameter(null),
    created_at: timestampParameter(promotedAt),
    updated_at: timestampParameter(promotedAt),
    version: uint64Parameter(candidate.version),
  };
  return writeStatement(
    'INSERT INTO transactions '
      + '(id, type, occurred_on, captured_at, record_granularity, date_precision, aggregate_period_month, '
      + 'financial_period_id, period_assignment_quality, amount_minor, currency, from_account_id, to_account_id, '
      + 'category_id, paid_by_member_id, description, note, status, analytics_state, flow_kind, created_at, updated_at, version) '
      + 'VALUES ($id, $type, $occurred_on, $captured_at, $record_granularity, $date_precision, $aggregate_period_month, '
      + '$financial_period_id, $period_assignment_quality, $amount_minor, $currency, $from_account_id, $to_account_id, '
      + '$category_id, $paid_by_member_id, $description, $note, $status, $analytics_state, $flow_kind, $created_at, '
      + '$updated_at, $version) RETURNING id',
    parameters,
  );
}

function transactionReplaceStatement(
  intent: Extract<IncrementalTransactionCurrentDeltaIntent, { kind: 'REPLACE_TRANSACTION' }>,
  promotedAt: string,
): YdbStatement {
  const candidate = intent.candidate;
  const parameters = {
    ...transactionParameters(candidate.id, candidate.transaction),
    updated_at: timestampParameter(promotedAt),
    version: uint64Parameter(candidate.version),
    expected_version: uint64Parameter(intent.expectedVersion),
  };
  return writeStatement(
    'UPDATE transactions SET '
      + 'type = $type, occurred_on = $occurred_on, record_granularity = $record_granularity, '
      + 'date_precision = $date_precision, aggregate_period_month = $aggregate_period_month, '
      + 'financial_period_id = $financial_period_id, period_assignment_quality = $period_assignment_quality, '
      + 'amount_minor = $amount_minor, currency = $currency, from_account_id = $from_account_id, '
      + 'to_account_id = $to_account_id, category_id = $category_id, paid_by_member_id = $paid_by_member_id, '
      + 'description = $description, note = $note, status = $status, analytics_state = $analytics_state, '
      + 'flow_kind = $flow_kind, updated_at = $updated_at, version = $version '
      + 'WHERE id = $id AND version = $expected_version RETURNING id',
    parameters,
  );
}

function revisionInsertStatement(revision: Readonly<IncrementalSourceRecordRevisionProjection>): YdbStatement {
  const parameters = {
    source_record_id: uuidParameter(revision.sourceRecordId),
    revision: uint64Parameter(revision.revision),
    migration_run_id: uuidParameter(revision.migrationRunId),
    observed_at: timestampParameter(revision.observedAt),
    row_hint: uint64Parameter(revision.rowHint),
    row_digest: stringParameter(revision.rowDigest),
    change_class: utf8Parameter(revision.changeClass),
    raw_payload: jsonDocumentParameter(revision.rawPayload),
  };
  return writeStatement(
    'INSERT INTO source_record_revisions '
      + '(source_record_id, revision, migration_run_id, observed_at, row_hint, row_digest, change_class, raw_payload) '
      + 'VALUES ($source_record_id, $revision, $migration_run_id, $observed_at, $row_hint, $row_digest, '
      + '$change_class, $raw_payload) RETURNING source_record_id',
    parameters,
  );
}

function requiredRevisionSources(
  delta: Readonly<IncrementalCurrentDeltaPlan>,
): ReadonlyMap<string, { readonly revision: number; readonly rowHint: number; readonly digest: string; readonly create: boolean }> {
  const required = new Map<string, { readonly revision: number; readonly rowHint: number; readonly digest: string; readonly create: boolean }>();
  for (const intent of delta.sourceIntents) {
    const candidate = intent.candidate;
    if (intent.kind === 'CREATE_SOURCE_RECORD') {
      if (candidate.currentRevision !== 1) throw new IncrementalCurrentPersistenceError('INVALID_SOURCE_REVISION_STEP');
      required.set(candidate.id.toLowerCase(), Object.freeze({ revision: 1, rowHint: candidate.lastRowHint, digest: candidate.currentDigest, create: true }));
      continue;
    }
    if (candidate.currentRevision === intent.expectedCurrentRevision) continue;
    if (candidate.currentRevision !== intent.expectedCurrentRevision + 1) {
      throw new IncrementalCurrentPersistenceError('INVALID_SOURCE_REVISION_STEP');
    }
    required.set(candidate.id.toLowerCase(), Object.freeze({
      revision: candidate.currentRevision,
      rowHint: candidate.lastRowHint,
      digest: candidate.currentDigest,
      create: false,
    }));
  }
  return required;
}

function assertRevisionCoverage(
  run: Readonly<MigrationRun>,
  delta: Readonly<IncrementalCurrentDeltaPlan>,
  revisionPlan: Readonly<IncrementalRevisionEvidencePlan>,
): void {
  const required = requiredRevisionSources(delta);
  const bySource = new Map<string, Readonly<IncrementalSourceRecordRevisionProjection>>();
  for (const revision of revisionPlan.revisions) {
    const id = revision.sourceRecordId.toLowerCase();
    if (bySource.has(id)) throw new IncrementalCurrentPersistenceError('DUPLICATE_REVISION_EVIDENCE');
    const expected = required.get(id);
    if (expected === undefined) throw new IncrementalCurrentPersistenceError('EXTRA_REVISION_EVIDENCE');
    if (revision.migrationRunId.toLowerCase() !== run.id.toLowerCase()) {
      throw new IncrementalCurrentPersistenceError('REVISION_RUN_MISMATCH');
    }
    if (revision.revision !== expected.revision || revision.rowHint !== expected.rowHint || revision.rowDigest !== expected.digest) {
      throw new IncrementalCurrentPersistenceError('REVISION_CURRENT_STATE_MISMATCH');
    }
    if (expected.create && revision.changeClass !== null) {
      throw new IncrementalCurrentPersistenceError('CREATE_REVISION_CHANGE_CLASS_INVALID');
    }
    if (!expected.create && revision.changeClass === null) {
      throw new IncrementalCurrentPersistenceError('REVISED_CHANGE_CLASS_MISSING');
    }
    bySource.set(id, revision);
  }
  for (const id of required.keys()) {
    if (!bySource.has(id)) throw new IncrementalCurrentPersistenceError('MISSING_REVISION_EVIDENCE');
  }
}

export function prepareIncrementalCurrentWrites(
  run: Readonly<MigrationRun>,
  delta: Readonly<IncrementalCurrentDeltaPlan>,
  revisionPlan: Readonly<IncrementalRevisionEvidencePlan>,
  promotedAt: string,
): Readonly<IncrementalPromotionWritePlan> {
  if (run.state !== 'VALIDATED' || run.finishedAt !== null || run.errorCode !== null) {
    throw new IncrementalCurrentPersistenceError('RUN_NOT_VALIDATED');
  }
  if (delta.promotionBlocker !== null) throw new IncrementalCurrentPersistenceError('PROMOTION_BLOCKED');
  try {
    timestampParameter(promotedAt);
  } catch {
    throw new IncrementalCurrentPersistenceError('INVALID_PROMOTED_AT');
  }

  assertRevisionCoverage(run, delta, revisionPlan);
  const writes: Readonly<PreparedIncrementalPromotionWrite>[] = [];

  for (const intent of [...delta.transactionIntents].sort((left, right) => left.candidate.id.localeCompare(right.candidate.id))) {
    const statement = intent.kind === 'CREATE_TRANSACTION'
      ? transactionCreateStatement(intent, promotedAt)
      : transactionReplaceStatement(intent, promotedAt);
    writes.push(prepared('TRANSACTION', intent.candidate.id, statement));
  }

  for (const revision of [...revisionPlan.revisions].sort((left, right) => (
    left.sourceRecordId.localeCompare(right.sourceRecordId) || left.revision - right.revision
  ))) {
    writes.push(prepared('SOURCE_REVISION', revision.sourceRecordId, revisionInsertStatement(revision)));
  }

  for (const intent of [...delta.sourceIntents].sort((left, right) => left.candidate.id.localeCompare(right.candidate.id))) {
    const statement = intent.kind === 'CREATE_SOURCE_RECORD'
      ? sourceCreateStatement(intent)
      : sourceUpdateStatement(intent);
    writes.push(prepared('SOURCE_RECORD', intent.candidate.id, statement));
  }

  return Object.freeze({ writes: Object.freeze(writes), preflight: assessAtomicPromotionWrites(writes) });
}
