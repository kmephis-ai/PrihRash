import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IncrementalPreviousSemanticEvidenceError,
  buildIncrementalPreviousSemanticEvidence,
} from '../../dist/migration/incrementalPreviousSemanticEvidence.js';

function source(id, overrides = {}) {
  return {
    id,
    sourceType: 'GOOGLE_SHEETS',
    sourceSheet: 'Ответы на форму (11)',
    firstSeenAt: '2026-08-01T00:00:00.000Z',
    lastSeenAt: '2026-09-07T00:00:00.000Z',
    lastRowHint: 5,
    currentDigest: 'digest-a',
    state: null,
    classification: 'FINANCIAL_RECORD',
    normalizationStatus: 'NORMALIZED',
    transactionId: null,
    currentRevision: 2,
    resolutionCode: null,
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}

function transaction(id, overrides = {}) {
  return {
    id,
    version: 3,
    transaction: {
      type: 'EXPENSE',
      occurredOn: '2026-09-05',
      recordGranularity: 'TRANSACTION',
      datePrecision: 'DAY',
      aggregatePeriodMonth: null,
      financialPeriodId: null,
      periodAssignmentQuality: 'UNASSIGNED',
      amountMinor: 10000,
      currency: 'RUB',
      fromAccountId: '00000000-0000-0000-0000-000000000401',
      toAccountId: null,
      categoryId: '00000000-0000-0000-0000-000000000501',
      paidByMemberId: null,
      description: 'synthetic',
      note: null,
      status: 'POSTED',
      analyticsState: 'INCLUDED',
      flowKind: null,
      ...overrides,
    },
  };
}

const IDS = {
  touch: '00000000-0000-0000-0000-000000000201',
  revise: '00000000-0000-0000-0000-000000000202',
  missing: '00000000-0000-0000-0000-000000000203',
  create: '00000000-0000-0000-0000-000000000204',
  historical: '00000000-0000-0000-0000-000000000205',
  txTouch: '00000000-0000-0000-0000-000000000301',
  txRevise: '00000000-0000-0000-0000-000000000302',
  txExtra: '00000000-0000-0000-0000-000000000303',
};

function deltaPlan(overrides = {}) {
  return {
    intents: [
      {
        kind: 'TOUCH', sourceRecordId: IDS.touch, expectedRevision: 2, expectedDigest: 'digest-a',
        previousRowHint: 5, currentRowHint: 5, observedAt: '2026-09-07T12:00:00.000Z',
      },
      {
        kind: 'REVISE', sourceRecordId: IDS.revise, expectedPreviousRevision: 4, expectedPreviousDigest: 'digest-b',
        previousRowHint: 6, currentRevision: 5, currentDigest: 'digest-b2', currentRowHint: 6,
        observedAt: '2026-09-07T12:00:00.000Z',
      },
      {
        kind: 'MARK_MISSING', sourceRecordId: IDS.missing, expectedRevision: 1, expectedDigest: 'digest-c',
        previousRowHint: 7,
      },
      {
        kind: 'CREATE', sourceRecordId: IDS.create, currentRevision: 1, currentDigest: 'digest-d',
        currentRowHint: 8, observedAt: '2026-09-07T12:00:00.000Z',
      },
    ],
    unresolvedBlocks: [],
    ...overrides,
  };
}

function sourceEvidence() {
  return [
    source(IDS.touch, { transactionId: IDS.txTouch }),
    source(IDS.revise, {
      lastRowHint: 6,
      currentDigest: 'digest-b',
      currentRevision: 4,
      transactionId: IDS.txRevise,
    }),
    source(IDS.missing, {
      lastRowHint: 7,
      currentDigest: 'digest-c',
      currentRevision: 1,
      classification: 'NON_FINANCIAL',
    }),
    source(IDS.historical, {
      state: 'MISSING', lastRowHint: 3, currentDigest: 'old', currentRevision: 9, classification: 'AMBIGUOUS',
    }),
  ];
}

test('projects semantic and revised financial-quality evidence from the same verified links', () => {
  const transactions = [
    transaction(IDS.txTouch, { recordGranularity: 'TRANSACTION', datePrecision: 'DAY' }),
    transaction(IDS.txRevise, {
      recordGranularity: 'PERIOD_AGGREGATE', datePrecision: 'MONTH', aggregatePeriodMonth: '2026-09-01',
    }),
    transaction(IDS.txExtra),
  ];

  const projection = buildIncrementalPreviousSemanticEvidence(deltaPlan(), sourceEvidence(), transactions);

  assert.deepEqual(projection.semanticEvidence, [
    {
      sourceRecordId: IDS.touch,
      classification: 'FINANCIAL_RECORD',
      transactionId: IDS.txTouch,
      transactionVersion: 3,
    },
    {
      sourceRecordId: IDS.revise,
      classification: 'FINANCIAL_RECORD',
      transactionId: IDS.txRevise,
      transactionVersion: 3,
    },
    {
      sourceRecordId: IDS.missing,
      classification: 'NON_FINANCIAL',
      transactionId: null,
      transactionVersion: null,
    },
  ]);
  assert.deepEqual(projection.financialQualityEvidence, [
    {
      sourceRecordId: IDS.revise,
      recordGranularity: 'PERIOD_AGGREGATE',
      datePrecision: 'MONTH',
      aggregatePeriodMonth: '2026-09-01',
    },
  ]);
  assert.equal(Object.isFrozen(projection), true);
  assert.equal(Object.isFrozen(projection.semanticEvidence), true);
  assert.equal(Object.isFrozen(projection.financialQualityEvidence), true);
});

test('CREATE, unrelated historical MISSING sources, and unrelated transactions are not projected', () => {
  const projection = buildIncrementalPreviousSemanticEvidence(
    { intents: [deltaPlan().intents[3]], unresolvedBlocks: [] },
    sourceEvidence(),
    [transaction(IDS.txExtra)],
  );
  assert.deepEqual(projection, { semanticEvidence: [], financialQualityEvidence: [] });
});

test('unlinked revised source remains semantic evidence with null version and emits no financial quality', () => {
  const revise = deltaPlan().intents[1];
  const sources = [source(IDS.revise, {
    lastRowHint: 6, currentDigest: 'digest-b', currentRevision: 4, classification: 'AMBIGUOUS', transactionId: null,
  })];
  const projection = buildIncrementalPreviousSemanticEvidence(
    { intents: [revise], unresolvedBlocks: [] },
    sources,
    [],
  );
  assert.equal(projection.semanticEvidence[0].transactionId, null);
  assert.equal(projection.semanticEvidence[0].transactionVersion, null);
  assert.deepEqual(projection.financialQualityEvidence, []);
});

test('stale or wrong source evidence is rejected before semantic projection', () => {
  const touch = deltaPlan().intents[0];
  for (const overrides of [
    { currentRevision: 3 },
    { currentDigest: 'other' },
    { lastRowHint: 99 },
  ]) {
    assert.throws(
      () => buildIncrementalPreviousSemanticEvidence(
        { intents: [touch], unresolvedBlocks: [] },
        [source(IDS.touch, overrides)],
        [],
      ),
      (error) => error instanceof IncrementalPreviousSemanticEvidenceError
        && error.code === 'SOURCE_INTENT_EVIDENCE_MISMATCH',
    );
  }

  assert.throws(
    () => buildIncrementalPreviousSemanticEvidence(
      { intents: [touch], unresolvedBlocks: [] },
      [source(IDS.touch, { state: 'MISSING' })],
      [],
    ),
    (error) => error instanceof IncrementalPreviousSemanticEvidenceError
      && error.code === 'REQUIRED_SOURCE_NOT_ACTIVE',
  );
});

test('missing source or linked transaction fails closed', () => {
  const touch = deltaPlan().intents[0];
  assert.throws(
    () => buildIncrementalPreviousSemanticEvidence({ intents: [touch], unresolvedBlocks: [] }, [], []),
    (error) => error instanceof IncrementalPreviousSemanticEvidenceError
      && error.code === 'MISSING_REQUIRED_SOURCE_EVIDENCE',
  );
  assert.throws(
    () => buildIncrementalPreviousSemanticEvidence(
      { intents: [touch], unresolvedBlocks: [] },
      [source(IDS.touch, { transactionId: IDS.txTouch })],
      [],
    ),
    (error) => error instanceof IncrementalPreviousSemanticEvidenceError
      && error.code === 'MISSING_LINKED_TRANSACTION',
  );
});

test('duplicate normalized source, transaction, or required intent identities fail closed', () => {
  const touch = deltaPlan().intents[0];
  assert.throws(
    () => buildIncrementalPreviousSemanticEvidence(
      { intents: [touch], unresolvedBlocks: [] },
      [source(IDS.touch), source(IDS.touch.toUpperCase())],
      [],
    ),
    (error) => error instanceof IncrementalPreviousSemanticEvidenceError
      && error.code === 'DUPLICATE_SOURCE_RECORD_ID',
  );

  assert.throws(
    () => buildIncrementalPreviousSemanticEvidence(
      { intents: [touch], unresolvedBlocks: [] },
      [source(IDS.touch)],
      [transaction(IDS.txTouch), transaction(IDS.txTouch.toUpperCase())],
    ),
    (error) => error instanceof IncrementalPreviousSemanticEvidenceError
      && error.code === 'DUPLICATE_TRANSACTION_ID',
  );

  assert.throws(
    () => buildIncrementalPreviousSemanticEvidence(
      { intents: [touch, { ...touch }], unresolvedBlocks: [] },
      [source(IDS.touch)],
      [],
    ),
    (error) => error instanceof IncrementalPreviousSemanticEvidenceError
      && error.code === 'DUPLICATE_REQUIRED_SOURCE_ID',
  );
});
