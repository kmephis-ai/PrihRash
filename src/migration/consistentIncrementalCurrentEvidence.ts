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

export interface ConsistentIncrementalCurrentEvidenceSnapshot {
  readonly sourceEvidence: Readonly<IncrementalSourceCurrentEvidenceSnapshot>;
  readonly revisionEvidence: Readonly<IncrementalCurrentRevisionEvidenceSnapshot>;
  readonly previousTransactions: readonly Readonly<IncrementalPreviousTransactionCurrentEvidence>[];
}

export async function readConsistentIncrementalCurrentEvidence(
  adapter: YdbAdapter,
): Promise<Readonly<ConsistentIncrementalCurrentEvidenceSnapshot>> {
  return adapter.serializableReadWrite(async (transaction) => {
    const sourceEvidence = await readIncrementalSourceCurrentEvidence(transaction);
    const revisionEvidence = await readIncrementalCurrentRevisionEvidence(
      transaction,
      sourceEvidence.sourceCurrent,
    );
    const previousTransactions = await readIncrementalTransactionCurrentEvidence(transaction);

    return Object.freeze({
      sourceEvidence,
      revisionEvidence,
      previousTransactions,
    });
  });
}
