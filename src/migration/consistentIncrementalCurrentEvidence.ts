import { YdbAdapter } from '../integration/ydb/adapter.js';
import {
  readIncrementalCurrentRevisionEvidence,
  type IncrementalCurrentRevisionEvidenceSnapshot,
} from './incrementalCurrentRevisionEvidenceReader.js';
import {
  readIncrementalSourceCurrentEvidence,
  type IncrementalSourceCurrentEvidenceSnapshot,
} from './incrementalSourceCurrentEvidenceReader.js';
import {
  readIncrementalTransactionCurrentEvidence,
} from './incrementalTransactionCurrentEvidenceReader.js';
import type { IncrementalPreviousTransactionCurrentEvidence } from './incrementalTransactionCurrentCandidate.js';
import {
  parseScheduledSyncAdmissionEvidence,
  scheduledSyncAdmissionEvidenceStatement,
  type MigrationRunEvidenceRow,
  type ScheduledSyncAdmissionEvidence,
} from './scheduledSyncAdmissionEvidence.js';

export interface ConsistentIncrementalCurrentEvidenceSnapshot {
  readonly admissionEvidence: Readonly<ScheduledSyncAdmissionEvidence>;
  readonly sourceEvidence: Readonly<IncrementalSourceCurrentEvidenceSnapshot>;
  readonly revisionEvidence: Readonly<IncrementalCurrentRevisionEvidenceSnapshot>;
  readonly previousTransactions: readonly Readonly<IncrementalPreviousTransactionCurrentEvidence>[];
}

export async function readConsistentIncrementalCurrentEvidence(
  adapter: YdbAdapter,
): Promise<Readonly<ConsistentIncrementalCurrentEvidenceSnapshot>> {
  return adapter.serializableReadWrite(async (transaction) => {
    const admissionRows = await transaction.read<MigrationRunEvidenceRow>(
      scheduledSyncAdmissionEvidenceStatement(),
    );
    const admissionEvidence = parseScheduledSyncAdmissionEvidence(admissionRows.rows);
    const sourceEvidence = await readIncrementalSourceCurrentEvidence(transaction);
    const revisionEvidence = await readIncrementalCurrentRevisionEvidence(
      transaction,
      sourceEvidence.sourceCurrent,
    );
    const previousTransactions = await readIncrementalTransactionCurrentEvidence(transaction);

    return Object.freeze({
      admissionEvidence,
      sourceEvidence,
      revisionEvidence,
      previousTransactions,
    });
  });
}
