export type YdbScalarParameterType =
  | 'Uuid'
  | 'Utf8'
  | 'String'
  | 'Int64'
  | 'Uint64'
  | 'Uint32'
  | 'Date'
  | 'Timestamp'
  | 'JsonDocument';

export type YdbScalarParameterValue = string | bigint | number | null;

export interface YdbScalarParameter {
  readonly type: YdbScalarParameterType;
  readonly value: YdbScalarParameterValue;
}

export interface YdbListStructColumn {
  readonly name: string;
  readonly type: YdbScalarParameterType;
  readonly nullable: boolean;
}

export interface YdbListStructParameter {
  readonly type: 'ListStruct';
  readonly value: Readonly<{
    readonly columns: readonly Readonly<YdbListStructColumn>[];
    readonly rows: readonly Readonly<Record<string, YdbScalarParameter>>[];
  }>;
}

export type YdbParameter = YdbScalarParameter | YdbListStructParameter;
export type YdbParameterType = YdbParameter['type'];
export type YdbParameterValue = YdbParameter['value'];

export type YdbParameterErrorCode =
  | 'INVALID_UUID'
  | 'INVALID_DATE'
  | 'INVALID_TIMESTAMP'
  | 'UNSAFE_INTEGER'
  | 'INT64_OUT_OF_RANGE'
  | 'UINT64_OUT_OF_RANGE'
  | 'UINT32_OUT_OF_RANGE'
  | 'INVALID_JSON_DOCUMENT'
  | 'INVALID_LIST_STRUCT_PARAMETER';

export class YdbParameterError extends Error {
  readonly code: YdbParameterErrorCode;

  constructor(code: YdbParameterErrorCode) {
    super(code);
    this.name = 'YdbParameterError';
    this.code = code;
  }
}

const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT32_MAX = 4_294_967_295;
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const UTC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/;

function parameter(
  type: YdbScalarParameterType,
  value: YdbScalarParameterValue,
): YdbScalarParameter {
  return Object.freeze({ type, value });
}

const STRUCT_FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function listStructParameter(
  columns: readonly Readonly<YdbListStructColumn>[],
  rows: readonly Readonly<Record<string, YdbScalarParameter>>[],
): YdbListStructParameter {
  if (columns.length === 0 || rows.length === 0) {
    throw new YdbParameterError('INVALID_LIST_STRUCT_PARAMETER');
  }

  const names = new Set<string>();
  for (const column of columns) {
    if (
      !STRUCT_FIELD_PATTERN.test(column.name)
      || names.has(column.name)
      || typeof column.nullable !== 'boolean'
    ) {
      throw new YdbParameterError('INVALID_LIST_STRUCT_PARAMETER');
    }
    names.add(column.name);
  }

  const expectedNames = [...names].sort();
  const normalizedRows = rows.map((row) => {
    const actualNames = Object.keys(row).sort();
    if (
      actualNames.length !== expectedNames.length
      || actualNames.some((name, index) => name !== expectedNames[index])
    ) {
      throw new YdbParameterError('INVALID_LIST_STRUCT_PARAMETER');
    }

    const normalized: Record<string, YdbScalarParameter> = {};
    for (const column of columns) {
      const cell = row[column.name];
      if (
        cell === undefined
        || cell.type !== column.type
        || (cell.value === null && !column.nullable)
      ) {
        throw new YdbParameterError('INVALID_LIST_STRUCT_PARAMETER');
      }
      normalized[column.name] = cell;
    }
    return Object.freeze(normalized);
  });

  return Object.freeze({
    type: 'ListStruct' as const,
    value: Object.freeze({
      columns: Object.freeze(columns.map((column) => Object.freeze({ ...column }))),
      rows: Object.freeze(normalizedRows),
    }),
  });
}

function toBigInt(value: number | bigint): bigint {
  if (typeof value === 'bigint') return value;
  if (!Number.isSafeInteger(value)) throw new YdbParameterError('UNSAFE_INTEGER');
  return BigInt(value);
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1970 || year > 2105) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
  );
}

export function uuidParameter(value: string | null): YdbScalarParameter {
  if (value === null) return parameter('Uuid', null);
  if (!UUID_PATTERN.test(value)) throw new YdbParameterError('INVALID_UUID');
  return parameter('Uuid', value.toLowerCase());
}

export function utf8Parameter(value: string | null): YdbScalarParameter {
  return parameter('Utf8', value);
}

export function stringParameter(value: string | null): YdbScalarParameter {
  return parameter('String', value);
}

export function int64Parameter(value: number | bigint | null): YdbScalarParameter {
  if (value === null) return parameter('Int64', null);
  const normalized = toBigInt(value);
  if (normalized < INT64_MIN || normalized > INT64_MAX) {
    throw new YdbParameterError('INT64_OUT_OF_RANGE');
  }
  return parameter('Int64', normalized);
}

export function uint64Parameter(value: number | bigint | null): YdbScalarParameter {
  if (value === null) return parameter('Uint64', null);
  const normalized = toBigInt(value);
  if (normalized < 0n || normalized > UINT64_MAX) {
    throw new YdbParameterError('UINT64_OUT_OF_RANGE');
  }
  return parameter('Uint64', normalized);
}

export function uint32Parameter(value: number | null): YdbScalarParameter {
  if (value === null) return parameter('Uint32', null);
  if (!Number.isSafeInteger(value)) throw new YdbParameterError('UNSAFE_INTEGER');
  if (value < 0 || value > UINT32_MAX) throw new YdbParameterError('UINT32_OUT_OF_RANGE');
  return parameter('Uint32', value);
}

export function dateParameter(value: string | null): YdbScalarParameter {
  if (value === null) return parameter('Date', null);
  const match = DATE_PATTERN.exec(value);
  if (match === null) throw new YdbParameterError('INVALID_DATE');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidCalendarDate(year, month, day)) throw new YdbParameterError('INVALID_DATE');
  return parameter('Date', value);
}

export function timestampParameter(value: string | null): YdbScalarParameter {
  if (value === null) return parameter('Timestamp', null);
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  if (match === null) throw new YdbParameterError('INVALID_TIMESTAMP');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (
    !isValidCalendarDate(year, month, day)
    || hour > 23
    || minute > 59
    || second > 59
  ) {
    throw new YdbParameterError('INVALID_TIMESTAMP');
  }

  return parameter('Timestamp', value);
}

export function jsonDocumentParameter(value: string | null): YdbScalarParameter {
  if (value === null) return parameter('JsonDocument', null);
  try {
    JSON.parse(value);
  } catch {
    throw new YdbParameterError('INVALID_JSON_DOCUMENT');
  }
  return parameter('JsonDocument', value);
}
