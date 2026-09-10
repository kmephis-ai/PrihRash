import type { AdapterKey } from '../integration/google/sourceSchema.js';
import type { SourceFinancialRevision } from './changeClassification.js';
import {
  decodeRawPayloadAmountMinor,
  isSupportedAdapterSchemaVersion,
  decodeRawPayloadOccurredOn,
  decodeRawPayloadTextCell,
  type RawPayloadDecodeErrorCode,
  type RawPayload,
} from './rawPayloadDecoder.js';

export type SourceFinancialRevisionProjectionErrorCode = RawPayloadDecodeErrorCode;

export class SourceFinancialRevisionProjectionError extends Error {
  readonly code: SourceFinancialRevisionProjectionErrorCode;
  readonly field: AdapterKey | 'adapter_schema_version';

  constructor(code: SourceFinancialRevisionProjectionErrorCode, field: AdapterKey | 'adapter_schema_version') {
    super(`${code}:${field}`);
    this.name = 'SourceFinancialRevisionProjectionError';
    this.code = code;
    this.field = field;
  }
}

function valueOrThrow<T>(
  result: Readonly<{ ok: true; value: T }> | Readonly<{
    ok: false;
    errorCode: RawPayloadDecodeErrorCode;
    field: AdapterKey | 'adapter_schema_version';
  }>,
): T {
  if (!result.ok) throw new SourceFinancialRevisionProjectionError(result.errorCode, result.field);
  return result.value;
}

function nullableAmount(
  payload: RawPayload,
  field: 'expense_amount' | 'income_amount',
): number | null {
  if (payload[field] === null) return null;
  return valueOrThrow(decodeRawPayloadAmountMinor(payload[field], field));
}

function nullableSourceDate(payload: RawPayload): string | null {
  if (payload.date === null) return null;
  return valueOrThrow(decodeRawPayloadOccurredOn(payload.date));
}

export function projectSourceFinancialRevision(
  payload: RawPayload,
): Readonly<SourceFinancialRevision> {
  if (!isSupportedAdapterSchemaVersion(payload.adapter_schema_version)) {
    throw new SourceFinancialRevisionProjectionError('INVALID_PAYLOAD_SCHEMA', 'adapter_schema_version');
  }

  return Object.freeze({
    operationType: valueOrThrow(decodeRawPayloadTextCell(payload.operation_type, 'operation_type')),
    sourceDate: nullableSourceDate(payload),
    expenseAccount: valueOrThrow(decodeRawPayloadTextCell(payload.expense_account, 'expense_account')),
    expenseCategory: valueOrThrow(decodeRawPayloadTextCell(payload.expense_category, 'expense_category')),
    expenseAmountMinor: nullableAmount(payload, 'expense_amount'),
    incomeAccount: valueOrThrow(decodeRawPayloadTextCell(payload.income_account, 'income_account')),
    incomeCategory: valueOrThrow(decodeRawPayloadTextCell(payload.income_category, 'income_category')),
    incomeAmountMinor: nullableAmount(payload, 'income_amount'),
    description: valueOrThrow(decodeRawPayloadTextCell(payload.description, 'description')),
    vikaFlag: valueOrThrow(decodeRawPayloadTextCell(payload.vika_flag, 'vika_flag')),
    note: valueOrThrow(decodeRawPayloadTextCell(payload.note, 'note')),
  });
}
