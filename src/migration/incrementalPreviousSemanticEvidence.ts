import type { IncrementalPreviousFinancialQualityEvidence } from './incrementalCurrentObservationSemantics.js';
import type { IncrementalPreviousSemanticEvidence } from './incrementalSemanticTransition.js';
import type { IncrementalPreviousSourceCurrentEvidence } from './incrementalSourceCurrentCandidate.js';
import type {
  IncrementalSourceDeltaIntent,
  IncrementalSourceDeltaIntentPlan,
} from './incrementalSourceDeltaIntent.js';
import type { IncrementalPreviousTransactionCurrentEvidence } from './incrementalTransactionCurrentCandidate.js';

export interface IncrementalPreviousSemanticEvidenceProjection {
  readonly semanticEvidence: readonly Readonly<IncrementalPreviousSemanticEvidence>[];
  readonly financialQualityEvidence: readonly Readonly<IncrementalPreviousFinancialQualityEvidence>[];
}

export type IncrementalPreviousSemanticEvidenceErrorCode =
  | 'INVALID_SOURCE_RECORD_ID'
  | 'DUPLICATE_SOURCE_RECORD_ID'
  | 'INVALID_TRANSACTION_ID'
  | 'DUPLICATE_TRANSACTION_ID'
  | 'DUPLICATE_REQUIRED_SOURCE_ID'
  | 'MISSING_REQUIRED_SOURCE_EVIDENCE'
  | 'REQUIRED_SOURCE_NOT_ACTIVE'
  | 'SOURCE_INTENT_EVIDENCE_MISMATCH'
  | 'INVALID_SOURCE_TRANSACTION_LINK'
  | 'MISSING_LINKED_TRANSACTION'
  | 'INVALID_TRANSACTION_VERSION';

export class IncrementalPreviousSemanticEvidenceError extends Error {
  readonly code: IncrementalPreviousSemanticEvidenceErrorCode;

