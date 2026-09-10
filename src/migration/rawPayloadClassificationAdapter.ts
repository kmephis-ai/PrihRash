import type { SourceRowClassificationInput } from '../classification/sourceRow.js';
import type { LegacyPeriodCloseSourceRow } from '../classification/legacyPeriodClose.js';
import type { SourceCellPayloadV2 } from '../integration/google/sourceValueCodec.js';
import {
  decodeRawPayloadAmountMinor,
  isSupportedAdapterSchemaVersion,
  decodeRawPayloadOccurredOn,
  decodeRawPayloadTextCell,
  type RawPayloadDecodeFailure,
  type RawPayload,
} from './rawPayloadDecoder.js';

export interface DecodedSourceClassificationFields {
  readonly operationType: string | null;
  readonly sourceDate: string | null;
  readonly sourceDatePresent: boolean;
  readonly expenseAccount: string | null;
  readonly expenseCategory: string | null;
  readonly expenseAmountMinor: number | null;
  readonly expenseAmountPresent: boolean;
  readonly incomeAccount: string | null;
  readonly incomeCategory: string | null;
  readonly incomeAmountMinor: number | null;
  readonly incomeAmountPresent: boolean;
  readonly vikaFlag: string | null;
  readonly description: string | null;
  readonly note: string | null;
}

export type SourceClassificationDecodeResult =
  | Readonly<{ ok: true; value: Readonly<DecodedSourceClassificationFields> }>
  | RawPayloadDecodeFailure;

function decodeOptionalAmount(
  cell: SourceCellPayloadV2,
  field: 'expense_amount' | 'income_amount',
): Readonly<{ ok: true; amountMinor: number | null; present: boolean }> | RawPayloadDecodeFailure {
  if (cell === null) return Object.freeze({ ok: true as const, amountMinor: null, present: false });
  if (cell.kind === 'STRING') {
    return Object.freeze({ ok: true as const, amountMinor: null, present: true });
  }
  const decoded = decodeRawPayloadAmountMinor(cell, field);
  if (!decoded.ok) return decoded;
  return Object.freeze({ ok: true as const, amountMinor: decoded.value, present: true });
}

export function decodeRawPayloadForSourceClassification(
  payload: RawPayload,
): SourceClassificationDecodeResult {
  if (!isSupportedAdapterSchemaVersion(payload.adapter_schema_version)) {
    return Object.freeze({
      ok: false as const,
      errorCode: 'INVALID_PAYLOAD_SCHEMA' as const,
      field: 'adapter_schema_version' as const,
    });
  }

  const operationType = decodeRawPayloadTextCell(payload.operation_type, 'operation_type');
  if (!operationType.ok) return operationType;
  const expenseAccount = decodeRawPayloadTextCell(payload.expense_account, 'expense_account');
  if (!expenseAccount.ok) return expenseAccount;
  const expenseCategory = decodeRawPayloadTextCell(payload.expense_category, 'expense_category');
  if (!expenseCategory.ok) return expenseCategory;
  const incomeAccount = decodeRawPayloadTextCell(payload.income_account, 'income_account');
  if (!incomeAccount.ok) return incomeAccount;
  const incomeCategory = decodeRawPayloadTextCell(payload.income_category, 'income_category');
  if (!incomeCategory.ok) return incomeCategory;
  const vikaFlag = decodeRawPayloadTextCell(payload.vika_flag, 'vika_flag');
  if (!vikaFlag.ok) return vikaFlag;
  const description = decodeRawPayloadTextCell(payload.description, 'description');
  if (!description.ok) return description;
  const note = decodeRawPayloadTextCell(payload.note, 'note');
  if (!note.ok) return note;

  let sourceDate: string | null = null;
  const sourceDatePresent = payload.date !== null;
  if (payload.date !== null) {
    const decodedDate = decodeRawPayloadOccurredOn(payload.date);
    if (!decodedDate.ok) return decodedDate;
    sourceDate = decodedDate.value;
  }

  const expenseAmount = decodeOptionalAmount(payload.expense_amount, 'expense_amount');
  if (!expenseAmount.ok) return expenseAmount;
  const incomeAmount = decodeOptionalAmount(payload.income_amount, 'income_amount');
  if (!incomeAmount.ok) return incomeAmount;

  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      operationType: operationType.value,
      sourceDate,
      sourceDatePresent,
      expenseAccount: expenseAccount.value,
      expenseCategory: expenseCategory.value,
      expenseAmountMinor: expenseAmount.amountMinor,
      expenseAmountPresent: expenseAmount.present,
      incomeAccount: incomeAccount.value,
      incomeCategory: incomeCategory.value,
      incomeAmountMinor: incomeAmount.amountMinor,
      incomeAmountPresent: incomeAmount.present,
      vikaFlag: vikaFlag.value,
      description: description.value,
      note: note.value,
    }),
  });
}

export function toLegacyPeriodCloseSourceRow(
  snapshotOrdinal: number,
  fields: Readonly<DecodedSourceClassificationFields>,
): LegacyPeriodCloseSourceRow {
  return {
    snapshotOrdinal,
    sourceDay: fields.sourceDate,
    operationType: fields.operationType,
    expenseAccount: fields.expenseAccount,
    expenseAmountMinor: fields.expenseAmountMinor,
    description: fields.description,
  };
}

export function toSourceRowClassificationInput(
  fields: Readonly<DecodedSourceClassificationFields>,
  legacyPeriodCloseClassification: SourceRowClassificationInput['legacyPeriodCloseClassification'],
): SourceRowClassificationInput {
  return {
    operationType: fields.operationType,
    sourceDate: fields.sourceDate,
    sourceDatePresent: fields.sourceDatePresent,
    expenseAccount: fields.expenseAccount,
    expenseCategory: fields.expenseCategory,
    expenseAmountMinor: fields.expenseAmountMinor,
    expenseAmountPresent: fields.expenseAmountPresent,
    incomeAccount: fields.incomeAccount,
    incomeCategory: fields.incomeCategory,
    incomeAmountMinor: fields.incomeAmountMinor,
    incomeAmountPresent: fields.incomeAmountPresent,
    vikaFlag: fields.vikaFlag,
    description: fields.description,
    note: fields.note,
    legacyPeriodCloseClassification,
  };
}
