import { YdbAdapter, writeStatement, type YdbStatement } from '../integration/ydb/adapter.js';
import type { YdbParameter } from '../integration/ydb/parameters.js';
import {
  PRELIVE_PROMOTION_QUERY_BYTES_LIMIT,
  assessAtomicPromotionWrites,
  type PromotionWrite,
} from './atomicPromotion.js';
import type { PreparedInitialSourceLineageWrite } from './initialSourceLineagePersistence.js';

// Keep the existing commit boundary: at most 50 revision rows per transaction.
// Within that boundary, execute one multi-row YQL INSERT so live initial bootstrap
// does not pay one provider round-trip per source row. A failed transaction still
// rolls back the whole batch and earlier committed batches remain resumable.
export const INITIAL_REVISION_EVIDENCE_WRITES_PER_TRANSACTION_LIMIT = 50;

const REVISION_COLUMNS = Object.freeze([
  'source_record_id',
  'revision',
  'migration_run_id',
  'observed_at',
  'row_hint',
  'row_digest',
  'change_class',
  'raw_payload',
] as const);
const REVISION_COLUMN_LIST = REVISION_COLUMNS.join(', ');
const SINGLE_ROW_INSERT_TEXT = `INSERT INTO source_record_revisions (${REVISION_COLUMN_LIST}) VALUES (`
  + REVISION_COLUMNS.map((name) => `$${name}`).join(', ')
  + ')';
const TEXT_ENCODER = new TextEncoder();

export interface InitialRevisionEvidenceBatch {
  readonly writes: readonly PreparedInitialSourceLineageWrite[];
  readonly totalEstimatedParameterBytes: number;
}

export type InitialRevisionEvidenceErrorCode =
  | 'NON_EVIDENCE_WRITE'
  | 'EVIDENCE_WRITE_TOO_LARGE'
  | 'EVIDENCE_WRITE_SHAPE_INVALID'
  | 'EVIDENCE_BATCH_QUERY_TOO_LARGE';

export class InitialRevisionEvidenceError extends Error {
  readonly code: InitialRevisionEvidenceErrorCode;

  constructor(code: InitialRevisionEvidenceErrorCode) {
    super(code);
    this.name = 'InitialRevisionEvidenceError';
    this.code = code;
  }
}

function asPromotionWrites(writes: readonly PreparedInitialSourceLineageWrite[]): PromotionWrite[] {
  return writes.map((write) => ({
    statement: write.statement,
    estimatedParameterBytes: write.estimatedParameterBytes,
  }));
}

function exactRevisionParameters(
  statement: Readonly<YdbStatement>,
): statement is Readonly<YdbStatement> & { readonly parameters: Readonly<Record<string, YdbParameter>> } {
  const actual = Object.keys(statement.parameters).sort();
  const expected = [...REVISION_COLUMNS].sort();
  return actual.length === expected.length
    && actual.every((name, index) => name === expected[index]);
}

function buildRevisionEvidenceBatchStatement(
  writes: readonly PreparedInitialSourceLineageWrite[],
): YdbStatement | null {
  if (writes.length === 0) {
    throw new InitialRevisionEvidenceError('EVIDENCE_WRITE_SHAPE_INVALID');
  }

  for (const write of writes) {
    if (write.role !== 'STAGING_EVIDENCE') {
      throw new InitialRevisionEvidenceError('NON_EVIDENCE_WRITE');
    }
  }

  const isExactInitialInsert = (write: PreparedInitialSourceLineageWrite): boolean =>
    write.statement.kind === 'WRITE'
    && write.statement.text === SINGLE_ROW_INSERT_TEXT
    && exactRevisionParameters(write.statement);

  if (!writes.every(isExactInitialInsert)) {
    // This executor is also reused by incremental revision evidence, which currently
    // uses UPSERT and must retain its existing sequential transaction semantics.
    // A statement that claims the initial INSERT surface but does not match its exact
    // generated shape is unsafe to rewrite and therefore fails closed.
    if (writes.some((write) => write.statement.text.startsWith('INSERT INTO source_record_revisions'))) {
      throw new InitialRevisionEvidenceError('EVIDENCE_WRITE_SHAPE_INVALID');
    }
    return null;
  }

  const parameters: Record<string, YdbParameter> = {};
  const tuples: string[] = [];

  for (const [index, write] of writes.entries()) {
    const names: string[] = [];
    for (const column of REVISION_COLUMNS) {
      const parameter = write.statement.parameters[column];
      if (parameter === undefined) {
        throw new InitialRevisionEvidenceError('EVIDENCE_WRITE_SHAPE_INVALID');
      }
      const name = index === 0 ? column : `${column}_${index}`;
      parameters[name] = parameter;
      names.push(`$${name}`);
    }
    tuples.push(`(${names.join(', ')})`);
  }

  const statement = writeStatement(
    `INSERT INTO source_record_revisions (${REVISION_COLUMN_LIST}) VALUES ${tuples.join(', ')}`,
    parameters,
  );
  if (TEXT_ENCODER.encode(statement.text).byteLength > PRELIVE_PROMOTION_QUERY_BYTES_LIMIT) {
    throw new InitialRevisionEvidenceError('EVIDENCE_BATCH_QUERY_TOO_LARGE');
  }
  return statement;
}

export function planInitialRevisionEvidenceBatches(
  writes: readonly PreparedInitialSourceLineageWrite[],
): readonly Readonly<InitialRevisionEvidenceBatch>[] {
  for (const write of writes) {
    if (write.role !== 'STAGING_EVIDENCE') {
      throw new InitialRevisionEvidenceError('NON_EVIDENCE_WRITE');
    }
    if (!assessAtomicPromotionWrites(asPromotionWrites([write])).eligible) {
      throw new InitialRevisionEvidenceError('EVIDENCE_WRITE_TOO_LARGE');
    }
  }

  const batches: Readonly<InitialRevisionEvidenceBatch>[] = [];
  let current: PreparedInitialSourceLineageWrite[] = [];

  for (const write of writes) {
    const candidate = [...current, write];
    const assessment = assessAtomicPromotionWrites(asPromotionWrites(candidate));
    if (
      candidate.length > INITIAL_REVISION_EVIDENCE_WRITES_PER_TRANSACTION_LIMIT
      || !assessment.eligible
    ) {
      const currentAssessment = assessAtomicPromotionWrites(asPromotionWrites(current));
      batches.push(Object.freeze({
        writes: Object.freeze([...current]),
        totalEstimatedParameterBytes: currentAssessment.totalEstimatedParameterBytes,
      }));
      current = [write];
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) {
    const assessment = assessAtomicPromotionWrites(asPromotionWrites(current));
    batches.push(Object.freeze({
      writes: Object.freeze([...current]),
      totalEstimatedParameterBytes: assessment.totalEstimatedParameterBytes,
    }));
  }

  return Object.freeze(batches);
}

export async function executeInitialRevisionEvidenceBatches(
  adapter: YdbAdapter,
  batches: readonly InitialRevisionEvidenceBatch[],
): Promise<void> {
  for (const batch of batches) {
    if (batch.writes.length === 0) continue;
    const statement = buildRevisionEvidenceBatchStatement(batch.writes);
    await adapter.serializableReadWrite(async (transaction) => {
      if (statement !== null) {
        await transaction.execute(statement);
        return;
      }
      for (const write of batch.writes) {
        await transaction.execute(write.statement);
      }
    });
  }
}
