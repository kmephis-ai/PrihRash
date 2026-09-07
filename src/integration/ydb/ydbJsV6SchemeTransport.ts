import { anyUnpack } from '@bufbuild/protobuf/wkt';
import {
  OperationParams_OperationMode,
  StatusIds_StatusCode,
  type Operation,
} from '@ydbjs/api/operation';
import {
  Entry_Type,
  ListDirectoryResultSchema,
  SchemeServiceDefinition,
} from '@ydbjs/api/scheme';
import {
  CreateSessionResultSchema,
  TableServiceDefinition,
} from '@ydbjs/api/table';
import type { Driver } from '@ydbjs/core';
import {
  YdbSchemeTransportOutcomeUnknownError,
  type YdbSchemeDirectoryListing,
  type YdbSchemeEntryKind,
  type YdbSchemeTransport,
  type YdbTableCopyItem,
  type YdbTableRenameItem,
} from './scheme.js';

export type YdbJsV6SchemeProviderErrorCode =
  | 'SCHEME_PROVIDER_REJECTED'
  | 'SCHEME_PROVIDER_PROTOCOL_ERROR'
  | 'SCHEME_PROVIDER_READ_FAILED'
  | 'TABLE_SESSION_CREATE_FAILED';

export class YdbJsV6SchemeProviderError extends Error {
  readonly code: YdbJsV6SchemeProviderErrorCode;
  readonly status: number | null;
  override readonly cause: unknown;

  constructor(code: YdbJsV6SchemeProviderErrorCode, status: number | null = null, cause?: unknown) {
    super(status === null ? code : `${code}:${status}`);
    this.name = 'YdbJsV6SchemeProviderError';
    this.code = code;
    this.status = status;
    this.cause = cause;
  }
}

function databasePath(database: string, relativePath: string): string {
  const root = database.replace(/\/+$/u, '');
  if (!root.startsWith('/') || root.length < 2) {
    throw new YdbJsV6SchemeProviderError('SCHEME_PROVIDER_PROTOCOL_ERROR');
  }
  return relativePath.length === 0 ? root : `${root}/${relativePath}`;
}

function isUnknownStatus(status: StatusIds_StatusCode): boolean {
  return status === StatusIds_StatusCode.TIMEOUT || status === StatusIds_StatusCode.UNDETERMINED;
}

function requireMutationSuccess(operation: Operation | undefined): void {
  if (operation === undefined || operation.ready !== true) {
    throw new YdbSchemeTransportOutcomeUnknownError(
      new YdbJsV6SchemeProviderError('SCHEME_PROVIDER_PROTOCOL_ERROR'),
    );
  }
  if (operation.status === StatusIds_StatusCode.SUCCESS) return;
  if (isUnknownStatus(operation.status)) {
    throw new YdbSchemeTransportOutcomeUnknownError(
      new YdbJsV6SchemeProviderError('SCHEME_PROVIDER_REJECTED', operation.status),
    );
  }
  throw new YdbJsV6SchemeProviderError('SCHEME_PROVIDER_REJECTED', operation.status);
}

function requireReadSuccess(operation: Operation | undefined): Operation {
  if (operation === undefined || operation.ready !== true || operation.status !== StatusIds_StatusCode.SUCCESS) {
    throw new YdbJsV6SchemeProviderError('SCHEME_PROVIDER_READ_FAILED', operation?.status ?? null);
  }
  if (operation.result === undefined) {
    throw new YdbJsV6SchemeProviderError('SCHEME_PROVIDER_PROTOCOL_ERROR');
  }
  return operation;
}

function entryKind(type: Entry_Type): YdbSchemeEntryKind {
  if (type === Entry_Type.DATABASE) return 'DATABASE';
  if (type === Entry_Type.DIRECTORY) return 'DIRECTORY';
  if (type === Entry_Type.TABLE) return 'TABLE';
  return 'OTHER';
}

function requireSessionSuccess(operation: Operation | undefined): string {
  if (operation === undefined || operation.ready !== true || operation.status !== StatusIds_StatusCode.SUCCESS) {
    throw new YdbJsV6SchemeProviderError(
      'TABLE_SESSION_CREATE_FAILED',
      operation?.status ?? null,
    );
  }
  const result = operation.result === undefined
    ? undefined
    : anyUnpack(operation.result, CreateSessionResultSchema);
  if (result === undefined || result.sessionId.length === 0) {
    throw new YdbJsV6SchemeProviderError('SCHEME_PROVIDER_PROTOCOL_ERROR');
  }
  return result.sessionId;
}

