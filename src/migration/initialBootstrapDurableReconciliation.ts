import type { YdbAdapter } from '../integration/ydb/adapter.js';
import { normalizeRawPayload } from './rawPayloadProvenance.js';
import {
  buildExpectedControlledRebuildReconciliation,
  compareControlledRebuildStagingReconciliation,
  type InitialControlledRebuildReconciliationSnapshot,
} from './initialControlledRebuildReconciliation.js';
import { readControlledRebuildCurrentEvidence } from './initialControlledRebuildEvidenceReader.js';
import type {
  InitialBootstrapReconciliationInput,
  InitialBootstrapReconciliationPort,
} from './initialBootstrapApplication.js';
import type { InitialSnapshotProjection, InitialSnapshotProjectionContext } from './initialSnapshotProjection.js';
import { projectInitialSnapshot } from './initialSnapshotProjection.js';
import { planInitialSourceRevisionEvidenceResume } from './initialSourceRevisionEvidenceRecovery.js';
import type { InitialBootstrapPrivateHistoricalEvidence } from './initialBootstrapPrivateEvidence.js';
import type { InitialReconciliationEvidence } from './initialValidationGate.js';

export type InitialBootstrapDurableReconciliationErrorCode =
  | 'DURABLE_REVISION_EVIDENCE_INCOMPLETE'
  | 'DURABLE_RAW_PAYLOAD_INVALID'
  | 'EXPECTED_RECONCILIATION_NOT_AVAILABLE';

export class InitialBootstrapDurableReconciliationError extends Error {
  readonly code: InitialBootstrapDurableReconciliationErrorCode;

  constructor(code: InitialBootstrapDurableReconciliationErrorCode) {
    super(code);
    this.name = 'InitialBootstrapDurableReconciliationError';
    this.code = code;
  }
}

function snapshotFromProjection(
  projection: Readonly<InitialSnapshotProjection>,
): Readonly<InitialControlledRebuildReconciliationSnapshot> {
  return buildExpectedControlledRebuildReconciliation({
    sourceRecords: Object.freeze(projection.outcomes.map((outcome) => Object.freeze({
      classification: outcome.classification,
      state: null,
    }))),
    transactions: Object.freeze(projection.outcomes.flatMap((outcome) => (
      outcome.transaction === null ? [] : [Object.freeze({ transaction: outcome.transaction })]
    ))),
  });
}

function rawPayload(serialized: string) {
  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('shape');
    }
    return normalizeRawPayload(parsed as Readonly<Record<string, unknown>>);
  } catch {
    throw new InitialBootstrapDurableReconciliationError('DURABLE_RAW_PAYLOAD_INVALID');
  }
}

export interface InitialBootstrapDurableReconciliation {
  readonly port: Readonly<InitialBootstrapReconciliationPort>;
  verifyCommittedCurrent(): Promise<Readonly<InitialReconciliationEvidence>>;
}

export function createInitialBootstrapDurableReconciliation(
  adapter: YdbAdapter,
  projectionContext: Readonly<InitialSnapshotProjectionContext>,
  historicalEvidence: Readonly<InitialBootstrapPrivateHistoricalEvidence>,
): Readonly<InitialBootstrapDurableReconciliation> {
  let expectedCommittedSnapshot: Readonly<InitialControlledRebuildReconciliationSnapshot> | null = null;

  const port: InitialBootstrapReconciliationPort = Object.freeze({
    async reconcile(input: Readonly<InitialBootstrapReconciliationInput>) {
      const persistence = await planInitialSourceRevisionEvidenceResume(adapter, input.lineage.revisions);
      if (
        persistence.missingRevisions.length !== 0
        || persistence.existingSourceRecordIds.length !== input.lineage.revisions.length
      ) {
        throw new InitialBootstrapDurableReconciliationError('DURABLE_REVISION_EVIDENCE_INCOMPLETE');
      }

      const reconstructed = projectInitialSnapshot(
        input.lineage.revisions.map((revision, sourceOrdinal) => Object.freeze({
          sourceRecordId: revision.sourceRecordId,
          sourceOrdinal,
          rawPayload: rawPayload(revision.rawPayload),
          aggregatePeriodMonth: historicalEvidence.aggregatePeriodMonthForSourceOrdinal(sourceOrdinal),
        })),
        projectionContext,
      );

      const expected = snapshotFromProjection(input.projection);
      const observed = snapshotFromProjection(reconstructed);
      const comparison = compareControlledRebuildStagingReconciliation(expected, observed);
      expectedCommittedSnapshot = expected;
      return comparison;
    },
  });

  return Object.freeze({
    port,
    async verifyCommittedCurrent(): Promise<Readonly<InitialReconciliationEvidence>> {
      if (expectedCommittedSnapshot === null) {
        throw new InitialBootstrapDurableReconciliationError('EXPECTED_RECONCILIATION_NOT_AVAILABLE');
      }
      const observed = await readControlledRebuildCurrentEvidence(adapter);
      return compareControlledRebuildStagingReconciliation(expectedCommittedSnapshot, observed);
    },
  });
}
