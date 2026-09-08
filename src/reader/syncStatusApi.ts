import { YdbAdapter } from '../integration/ydb/adapter.js';
import { readScheduledSyncAdmissionEvidence } from '../migration/scheduledSyncAdmissionEvidence.js';

export const READER_SYNC_STATUS_API_VERSION = 1 as const;

export type ReaderSyncStatusState = 'READY' | 'DEGRADED' | 'UNAVAILABLE';

export interface ReaderSyncStatusApiResponse {
  readonly apiVersion: typeof READER_SYNC_STATUS_API_VERSION;
  readonly state: ReaderSyncStatusState;
  readonly lastCommittedAt: string | null;
  readonly hasIncompleteRun: boolean;
}

export type ReaderSyncStatusErrorCode = 'SYNC_STATUS_EVIDENCE_UNAVAILABLE';

export class ReaderSyncStatusError extends Error {
  readonly code: ReaderSyncStatusErrorCode;

  constructor(code: ReaderSyncStatusErrorCode) {
    super(code);
    this.name = 'ReaderSyncStatusError';
    this.code = code;
  }
}

export async function executeReaderSyncStatusApiRequest(
  adapter: YdbAdapter,
): Promise<Readonly<ReaderSyncStatusApiResponse>> {
  try {
    const evidence = await readScheduledSyncAdmissionEvidence(adapter);
    const committed = evidence.committedBaselineRun;
    const hasIncompleteRun = evidence.incompleteRuns.length > 0;

    if (committed === null) {
      return Object.freeze({
        apiVersion: READER_SYNC_STATUS_API_VERSION,
        state: 'UNAVAILABLE',
        lastCommittedAt: null,
        hasIncompleteRun,
      });
    }

    return Object.freeze({
      apiVersion: READER_SYNC_STATUS_API_VERSION,
      state: hasIncompleteRun ? 'DEGRADED' : 'READY',
      lastCommittedAt: committed.finishedAt,
      hasIncompleteRun,
    });
  } catch {
    throw new ReaderSyncStatusError('SYNC_STATUS_EVIDENCE_UNAVAILABLE');
  }
}
