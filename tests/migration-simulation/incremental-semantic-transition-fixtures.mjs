import {
  buildIncrementalSemanticTransitionPlan,
} from '../../dist/migration/incrementalSemanticTransition.js';

export const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
export const observedAt = '2026-09-07T06:20:00.000Z';

export function transaction(amountMinor = 1234) {
  return Object.freeze({
    type: 'EXPENSE', occurredOn: '2026-09-07', recordGranularity: 'TRANSACTION', datePrecision: 'DAY',
    aggregatePeriodMonth: null, financialPeriodId: null, periodAssignmentQuality: 'UNASSIGNED',
    amountMinor, currency: 'RUB', fromAccountId: id(9001), toAccountId: null, categoryId: id(9002),
    paidByMemberId: null, description: 'Synthetic transition fixture', note: null,
    status: 'POSTED', analyticsState: 'INCLUDED', flowKind: null,
  });
}

export function touch(sourceRecordId, rowHint) {
  return Object.freeze({
    kind: 'TOUCH', sourceRecordId, expectedRevision: 1, expectedDigest: `d-${rowHint}`,
    previousRowHint: rowHint - 1, currentRowHint: rowHint, observedAt,
  });
}

export function create(sourceRecordId, rowHint) {
  return Object.freeze({
    kind: 'CREATE', sourceRecordId, currentRevision: 1, currentDigest: `d-${rowHint}`,
    currentRowHint: rowHint, observedAt,
  });
}

export function revise(sourceRecordId, rowHint, revisionNumber = 2) {
  return Object.freeze({
    kind: 'REVISE', sourceRecordId, expectedPreviousRevision: revisionNumber - 1,
    expectedPreviousDigest: `old-${rowHint}`, previousRowHint: rowHint - 1,
    currentRevision: revisionNumber, currentDigest: `d-${rowHint}`, currentRowHint: rowHint, observedAt,
  });
}

export function missing(sourceRecordId, previousRowHint) {
  return Object.freeze({
    kind: 'MARK_MISSING', sourceRecordId, expectedRevision: 1,
    expectedDigest: `old-${previousRowHint}`, previousRowHint,
  });
}

export function outcome({ currentRowHint, sourceRecordId, lineageKind, classification,
  projection = { status: 'NOT_EVALUATED', reason: 'NOT_FINANCIAL_RECORD' }, sourceOrdinal = currentRowHint }) {
  return Object.freeze({
    currentRowHint, sourceOrdinal, sourceRecordId, lineageKind, classification,
    legacyPeriodCloseClassification: 'NOT_APPLICABLE',
    decodeErrorCode: classification === 'INVALID' ? 'INVALID_PAYLOAD_SCHEMA' : null,
    financialProjection: Object.freeze(projection),
  });
}

export function revision(sourceRecordId, rowHint, changeClass, revisionNumber = 2) {
  return Object.freeze({
    sourceRecordId, revision: revisionNumber, migrationRunId: id(8000), observedAt,
    rowHint, rowDigest: `d-${rowHint}`, changeClass, rawPayload: '{}',
  });
}

export function previous(sourceRecordId, classification, transactionId = null, transactionVersion = null) {
  return Object.freeze({ sourceRecordId, classification, transactionId, transactionVersion });
}

export function runPlan(intents, outcomes, revisions = [], previousEvidence = [], unresolvedBlocks = []) {
  return buildIncrementalSemanticTransitionPlan(
    Object.freeze({ intents: Object.freeze(intents), unresolvedBlocks: Object.freeze(unresolvedBlocks) }),
    Object.freeze({ outcomes: Object.freeze(outcomes) }),
    Object.freeze({ revisions: Object.freeze(revisions) }),
    Object.freeze(previousEvidence),
  );
}
