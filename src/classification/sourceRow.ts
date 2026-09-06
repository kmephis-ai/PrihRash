import type { LegacyPeriodCloseClassification } from './legacyPeriodClose.js';

export type SourceRowClassification =
  | 'FINANCIAL_RECORD'
  | 'LEGACY_PERIOD_CLOSE'
  | 'NON_FINANCIAL'
  | 'INVALID'
  | 'AMBIGUOUS';

export interface SourceRowClassificationInput {
  operationType: string | null;
  sourceDate: string | null;
  expenseAccount: string | null;
  expenseCategory: string | null;
  expenseAmountMinor: number | null;
  incomeAccount: string | null;
  incomeCategory: string | null;
  incomeAmountMinor: number | null;
  vikaFlag: string | null;
  description: string | null;
  note: string | null;
  legacyPeriodCloseClassification: LegacyPeriodCloseClassification;
}

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === '';
}

function hasFinancialStructure(input: SourceRowClassificationInput): boolean {
  return !isBlank(input.expenseAccount)
    || !isBlank(input.expenseCategory)
    || input.expenseAmountMinor !== null
    || !isBlank(input.incomeAccount)
    || !isBlank(input.incomeCategory)
    || input.incomeAmountMinor !== null
    || !isBlank(input.vikaFlag);
}

function classifyAmount(amountMinor: number | null): 'POSITIVE' | 'ZERO' | 'INVALID' {
  if (amountMinor === null || !Number.isSafeInteger(amountMinor) || amountMinor < 0) return 'INVALID';
  return amountMinor === 0 ? 'ZERO' : 'POSITIVE';
}

export function classifyMeaningfulSourceRow(
  input: SourceRowClassificationInput,
): SourceRowClassification {
  const operationType = input.operationType?.trim() ?? '';

  if (operationType === 'Расход') {
    const amount = classifyAmount(input.expenseAmountMinor);
    if (amount === 'POSITIVE') return 'FINANCIAL_RECORD';
    if (amount === 'INVALID') return 'INVALID';

    if (input.legacyPeriodCloseClassification === 'LEGACY_PERIOD_CLOSE') {
      return 'LEGACY_PERIOD_CLOSE';
    }

    // A zero expense can be a legacy service/control row. Without a proven
    // close cluster it must not be promoted to a Transaction or silently dropped.
    return 'AMBIGUOUS';
  }

  if (operationType === 'Доход') {
    const amount = classifyAmount(input.incomeAmountMinor);
    if (amount === 'POSITIVE') return 'FINANCIAL_RECORD';
    if (amount === 'INVALID') return 'INVALID';
    return 'AMBIGUOUS';
  }

  if (operationType !== '') return 'AMBIGUOUS';

  // A note-only legacy row with no date/description/financial fields is safe to
  // classify as non-financial. Any financial-looking structure without an
  // operation type remains ambiguous instead of inferring EXPENSE/INCOME.
  if (
    isBlank(input.sourceDate)
    && isBlank(input.description)
    && !hasFinancialStructure(input)
    && !isBlank(input.note)
  ) {
    return 'NON_FINANCIAL';
  }

  return 'AMBIGUOUS';
}
