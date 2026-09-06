export const SOURCE_SHEET_NAME = 'Ответы на форму (11)';

export const EXPECTED_SOURCE_HEADERS = [
  ' Дата',
  'Тип операции',
  'Счет',
  'Категория',
  'Наименование',
  'Сумма',
  'Счет',
  'Источник',
  'Сумма',
  'Вика',
  'Примечание',
] as const;

export const ADAPTER_KEYS = [
  'date',
  'operation_type',
  'expense_account',
  'expense_category',
  'description',
  'expense_amount',
  'income_account',
  'income_category',
  'income_amount',
  'vika_flag',
  'note',
] as const;

export type AdapterKey = (typeof ADAPTER_KEYS)[number];

export interface SchemaVerificationResult {
  ok: boolean;
  errorCode: 'SOURCE_SCHEMA_MISMATCH' | null;
  mismatches: Array<{ position: number; expected: string; actual: string | null }>;
}

export function verifySourceHeaders(headers: readonly string[]): SchemaVerificationResult {
  const mismatches: SchemaVerificationResult['mismatches'] = [];
  const width = Math.max(headers.length, EXPECTED_SOURCE_HEADERS.length);

  for (let index = 0; index < width; index += 1) {
    const expected = EXPECTED_SOURCE_HEADERS[index] ?? null;
    const actual = headers[index] ?? null;
    if (expected !== actual) {
      mismatches.push({
        position: index + 1,
        expected: expected ?? '<no column>',
        actual,
      });
    }
  }

  return {
    ok: mismatches.length === 0,
    errorCode: mismatches.length === 0 ? null : 'SOURCE_SCHEMA_MISMATCH',
    mismatches,
  };
}

export type RecognizedOperationType = 'EXPENSE' | 'INCOME';

export function recognizeOperationType(value: string | null): RecognizedOperationType | null {
  if (value === 'Расход') return 'EXPENSE';
  if (value === 'Доход') return 'INCOME';
  return null;
}
