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
  sourceDatePresent?: boolean;
  expenseAccount: string | null;
  expenseCategory: string | null;
  expenseAmountMinor: number | null;
  expenseAmountPresent?: boolean;
  incomeAccount: string | null;
  incomeCategory: string | null;
  incomeAmountMinor: number | null;
  incomeAmountPresent?: boolean;
  vikaFlag: string | null;
  description: string | null;
  note: string | null;
  legacyPeriodCloseClassification: LegacyPeriodCloseClassification;
}

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === '';
}

function isPresent(explicitPresence: boolean | undefined, fallbackPresent: boolean): boolean {
  return explicitPresence ?? fallbackPresent;
}

function hasFinancialStructure(input: SourceRowClassificationInput): boolean {
  return !isBlank(input.expenseAccount)
    || !isBlank(input.expenseCategory)
    || isPresent(input.expenseAmountPresent, input.expenseAmountMinor !== null)
    || !isBlank(input.incomeAccount)
    || !isBlank(input.incomeCategory)
    || isPresent(input.incomeAmountPresent, input.incomeAmountMinor !== null)
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

    return 'AMBIGUOUS';
  }

  if (operationType === 'Доход') {
    const amount = classifyAmount(input.incomeAmountMinor);
    if (amount === 'POSITIVE') return 'FINANCIAL_RECORD';
    if (amount === 'INVALID') return 'INVALID';
    return 'AMBIGUOUS';
  }

  if (operationType !== '') return 'AMBIGUOUS';

  const sourceDatePresent = isPresent(input.sourceDatePresent, !isBlank(input.sourceDate));
  if (
    !sourceDatePresent
    && isBlank(input.description)
    && !hasFinancialStructure(input)
    && !isBlank(input.note)
  ) {
    return 'NON_FINANCIAL';
  }

  return 'AMBIGUOUS';
}
