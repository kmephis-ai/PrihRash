export type InitialReferenceAccountKind = 'CASH' | 'DEBIT_CARD' | 'CREDIT_CARD' | 'UNKNOWN';
export type InitialReferenceAccountBalanceNature = 'ASSET' | 'LIABILITY' | 'UNKNOWN';

export interface InitialReferenceAccountSemantics {
  readonly kind: InitialReferenceAccountKind;
  readonly balanceNature: InitialReferenceAccountBalanceNature;
}

export const INITIAL_REFERENCE_ACTIVE_STATUS = 'ACTIVE';
export const INITIAL_REFERENCE_VIKA_MEMBER_NAME = 'Вика';

const ACCOUNT_SEMANTICS: Readonly<Record<string, Readonly<InitialReferenceAccountSemantics>>> = Object.freeze({
  'Карта Visa': Object.freeze({ kind: 'DEBIT_CARD', balanceNature: 'ASSET' }),
  'Карта Credit': Object.freeze({ kind: 'CREDIT_CARD', balanceNature: 'LIABILITY' }),
  'Наличка': Object.freeze({ kind: 'CASH', balanceNature: 'ASSET' }),
  'Приход': Object.freeze({ kind: 'UNKNOWN', balanceNature: 'UNKNOWN' }),
});

export function initialReferenceAccountSemantics(
  sourceLabel: string,
): Readonly<InitialReferenceAccountSemantics> | null {
  return ACCOUNT_SEMANTICS[sourceLabel] ?? null;
}
