import type { AdapterKey } from '../integration/google/sourceSchema.js';
import {
  isCanonicalGoogleNumberText,
  type SourceCellPayloadV2,
} from '../integration/google/sourceValueCodec.js';

export type RawPayloadV2 = Readonly<
  { adapter_schema_version: 2 }
  & Record<AdapterKey, SourceCellPayloadV2>
>;

export interface DecodedLegacyFinancialFields {
  readonly operationType: 'Расход' | 'Доход';
  readonly occurredOn: string;
  readonly amountMinor: number;
  readonly accountLabel: string | null;
  readonly categoryLabel: string | null;
  readonly description: string | null;
  readonly note: string | null;
  readonly vikaFlag: string | null;
}

export type RawPayloadDecodeErrorCode =
  | 'INVALID_PAYLOAD_SCHEMA'
  | 'UNRECOGNIZED_FINANCIAL_OPERATION_TYPE'
  | 'INVALID_DATE_CELL'
  | 'INVALID_DATE_SERIAL'
  | 'INVALID_AMOUNT_CELL'
  | 'INVALID_AMOUNT_DECIMAL'
  | 'INVALID_AMOUNT_SCALE'
  | 'AMOUNT_OUT_OF_RANGE'
  | 'INVALID_TEXT_CELL';

export type RawPayloadDecodeFailure = Readonly<{
  ok: false;
  errorCode: RawPayloadDecodeErrorCode;
  field: AdapterKey | 'adapter_schema_version';
}>;

export type RawPayloadDecodeResult =
  | Readonly<{ ok: true; value: Readonly<DecodedLegacyFinancialFields> }>
  | RawPayloadDecodeFailure;

type DecodeFieldResult<T> = Readonly<{ ok: true; value: T }> | RawPayloadDecodeFailure;

const CANONICAL_DECIMAL = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/;
const MAX_SHEETS_SERIAL_DAY = 2_958_465n;
const SHEETS_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

function failure(
  errorCode: RawPayloadDecodeErrorCode,
  field: AdapterKey | 'adapter_schema_version',
): RawPayloadDecodeFailure {
  return Object.freeze({ ok: false as const, errorCode, field });
}

function success<T>(value: T): Readonly<{ ok: true; value: T }> {
  return Object.freeze({ ok: true as const, value });
}

function decodeText(cell: SourceCellPayloadV2, field: AdapterKey): DecodeFieldResult<string | null> {
  if (cell === null) return success(null);
  if (cell.kind !== 'STRING') return failure('INVALID_TEXT_CELL', field);
  return success(cell.value);
}

function decodeOccurredOn(cell: SourceCellPayloadV2): DecodeFieldResult<string> {
  if (cell === null || cell.kind !== 'NUMBER') return failure('INVALID_DATE_CELL', 'date');
  if (!isCanonicalGoogleNumberText(cell.value)) return failure('INVALID_DATE_SERIAL', 'date');
  const match = CANONICAL_DECIMAL.exec(cell.value);
  if (match === null || match[1] === '-') return failure('INVALID_DATE_SERIAL', 'date');

  const serialDay = BigInt(match[2] ?? '0');
  if (serialDay > MAX_SHEETS_SERIAL_DAY) return failure('INVALID_DATE_SERIAL', 'date');

  const timestamp = SHEETS_EPOCH_UTC_MS + Number(serialDay) * DAY_MS;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return failure('INVALID_DATE_SERIAL', 'date');
  return success(date.toISOString().slice(0, 10));
}

function decodeAmountMinor(
  cell: SourceCellPayloadV2,
  field: 'expense_amount' | 'income_amount',
): DecodeFieldResult<number> {
  if (cell === null || cell.kind !== 'NUMBER') return failure('INVALID_AMOUNT_CELL', field);
  if (!isCanonicalGoogleNumberText(cell.value)) return failure('INVALID_AMOUNT_DECIMAL', field);
  const match = CANONICAL_DECIMAL.exec(cell.value);
  if (match === null) return failure('INVALID_AMOUNT_DECIMAL', field);

  const fraction = match[3] ?? '';
  if (fraction.length > 2) return failure('INVALID_AMOUNT_SCALE', field);

  const whole = BigInt(match[2] ?? '0');
  const fractionalMinor = BigInt(fraction.padEnd(2, '0') || '0');
  const sign = match[1] === '-' ? -1n : 1n;
  const minor = sign * (whole * 100n + fractionalMinor);

  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER)) {
    return failure('AMOUNT_OUT_OF_RANGE', field);
  }
  return success(Number(minor));
}

export function decodeLegacyFinancialRawPayload(payload: RawPayloadV2): RawPayloadDecodeResult {
  if (payload.adapter_schema_version !== 2) {
    return failure('INVALID_PAYLOAD_SCHEMA', 'adapter_schema_version');
  }

  const operation = decodeText(payload.operation_type, 'operation_type');
  if (!operation.ok) return operation;
  if (operation.value !== 'Расход' && operation.value !== 'Доход') {
    return failure('UNRECOGNIZED_FINANCIAL_OPERATION_TYPE', 'operation_type');
  }

  const occurredOn = decodeOccurredOn(payload.date);
  if (!occurredOn.ok) return occurredOn;

  const amountField = operation.value === 'Расход' ? 'expense_amount' : 'income_amount';
  const amountMinor = decodeAmountMinor(payload[amountField], amountField);
  if (!amountMinor.ok) return amountMinor;

  const accountField = operation.value === 'Расход' ? 'expense_account' : 'income_account';
  const categoryField = operation.value === 'Расход' ? 'expense_category' : 'income_category';
  const accountLabel = decodeText(payload[accountField], accountField);
  if (!accountLabel.ok) return accountLabel;
  const categoryLabel = decodeText(payload[categoryField], categoryField);
  if (!categoryLabel.ok) return categoryLabel;
  const description = decodeText(payload.description, 'description');
  if (!description.ok) return description;
  const note = decodeText(payload.note, 'note');
  if (!note.ok) return note;
  const vikaFlag = decodeText(payload.vika_flag, 'vika_flag');
  if (!vikaFlag.ok) return vikaFlag;

  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      operationType: operation.value,
      occurredOn: occurredOn.value,
      amountMinor: amountMinor.value,
      accountLabel: accountLabel.value,
      categoryLabel: categoryLabel.value,
      description: description.value,
      note: note.value,
      vikaFlag: vikaFlag.value,
    }),
  });
}
