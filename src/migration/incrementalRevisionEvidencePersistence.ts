import {
  type YdbParameter,
  jsonDocumentParameter,
  stringParameter,
  timestampParameter,
  uint64Parameter,
  utf8Parameter,
  uuidParameter,
} from '../integration/ydb/parameters.js';
import { type YdbStatement, writeStatement, YdbAdapter } from '../integration/ydb/adapter.js';
import type { IncrementalRevisionEvidencePlan } from './incrementalRevisionEvidence.js';
import {
  executeInitialRevisionEvidenceBatches,
  planInitialRevisionEvidenceBatches,
  type InitialRevisionEvidenceBatch,
} from './initialSourceRevisionEvidenceExecutor.js';

export interface PreparedIncrementalRevisionEvidenceWrite {
  readonly role: 'STAGING_EVIDENCE';
  readonly statement: YdbStatement;
  readonly estimatedParameterBytes: number;
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

function revisionStatement(
  revision: IncrementalRevisionEvidencePlan['revisions'][number],
): YdbStatement {
  return writeStatement(
    'UPSERT INTO source_record_revisions '
      + '(source_record_id, revision, migration_run_id, observed_at, row_hint, row_digest, change_class, raw_payload) '
      + 'VALUES ($source_record_id, $revision, $migration_run_id, $observed_at, $row_hint, $row_digest, '
      + '$change_class, $raw_payload)',
    {
      source_record_id: uuidParameter(revision.sourceRecordId),
      revision: uint64Parameter(revision.revision),
      migration_run_id: uuidParameter(revision.migrationRunId),
      observed_at: timestampParameter(revision.observedAt),
      row_hint: uint64Parameter(revision.rowHint),
      row_digest: stringParameter(revision.rowDigest),
      change_class: utf8Parameter(revision.changeClass),
      raw_payload: jsonDocumentParameter(revision.rawPayload),
    },
  );
}

export function prepareIncrementalRevisionEvidenceWrites(
  plan: Readonly<IncrementalRevisionEvidencePlan>,
): readonly Readonly<PreparedIncrementalRevisionEvidenceWrite>[] {
  return Object.freeze(plan.revisions.map((revision) => {
    const statement = revisionStatement(revision);
    return Object.freeze({
      role: 'STAGING_EVIDENCE' as const,
      statement,
      estimatedParameterBytes: estimateParameterBytes(statement.parameters),
    });
  }));
}

export function planIncrementalRevisionEvidenceBatches(
  writes: readonly Readonly<PreparedIncrementalRevisionEvidenceWrite>[],
): readonly Readonly<InitialRevisionEvidenceBatch>[] {
  return planInitialRevisionEvidenceBatches(writes);
}

export async function executeIncrementalRevisionEvidenceBatches(
  adapter: YdbAdapter,
  batches: readonly Readonly<InitialRevisionEvidenceBatch>[],
): Promise<void> {
  await executeInitialRevisionEvidenceBatches(adapter, batches);
}
