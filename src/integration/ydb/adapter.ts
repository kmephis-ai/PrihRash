import type { YdbParameter } from './parameters.js';

export type YdbStatementKind = 'READ' | 'WRITE';

export interface YdbStatement {
  readonly kind: YdbStatementKind;
  readonly text: string;
  readonly parameters: Readonly<Record<string, YdbParameter>>;
}

export interface YdbQueryResult<Row = Readonly<Record<string, unknown>>> {
  readonly rows: readonly Row[];
}

export interface YdbTransactionHandle {
  execute<Row = Readonly<Record<string, unknown>>>(statement: YdbStatement): Promise<YdbQueryResult<Row>>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface YdbTransport {
  executeRead<Row = Readonly<Record<string, unknown>>>(statement: YdbStatement): Promise<YdbQueryResult<Row>>;
  beginSerializableReadWrite(): Promise<YdbTransactionHandle>;
}

export interface YdbTransaction {
  execute<Row = Readonly<Record<string, unknown>>>(statement: YdbStatement): Promise<YdbQueryResult<Row>>;
}

export type YdbAdapterErrorCode = 'WRITE_REQUIRES_TRANSACTION' | 'COMMIT_OUTCOME_UNKNOWN';

export class YdbAdapterError extends Error {
  readonly code: YdbAdapterErrorCode;

  constructor(code: YdbAdapterErrorCode) {
    super(code);
    this.name = 'YdbAdapterError';
    this.code = code;
  }
}

export class YdbCommitOutcomeUnknownError extends Error {
  readonly code = 'COMMIT_OUTCOME_UNKNOWN' as const;
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super('COMMIT_OUTCOME_UNKNOWN');
    this.name = 'YdbCommitOutcomeUnknownError';
    this.cause = cause;
  }
}

function freezeParameters(parameters: Readonly<Record<string, YdbParameter>>): Readonly<Record<string, YdbParameter>> {
  return Object.freeze({ ...parameters });
}

export function readStatement(
  text: string,
  parameters: Readonly<Record<string, YdbParameter>> = {},
): YdbStatement {
  return Object.freeze({ kind: 'READ' as const, text, parameters: freezeParameters(parameters) });
}

export function writeStatement(
  text: string,
  parameters: Readonly<Record<string, YdbParameter>> = {},
): YdbStatement {
  return Object.freeze({ kind: 'WRITE' as const, text, parameters: freezeParameters(parameters) });
}

export class YdbAdapter {
  readonly #transport: YdbTransport;

  constructor(transport: YdbTransport) {
    this.#transport = transport;
  }

  async read<Row = Readonly<Record<string, unknown>>>(statement: YdbStatement): Promise<YdbQueryResult<Row>> {
    if (statement.kind !== 'READ') throw new YdbAdapterError('WRITE_REQUIRES_TRANSACTION');
    return this.#transport.executeRead<Row>(statement);
  }

  async serializableReadWrite<T>(work: (transaction: YdbTransaction) => Promise<T>): Promise<T> {
    const handle = await this.#transport.beginSerializableReadWrite();
    const transaction = Object.freeze({
      execute: <Row = Readonly<Record<string, unknown>>>(statement: YdbStatement) => handle.execute<Row>(statement),
    });

    let result: T;
    try {
      result = await work(transaction);
    } catch (error) {
      try {
        await handle.rollback();
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'YDB_TRANSACTION_ROLLBACK_FAILED');
      }
      throw error;
    }

    try {
      await handle.commit();
    } catch (error) {
      throw new YdbCommitOutcomeUnknownError(error);
    }
    return result;
  }
}