export class YdbJsV6SchemeTransport implements YdbSchemeTransport {
  readonly #driver: Driver;

  constructor(driver: Driver) {
    this.#driver = driver;
  }

  async ensureDirectory(path: string): Promise<void> {
    const client = this.#driver.createClient(SchemeServiceDefinition);
    try {
      const response = await client.makeDirectory({
        operationParams: { operationMode: OperationParams_OperationMode.SYNC },
        path: databasePath(this.#driver.database, path),
      });
      requireMutationSuccess(response.operation);
    } catch (error) {
      if (error instanceof YdbJsV6SchemeProviderError || error instanceof YdbSchemeTransportOutcomeUnknownError) throw error;
      throw new YdbSchemeTransportOutcomeUnknownError(error);
    }
  }

  async listDirectory(path: string): Promise<Readonly<YdbSchemeDirectoryListing>> {
    const client = this.#driver.createClient(SchemeServiceDefinition);
    try {
      const response = await client.listDirectory({
        operationParams: { operationMode: OperationParams_OperationMode.SYNC },
        path: databasePath(this.#driver.database, path),
      });
      const operation = requireReadSuccess(response.operation);
      const result = anyUnpack(operation.result!, ListDirectoryResultSchema);
      if (result === undefined || result.self === undefined) {
        throw new YdbJsV6SchemeProviderError('SCHEME_PROVIDER_PROTOCOL_ERROR');
      }
      return Object.freeze({
        selfKind: entryKind(result.self.type),
        children: Object.freeze(result.children.map((child: { readonly name: string; readonly type: Entry_Type }) => Object.freeze({
          name: child.name,
          kind: entryKind(child.type),
        }))),
      });
    } catch (error) {
      if (error instanceof YdbJsV6SchemeProviderError) throw error;
      throw new YdbJsV6SchemeProviderError('SCHEME_PROVIDER_READ_FAILED', null, error);
    }
  }

  async copyTables(items: readonly Readonly<YdbTableCopyItem>[]): Promise<void> {
    const client = this.#driver.createClient(TableServiceDefinition);
    const createResponse = await client.createSession({ operationParams: { operationMode: OperationParams_OperationMode.SYNC } });
    const sessionId = requireSessionSuccess(createResponse.operation);
    try {
      try {
        const response = await client.copyTables({
          operationParams: { operationMode: OperationParams_OperationMode.SYNC },
          sessionId,
          tables: items.map((item) => ({
            sourcePath: databasePath(this.#driver.database, item.source),
            destinationPath: databasePath(this.#driver.database, item.destination),
            omitIndexes: item.omitIndexes,
          })),
        });
        requireMutationSuccess(response.operation);
      } catch (error) {
        if (error instanceof YdbJsV6SchemeProviderError || error instanceof YdbSchemeTransportOutcomeUnknownError) throw error;
        throw new YdbSchemeTransportOutcomeUnknownError(error);
      }
    } finally {
      try {
        await client.deleteSession({
          sessionId,
          operationParams: { operationMode: OperationParams_OperationMode.SYNC },
        });
      } catch {
        // Session cleanup is best-effort and must never overwrite an already-known mutation outcome.
      }
    }
  }

  async renameTables(items: readonly Readonly<YdbTableRenameItem>[]): Promise<void> {
    const client = this.#driver.createClient(TableServiceDefinition);
    const createResponse = await client.createSession({ operationParams: { operationMode: OperationParams_OperationMode.SYNC } });
    const sessionId = requireSessionSuccess(createResponse.operation);
    try {
      try {
        const response = await client.renameTables({
          operationParams: { operationMode: OperationParams_OperationMode.SYNC },
          sessionId,
          tables: items.map((item) => ({
            sourcePath: databasePath(this.#driver.database, item.source),
            destinationPath: databasePath(this.#driver.database, item.destination),
            replaceDestination: item.replace,
          })),
        });
        requireMutationSuccess(response.operation);
      } catch (error) {
        if (error instanceof YdbJsV6SchemeProviderError || error instanceof YdbSchemeTransportOutcomeUnknownError) throw error;
        throw new YdbSchemeTransportOutcomeUnknownError(error);
      }
    } finally {
      try {
        await client.deleteSession({
          sessionId,
          operationParams: { operationMode: OperationParams_OperationMode.SYNC },
        });
      } catch {
        // Session cleanup is best-effort and must never overwrite an already-known mutation outcome.
      }
    }
  }
}