  constructor(code: IncrementalPreviousSemanticEvidenceErrorCode) {
    super(code);
    this.name = 'IncrementalPreviousSemanticEvidenceError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function normalizedUuid(value: string, code: 'INVALID_SOURCE_RECORD_ID' | 'INVALID_TRANSACTION_ID'): string {
  if (!UUID_PATTERN.test(value)) throw new IncrementalPreviousSemanticEvidenceError(code);
  return value.toLowerCase();
}

function sourceMap(
  sources: readonly Readonly<IncrementalPreviousSourceCurrentEvidence>[],
): ReadonlyMap<string, Readonly<IncrementalPreviousSourceCurrentEvidence>> {
  const byId = new Map<string, Readonly<IncrementalPreviousSourceCurrentEvidence>>();
  for (const source of sources) {
    const id = normalizedUuid(source.id, 'INVALID_SOURCE_RECORD_ID');
    if (byId.has(id)) throw new IncrementalPreviousSemanticEvidenceError('DUPLICATE_SOURCE_RECORD_ID');
    byId.set(id, source);
  }
  return byId;
}

function transactionMap(
  transactions: readonly Readonly<IncrementalPreviousTransactionCurrentEvidence>[],
): ReadonlyMap<string, Readonly<IncrementalPreviousTransactionCurrentEvidence>> {
  const byId = new Map<string, Readonly<IncrementalPreviousTransactionCurrentEvidence>>();
  for (const transaction of transactions) {
    const id = normalizedUuid(transaction.id, 'INVALID_TRANSACTION_ID');
    if (byId.has(id)) throw new IncrementalPreviousSemanticEvidenceError('DUPLICATE_TRANSACTION_ID');
    if (!Number.isSafeInteger(transaction.version) || transaction.version < 1) {
      throw new IncrementalPreviousSemanticEvidenceError('INVALID_TRANSACTION_VERSION');
    }
    byId.set(id, transaction);
  }
  return byId;
}

function expectedPrevious(
  intent: Exclude<IncrementalSourceDeltaIntent, { kind: 'CREATE' }>,
): Readonly<{ revision: number; digest: string; rowHint: number }> {
  if (intent.kind === 'REVISE') {
    return Object.freeze({
      revision: intent.expectedPreviousRevision,
      digest: intent.expectedPreviousDigest,
      rowHint: intent.previousRowHint,
    });
  }
  return Object.freeze({
    revision: intent.expectedRevision,
    digest: intent.expectedDigest,
    rowHint: intent.previousRowHint,
  });
}

function assertSourceMatchesIntent(
  source: Readonly<IncrementalPreviousSourceCurrentEvidence>,
  intent: Exclude<IncrementalSourceDeltaIntent, { kind: 'CREATE' }>,
): void {
  if (source.state !== null) {
    throw new IncrementalPreviousSemanticEvidenceError('REQUIRED_SOURCE_NOT_ACTIVE');
  }
  const expected = expectedPrevious(intent);
  if (
    source.currentRevision !== expected.revision
    || source.currentDigest !== expected.digest
    || source.lastRowHint !== expected.rowHint
  ) {
    throw new IncrementalPreviousSemanticEvidenceError('SOURCE_INTENT_EVIDENCE_MISMATCH');
  }
}

function linkedTransaction(
  source: Readonly<IncrementalPreviousSourceCurrentEvidence>,
  transactions: ReadonlyMap<string, Readonly<IncrementalPreviousTransactionCurrentEvidence>>,
): Readonly<IncrementalPreviousTransactionCurrentEvidence> | null {
  if (source.transactionId === null) return null;
  if (!UUID_PATTERN.test(source.transactionId)) {
    throw new IncrementalPreviousSemanticEvidenceError('INVALID_SOURCE_TRANSACTION_LINK');
  }
  const linked = transactions.get(source.transactionId.toLowerCase());
  if (linked === undefined) {
    throw new IncrementalPreviousSemanticEvidenceError('MISSING_LINKED_TRANSACTION');
  }
  return linked;
}

export function buildIncrementalPreviousSemanticEvidence(
  deltaPlan: Readonly<IncrementalSourceDeltaIntentPlan>,
  sources: readonly Readonly<IncrementalPreviousSourceCurrentEvidence>[],
  transactions: readonly Readonly<IncrementalPreviousTransactionCurrentEvidence>[],
): Readonly<IncrementalPreviousSemanticEvidenceProjection> {
  const sourcesById = sourceMap(sources);
  const transactionsById = transactionMap(transactions);
  const required = new Set<string>();
  const semanticEvidence: Readonly<IncrementalPreviousSemanticEvidence>[] = [];
  const financialQualityEvidence: Readonly<IncrementalPreviousFinancialQualityEvidence>[] = [];

  for (const intent of deltaPlan.intents) {
    if (intent.kind === 'CREATE') continue;
    const sourceRecordId = normalizedUuid(intent.sourceRecordId, 'INVALID_SOURCE_RECORD_ID');
    if (required.has(sourceRecordId)) {
      throw new IncrementalPreviousSemanticEvidenceError('DUPLICATE_REQUIRED_SOURCE_ID');
    }
    required.add(sourceRecordId);

    const source = sourcesById.get(sourceRecordId);
    if (source === undefined) {
      throw new IncrementalPreviousSemanticEvidenceError('MISSING_REQUIRED_SOURCE_EVIDENCE');
    }
    assertSourceMatchesIntent(source, intent);
    const transaction = linkedTransaction(source, transactionsById);

    semanticEvidence.push(Object.freeze({
      sourceRecordId,
      classification: source.classification,
      transactionId: transaction?.id.toLowerCase() ?? null,
      transactionVersion: transaction?.version ?? null,
    }));

    if (intent.kind === 'REVISE' && transaction !== null) {
      financialQualityEvidence.push(Object.freeze({
        sourceRecordId,
        recordGranularity: transaction.transaction.recordGranularity,
        datePrecision: transaction.transaction.datePrecision,
        aggregatePeriodMonth: transaction.transaction.aggregatePeriodMonth,
      }));
    }
  }

  semanticEvidence.sort((left, right) => left.sourceRecordId.localeCompare(right.sourceRecordId));
  financialQualityEvidence.sort((left, right) => left.sourceRecordId.localeCompare(right.sourceRecordId));

  return Object.freeze({
    semanticEvidence: Object.freeze(semanticEvidence),
    financialQualityEvidence: Object.freeze(financialQualityEvidence),
  });
}
