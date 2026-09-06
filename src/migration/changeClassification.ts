export type SourceChangeClass =
  | 'NO_CHANGE'
  | 'WORKFLOW_TRANSFORM'
  | 'OWNER_CORRECTION'
  | 'AMBIGUOUS_CHANGE';

export type SourceFinancialField =
  | 'operationType'
  | 'sourceDate'
  | 'expenseAccount'
  | 'expenseCategory'
  | 'expenseAmountMinor'
  | 'incomeAccount'
  | 'incomeCategory'
  | 'incomeAmountMinor'
  | 'description'
  | 'vikaFlag'
  | 'note';

export interface SourceFinancialRevision {
  operationType: string | null;
  sourceDate: string | null;
  expenseAccount: string | null;
  expenseCategory: string | null;
  expenseAmountMinor: number | null;
  incomeAccount: string | null;
  incomeCategory: string | null;
  incomeAmountMinor: number | null;
  description: string | null;
  vikaFlag: string | null;
  note: string | null;
}

export interface LegacyCloseContextEvidence {
  preCloseObservationProven: boolean;
  inJustClosedWorkingSetProven: boolean;
  closeClusterDetected: boolean;
  observedAfterClose: boolean;
  batchCleanupPatternConfirmed: boolean;
}

export interface SourceChangeClassificationResult {
  changeClass: SourceChangeClass;
  changedFields: SourceFinancialField[];
  preservePreviousFields: SourceFinancialField[];
}

const SOURCE_FIELDS: readonly SourceFinancialField[] = [
  'operationType',
  'sourceDate',
  'expenseAccount',
  'expenseCategory',
  'expenseAmountMinor',
  'incomeAccount',
  'incomeCategory',
  'incomeAmountMinor',
  'description',
  'vikaFlag',
  'note',
];

function changedFields(
  previous: SourceFinancialRevision,
  current: SourceFinancialRevision,
): SourceFinancialField[] {
  return SOURCE_FIELDS.filter((field) => previous[field] !== current[field]);
}

function isPositiveToNonPositive(previous: number | null, current: number | null): boolean {
  return previous !== null && previous > 0 && (current === null || current <= 0);
}

function hasStructuralDanger(
  previous: SourceFinancialRevision,
  current: SourceFinancialRevision,
): boolean {
  if (previous.operationType !== current.operationType) return true;

  if (previous.operationType === 'Расход') {
    return isPositiveToNonPositive(previous.expenseAmountMinor, current.expenseAmountMinor);
  }

  if (previous.operationType === 'Доход') {
    return isPositiveToNonPositive(previous.incomeAmountMinor, current.incomeAmountMinor);
  }

  return false;
}

function isKnownAccountCleanup(previous: string | null, current: string | null): boolean {
  return (
    (previous === 'Карта Credit' || previous === 'Наличка')
    && current === 'Карта Visa'
  );
}

function isKnownVikaCleanup(previous: string | null, current: string | null): boolean {
  return previous === 'Да' && current === null;
}

function cleanupCompatibleChangedFields(
  previous: SourceFinancialRevision,
  current: SourceFinancialRevision,
  fields: readonly SourceFinancialField[],
): SourceFinancialField[] {
  const compatible: SourceFinancialField[] = [];

  if (
    fields.includes('expenseAccount')
    && isKnownAccountCleanup(previous.expenseAccount, current.expenseAccount)
  ) {
    compatible.push('expenseAccount');
  }

  if (
    fields.includes('vikaFlag')
    && isKnownVikaCleanup(previous.vikaFlag, current.vikaFlag)
  ) {
    compatible.push('vikaFlag');
  }

  return compatible;
}

function closeEvidenceValues(context: LegacyCloseContextEvidence): boolean[] {
  return [
    context.preCloseObservationProven,
    context.inJustClosedWorkingSetProven,
    context.closeClusterDetected,
    context.observedAfterClose,
    context.batchCleanupPatternConfirmed,
  ];
}

export function classifySourceRevisionChange(
  previous: SourceFinancialRevision,
  current: SourceFinancialRevision,
  context: LegacyCloseContextEvidence,
): SourceChangeClassificationResult {
  const fields = changedFields(previous, current);
  if (fields.length === 0) {
    return { changeClass: 'NO_CHANGE', changedFields: [], preservePreviousFields: [] };
  }

  if (hasStructuralDanger(previous, current)) {
    return {
      changeClass: 'AMBIGUOUS_CHANGE',
      changedFields: fields,
      preservePreviousFields: [],
    };
  }

  const cleanupFields = cleanupCompatibleChangedFields(previous, current, fields);
  const hasCleanupTransition = cleanupFields.length > 0;
  const allChangesAreCleanup = hasCleanupTransition && cleanupFields.length === fields.length;
  const evidence = closeEvidenceValues(context);
  const fullCloseContext = evidence.every(Boolean);
  const anyCloseContext = evidence.some(Boolean);

  if (allChangesAreCleanup && fullCloseContext) {
    return {
      changeClass: 'WORKFLOW_TRANSFORM',
      changedFields: fields,
      preservePreviousFields: cleanupFields,
    };
  }

  if (hasCleanupTransition && anyCloseContext) {
    return {
      changeClass: 'AMBIGUOUS_CHANGE',
      changedFields: fields,
      preservePreviousFields: [],
    };
  }

  return {
    changeClass: 'OWNER_CORRECTION',
    changedFields: fields,
    preservePreviousFields: [],
  };
}
