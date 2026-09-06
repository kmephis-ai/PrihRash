export type SourceCellPayloadV2 =
  | null
  | Readonly<{ kind: 'STRING'; value: string }>
  | Readonly<{ kind: 'NUMBER'; value: string }>;

export interface GoogleExtendedValueInput {
  readonly numberValue?: unknown;
  readonly stringValue?: unknown;
  readonly formulaValue?: unknown;
  readonly boolValue?: unknown;
  readonly errorValue?: unknown;
}

export type SourceValueCodecErrorCode =
  | 'MULTIPLE_SOURCE_CELL_VALUES'
  | 'UNSUPPORTED_SOURCE_CELL_VALUE'
  | 'FORMULA_SOURCE_CELL_NOT_ALLOWED'
  | 'NON_FINITE_SOURCE_NUMBER';

export class SourceValueCodecError extends Error {
  readonly code: SourceValueCodecErrorCode;

  constructor(code: SourceValueCodecErrorCode) {
    super(code);
    this.name = 'SourceValueCodecError';
    this.code = code;
  }
}

function expandExponentialDecimal(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(value);
  if (match === null) return value;

  const sign = match[1] ?? '';
  const integerDigits = match[2] ?? '';
  const fractionalDigits = match[3] ?? '';
  const exponent = Number(match[4]);
  const digits = `${integerDigits}${fractionalDigits}`;
  const decimalPosition = integerDigits.length + exponent;

  if (decimalPosition <= 0) {
    return `${sign}0.${'0'.repeat(-decimalPosition)}${digits}`;
  }
  if (decimalPosition >= digits.length) {
    return `${sign}${digits}${'0'.repeat(decimalPosition - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
}

export function canonicalizeGoogleNumberValue(value: number): string {
  if (!Number.isFinite(value)) {
    throw new SourceValueCodecError('NON_FINITE_SOURCE_NUMBER');
  }
  if (Object.is(value, -0)) return '0';
  return expandExponentialDecimal(value.toString());
}

export function isCanonicalGoogleNumberText(value: string): boolean {
  if (value === '-0') return false;
  return /^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(value);
}

function normalizeSourceText(value: string): string {
  return value.replace(/\r\n?/g, '\n').normalize('NFC');
}

export function encodeGoogleExtendedValue(value: GoogleExtendedValueInput | null | undefined): SourceCellPayloadV2 {
  if (value === null || value === undefined) return null;

  const present = [
    ['numberValue', value.numberValue],
    ['stringValue', value.stringValue],
    ['formulaValue', value.formulaValue],
    ['boolValue', value.boolValue],
    ['errorValue', value.errorValue],
  ].filter(([, candidate]) => candidate !== undefined);

  if (present.length === 0) return null;
  if (present.length !== 1) {
    throw new SourceValueCodecError('MULTIPLE_SOURCE_CELL_VALUES');
  }

  const [kind, candidate] = present[0] as [string, unknown];
  if (kind === 'formulaValue') {
    throw new SourceValueCodecError('FORMULA_SOURCE_CELL_NOT_ALLOWED');
  }
  if (kind === 'numberValue') {
    if (typeof candidate !== 'number') {
      throw new SourceValueCodecError('UNSUPPORTED_SOURCE_CELL_VALUE');
    }
    return Object.freeze({ kind: 'NUMBER' as const, value: canonicalizeGoogleNumberValue(candidate) });
  }
  if (kind === 'stringValue') {
    if (typeof candidate !== 'string') {
      throw new SourceValueCodecError('UNSUPPORTED_SOURCE_CELL_VALUE');
    }
    return Object.freeze({ kind: 'STRING' as const, value: normalizeSourceText(candidate) });
  }

  throw new SourceValueCodecError('UNSUPPORTED_SOURCE_CELL_VALUE');
}
