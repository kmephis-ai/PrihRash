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

export interface YdbTransportTransaction {
  execute<Row = Readonly<Record<string, unknown>>>(statement: YdbStatement): Promise<YdbQueryResult<Row>>;
}

export interface YdbTransport {
  executeRead<Row = Readonly<Record<string, unknown>>>(statement: YdbStatement): Promise<YdbQueryResult<Row>>;
  serializableReadWrite<T>(work: (transaction: YdbTransportTransaction) => Promise<T>): Promise<T>;
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

export class YdbTransportCommitOutcomeUnknownError extends Error {
  readonly code = 'TRANSPORT_COMMIT_OUTCOME_UNKNOWN' as const;
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super('TRANSPORT_COMMIT_OUTCOME_UNKNOWN');
    this.name = 'YdbTransportCommitOutcomeUnknownError';
    this.cause = cause;
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
    try {
      return await this.#transport.serializableReadWrite(async (transportTransaction) => {
        const transaction = Object.freeze({
          execute: <Row = Readonly<Record<string, unknown>>>(statement: YdbStatement) => (
            transportTransaction.execute<Row>(statement)
          ),
        });
        return work(transaction);
      });
    } catch (error) {
      if (error instanceof YdbTransportCommitOutcomeUnknownError) {
        throw new YdbCommitOutcomeUnknownError(error.cause);
      }
      throw error;
    }
  }
}
