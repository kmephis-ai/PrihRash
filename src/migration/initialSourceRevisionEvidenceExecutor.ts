import { YdbAdapter, writeStatement, type YdbStatement } from '../integration/ydb/adapter.js';
import {
  listStructParameter,
  type YdbListStructColumn,
  type YdbScalarParameter,
} from '../integration/ydb/parameters.js';
import {
  PRELIVE_PROMOTION_QUERY_BYTES_LIMIT,
  assessAtomicPromotionWrites,
  type PromotionWrite,
} from './atomicPromotion.js';
import type { PreparedInitialSourceLineageWrite } from './initialSourceLineagePersistence.js';

// Initial evidence keeps the calibrated 512 KiB transaction parameter boundary,
// but no longer adds an unrelated 50-row cap. The exact initial INSERT is transported
// as one List<Struct> table parameter, so YQL text stays constant while earlier committed
// batches remain independently resumable after a later failure.
const REVISION_TABLE_COLUMNS = Object.freeze([
  Object.freeze({ name: 'source_record_id', type: 'Uuid', nullable: false }),
  Object.freeze({ name: 'revision', type: 'Uint64', nullable: false }),
  Object.freeze({ name: 'migration_run_id', type: 'Uuid', nullable: true }),
  Object.freeze({ name: 'observed_at', type: 'Timestamp', nullable: true }),
  Object.freeze({ name: 'row_hint', type: 'Uint64', nullable: true }),
  Object.freeze({ name: 'row_digest', type: 'String', nullable: true }),
  Object.freeze({ name: 'change_class', type: 'Utf8', nullable: true }),
  Object.freeze({ name: 'raw_payload', type: 'JsonDocument', nullable: true }),
] satisfies readonly YdbListStructColumn[]);
const REVISION_COLUMNS = REVISION_TABLE_COLUMNS.map((column) => column.name);
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
): statement is Readonly<YdbStatement> & { readonly parameters: Readonly<Record<string, YdbScalarParameter>> } {
  const actual = Object.keys(statement.parameters).sort();
  const expected = [...REVISION_COLUMNS].sort();
  if (
    actual.length !== expected.length
    || actual.some((name, index) => name !== expected[index])
  ) {
    return false;
  }
  return REVISION_TABLE_COLUMNS.every((column) => {
    const parameter = statement.parameters[column.name];
    return parameter !== undefined
      && parameter.type !== 'ListStruct'
      && parameter.type === column.type;
  });
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

  const rows = writes.map((write) => {
    const row: Record<string, YdbScalarParameter> = {};
    for (const column of REVISION_TABLE_COLUMNS) {
      const parameter = write.statement.parameters[column.name];
      if (parameter === undefined || parameter.type === 'ListStruct') {
        throw new InitialRevisionEvidenceError('EVIDENCE_WRITE_SHAPE_INVALID');
      }
      row[column.name] = parameter;
    }
    return Object.freeze(row);
  });

  const statement = writeStatement(
    `INSERT INTO source_record_revisions (${REVISION_COLUMN_LIST}) `
      + `SELECT ${REVISION_COLUMN_LIST} FROM AS_TABLE($rows)`,
    { rows: listStructParameter(REVISION_TABLE_COLUMNS, rows) },
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
    if (!assessment.eligible) {
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
