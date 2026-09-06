export interface YdbTableCopyItem {
  readonly source: string;
  readonly destination: string;
  readonly omitIndexes: boolean;
}

export interface YdbTableRenameItem {
  readonly source: string;
  readonly destination: string;
  readonly replace: boolean;
}

export interface YdbSchemeTransport {
  ensureDirectory(path: string): Promise<void>;
  copyTables(items: readonly Readonly<YdbTableCopyItem>[]): Promise<void>;
  renameTables(items: readonly Readonly<YdbTableRenameItem>[]): Promise<void>;
}

export type YdbSchemeErrorCode =
  | 'INVALID_SCHEME_PATH'
  | 'EMPTY_SCHEME_OPERATION'
  | 'DUPLICATE_SCHEME_SOURCE'
  | 'DUPLICATE_SCHEME_DESTINATION'
  | 'SCHEME_OPERATION_OUTCOME_UNKNOWN';

export class YdbSchemeError extends Error {
  readonly code: YdbSchemeErrorCode;
  override readonly cause: unknown;

  constructor(code: YdbSchemeErrorCode, cause?: unknown) {
    super(code);
    this.name = 'YdbSchemeError';
    this.code = code;
    this.cause = cause;
  }
}

export class YdbSchemeTransportOutcomeUnknownError extends Error {
  readonly code = 'TRANSPORT_SCHEME_OPERATION_OUTCOME_UNKNOWN' as const;
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super('TRANSPORT_SCHEME_OPERATION_OUTCOME_UNKNOWN');
    this.name = 'YdbSchemeTransportOutcomeUnknownError';
    this.cause = cause;
  }
}

// PrihRash scheme operations intentionally use a narrow relative-path vocabulary.
// Provider-generic arbitrary identifiers do not cross this boundary.
const SAFE_PATH_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

function validatePath(path: string): void {
  if (!SAFE_PATH_PATTERN.test(path)) throw new YdbSchemeError('INVALID_SCHEME_PATH');
}

function validateUniqueItems<T extends { readonly source: string; readonly destination: string }>(
  items: readonly T[],
): void {
  if (items.length === 0) throw new YdbSchemeError('EMPTY_SCHEME_OPERATION');
  const sources = new Set<string>();
  const destinations = new Set<string>();
  for (const item of items) {
    validatePath(item.source);
    validatePath(item.destination);
    if (sources.has(item.source)) throw new YdbSchemeError('DUPLICATE_SCHEME_SOURCE');
    if (destinations.has(item.destination)) throw new YdbSchemeError('DUPLICATE_SCHEME_DESTINATION');
    sources.add(item.source);
    destinations.add(item.destination);
  }
}

function freezeCopyItems(items: readonly Readonly<YdbTableCopyItem>[]): readonly Readonly<YdbTableCopyItem>[] {
  validateUniqueItems(items);
  return Object.freeze(items.map((item) => Object.freeze({
    source: item.source,
    destination: item.destination,
    omitIndexes: item.omitIndexes,
  })));
}

function freezeRenameItems(items: readonly Readonly<YdbTableRenameItem>[]): readonly Readonly<YdbTableRenameItem>[] {
  validateUniqueItems(items);
  return Object.freeze(items.map((item) => Object.freeze({
    source: item.source,
    destination: item.destination,
    replace: item.replace,
  })));
}

export class YdbSchemeAdapter {
  readonly #transport: YdbSchemeTransport;

  constructor(transport: YdbSchemeTransport) {
    this.#transport = transport;
  }

  async ensureDirectory(path: string): Promise<void> {
    validatePath(path);
    await this.#execute(() => this.#transport.ensureDirectory(path));
  }

  async copyTables(items: readonly Readonly<YdbTableCopyItem>[]): Promise<void> {
    const frozen = freezeCopyItems(items);
    await this.#execute(() => this.#transport.copyTables(frozen));
  }

  async renameTables(items: readonly Readonly<YdbTableRenameItem>[]): Promise<void> {
    const frozen = freezeRenameItems(items);
    await this.#execute(() => this.#transport.renameTables(frozen));
  }

  async #execute(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      if (error instanceof YdbSchemeTransportOutcomeUnknownError) {
        throw new YdbSchemeError('SCHEME_OPERATION_OUTCOME_UNKNOWN', error.cause);
      }
      throw error;
    }
  }
}
