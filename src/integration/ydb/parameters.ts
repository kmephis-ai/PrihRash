export type YdbParameterType =
  | 'Uuid'
  | 'Utf8'
  | 'String'
  | 'Int64'
  | 'Uint64'
  | 'Uint32'
  | 'Date'
  | 'Timestamp'
  | 'JsonDocument';

export type YdbParameterValue = string | bigint | number | null;

export interface YdbParameter {
  readonly type: YdbParameterType;
  readonly value: YdbParameterValue;
}

export type YdbParameterErrorCode =
  | 'INVALID_UUID'
  | 'INVALID_DATE'
  | 'INVALID_TIMESTAMP'
  | 'UNSAFE_INTEGER'
  | 'INT64_OUT_OF_RANGE'
  | 'UINT64_OUT_OF_RANGE'
  | 'UINT32_OUT_OF_RANGE'
  | 'INVALID_JSON_DOCUMENT';

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

function parameter(type: YdbParameterType, value: YdbParameterValue): YdbParameter {
  return Object.freeze({ type, value });
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

export function uuidParameter(value: string | null): YdbParameter {
  if (value === null) return parameter('Uuid', null);
  if (!UUID_PATTERN.test(value)) throw new YdbParameterError('INVALID_UUID');
  return parameter('Uuid', value.toLowerCase());
}

export function utf8Parameter(value: string | null): YdbParameter {
  return parameter('Utf8', value);
}

export function stringParameter(value: string | null): YdbParameter {
  return parameter('String', value);
}

export function int64Parameter(value: number | bigint | null): YdbParameter {
  if (value === null) return parameter('Int64', null);
  const normalized = toBigInt(value);
  if (normalized < INT64_MIN || normalized > INT64_MAX) {
    throw new YdbParameterError('INT64_OUT_OF_RANGE');
  }
  return parameter('Int64', normalized);
}

export function uint64Parameter(value: number | bigint | null): YdbParameter {
  if (value === null) return parameter('Uint64', null);
  const normalized = toBigInt(value);
  if (normalized < 0n || normalized > UINT64_MAX) {
    throw new YdbParameterError('UINT64_OUT_OF_RANGE');
  }
  return parameter('Uint64', normalized);
}

export function uint32Parameter(value: number | null): YdbParameter {
  if (value === null) return parameter('Uint32', null);
  if (!Number.isSafeInteger(value)) throw new YdbParameterError('UNSAFE_INTEGER');
  if (value < 0 || value > UINT32_MAX) throw new YdbParameterError('UINT32_OUT_OF_RANGE');
  return parameter('Uint32', value);
}

export function dateParameter(value: string | null): YdbParameter {
  if (value === null) return parameter('Date', null);
  const match = DATE_PATTERN.exec(value);
  if (match === null) throw new YdbParameterError('INVALID_DATE');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidCalendarDate(year, month, day)) throw new YdbParameterError('INVALID_DATE');
  return parameter('Date', value);
}

export function timestampParameter(value: string | null): YdbParameter {
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

export function jsonDocumentParameter(value: string | null): YdbParameter {
  if (value === null) return parameter('JsonDocument', null);
  try {
    JSON.parse(value);
  } catch {
    throw new YdbParameterError('INVALID_JSON_DOCUMENT');
  }
  return parameter('JsonDocument', value);
}
