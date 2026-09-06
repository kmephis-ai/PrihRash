import { analyticsStateFromNote } from './common.js';
import type { LegacyFinancialCandidate, NormalizationResult, ReferenceResolver } from './types.js';

const EXPENSE_ACCOUNT_VOCABULARY = new Set(['Карта Visa', 'Карта Credit', 'Наличка']);

export function normalizeExpense(
  source: LegacyFinancialCandidate,
  refs: ReferenceResolver,
): NormalizationResult {
  if (source.operationType !== 'Расход') return { ok: false, errorCode: 'SOURCE_OPERATION_TYPE_MISMATCH' };
  if (!Number.isSafeInteger(source.amountMinor) || source.amountMinor <= 0) {
    return { ok: false, errorCode: 'INVALID_AMOUNT' };
  }
  if (source.accountLabel === null || source.accountLabel === '') return { ok: false, errorCode: 'MISSING_ACCOUNT' };
  if (!EXPENSE_ACCOUNT_VOCABULARY.has(source.accountLabel)) return { ok: false, errorCode: 'UNKNOWN_ACCOUNT' };
  const accountId = refs.resolveAccountId(source.accountLabel);
  if (accountId === null) return { ok: false, errorCode: 'UNKNOWN_ACCOUNT' };

  if (source.categoryLabel === null || source.categoryLabel.trim() === '') {
    return { ok: false, errorCode: 'MISSING_CATEGORY' };
  }
  const categoryId = refs.resolveCategoryId('EXPENSE', source.categoryLabel);
  if (categoryId === null) return { ok: false, errorCode: 'UNKNOWN_CATEGORY' };

  if (source.vikaFlag !== null && source.vikaFlag !== '' && source.vikaFlag !== 'Да') {
    return { ok: false, errorCode: 'UNKNOWN_VIKA_FLAG' };
  }

  return {
    ok: true,
    transaction: {
      type: 'EXPENSE',
      occurredOn: source.occurredOn,
      recordGranularity: source.recordGranularity,
      datePrecision: source.datePrecision,
      aggregatePeriodMonth: source.aggregatePeriodMonth,
      financialPeriodId: null,
      periodAssignmentQuality: 'UNASSIGNED',
      amountMinor: source.amountMinor,
      currency: 'RUB',
      fromAccountId: accountId,
      toAccountId: null,
      categoryId,
      paidByMemberId: source.vikaFlag === 'Да' ? refs.vikaMemberId : null,
      description: source.description,
      note: source.note,
      status: 'POSTED',
      analyticsState: analyticsStateFromNote(source.note),
      flowKind: null,
    },
  };
}
