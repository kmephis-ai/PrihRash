export const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
export const observedAt = '2026-09-07T07:04:00.000Z';
const firstSeenAt = '2026-09-01T10:00:00.000Z';
const lastSeenAt = '2026-09-06T10:00:00.000Z';

export function previous(n, overrides = {}) {
  return Object.freeze({
    id: id(n),
    sourceType: 'GOOGLE_SHEETS',
    sourceSheet: 'Ответы на форму (11)',
    firstSeenAt,
    lastSeenAt,
    lastRowHint: n * 10,
    currentDigest: `d-${n}`,
    state: null,
    classification: 'FINANCIAL_RECORD',
    normalizationStatus: null,
    transactionId: id(100 + n),
    currentRevision: 1,
    resolutionCode: null,
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  });
}

export function touch(n, currentRowHint) {
  return Object.freeze({
    kind: 'TOUCH',
    sourceRecordId: id(n),
    expectedRevision: 1,
    expectedDigest: `d-${n}`,
    previousRowHint: n * 10,
    currentRowHint,
    observedAt,
  });
}

export function revise(n, currentRowHint, previousRevision, currentDigest = `new-${n}`) {
  return Object.freeze({
    kind: 'REVISE',
    sourceRecordId: id(n),
    expectedPreviousRevision: previousRevision,
    expectedPreviousDigest: `d-${n}`,
    previousRowHint: n * 10,
    currentRevision: previousRevision + 1,
    currentDigest,
    currentRowHint,
    observedAt,
  });
}

export function missing(n, revision = 1) {
  return Object.freeze({
    kind: 'MARK_MISSING',
    sourceRecordId: id(n),
    expectedRevision: revision,
    expectedDigest: `d-${n}`,
    previousRowHint: n * 10,
  });
}

export function create(n, currentRowHint) {
  return Object.freeze({
    kind: 'CREATE',
    sourceRecordId: id(n),
    currentRevision: 1,
    currentDigest: `new-${n}`,
    currentRowHint,
    observedAt,
  });
}

export function transaction(amountMinor = 1000) {
  return Object.freeze({
    type: 'EXPENSE',
    occurredOn: '2026-09-07',
    recordGranularity: 'UNKNOWN',
    datePrecision: 'UNKNOWN',
    aggregatePeriodMonth: null,
    financialPeriodId: null,
    periodAssignmentQuality: 'UNASSIGNED',
    amountMinor,
    currency: 'RUB',
    fromAccountId: id(9001),
    toAccountId: null,
    categoryId: id(9002),
    paidByMemberId: null,
    description: 'Synthetic candidate',
    note: null,
    status: 'POSTED',
    analyticsState: 'INCLUDED',
    flowKind: null,
  });
}
