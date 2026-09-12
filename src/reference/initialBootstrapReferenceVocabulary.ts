import { classifySourceSnapshot } from '../migration/sourceSnapshotClassification.js';
import {
  decodeLegacyFinancialRawPayload,
  type RawPayload,
} from '../migration/rawPayloadDecoder.js';
import {
  accountBootstrapKey,
  categoryBootstrapKey,
  normalizeSourceLabel,
  type CategoryKind,
} from './bootstrap.js';

export interface InitialReferenceBootstrapObservationRow {
  readonly sourceOrdinal: number;
  readonly rawPayload: RawPayload;
}

export interface InitialReferenceBootstrapExpectedAccount {
  readonly sourceLabel: string;
}

export interface InitialReferenceBootstrapExpectedCategory {
  readonly kind: CategoryKind;
  readonly sourceLabel: string;
}

export type InitialReferenceBootstrapVocabularyErrorCode =
  | 'SOURCE_CLASSIFICATION_DECODE_MISMATCH'
  | 'UNKNOWN_ACCOUNT_VOCABULARY';

export class InitialReferenceBootstrapVocabularyError extends Error {
  readonly code: InitialReferenceBootstrapVocabularyErrorCode;

  constructor(code: InitialReferenceBootstrapVocabularyErrorCode) {
    super(code);
    this.name = 'InitialReferenceBootstrapVocabularyError';
    this.code = code;
  }
}

const EXPENSE_ACCOUNT_VOCABULARY = new Set(['Карта Visa', 'Карта Credit', 'Наличка']);
const INCOME_ACCOUNT_VOCABULARY = new Set(['Карта Visa', 'Наличка', 'Карта Credit', 'Приход']);

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function categoryKind(operationType: 'Расход' | 'Доход'): CategoryKind {
  return operationType === 'Расход' ? 'EXPENSE' : 'INCOME';
}

function assertKnownAccount(operationType: 'Расход' | 'Доход', sourceLabel: string): void {
  const vocabulary = operationType === 'Расход'
    ? EXPENSE_ACCOUNT_VOCABULARY
    : INCOME_ACCOUNT_VOCABULARY;
  if (!vocabulary.has(sourceLabel)) {
    throw new InitialReferenceBootstrapVocabularyError('UNKNOWN_ACCOUNT_VOCABULARY');
  }
}

export function deriveInitialReferenceBootstrapVocabulary(
  rows: readonly Readonly<InitialReferenceBootstrapObservationRow>[],
): Readonly<{
  accounts: readonly Readonly<InitialReferenceBootstrapExpectedAccount>[];
  categories: readonly Readonly<InitialReferenceBootstrapExpectedCategory>[];
}> {
  const classification = classifySourceSnapshot(rows.map((row) => Object.freeze({
    sourceOrdinal: row.sourceOrdinal,
    rawPayload: row.rawPayload,
  })));
  const accountByKey = new Map<string, Readonly<InitialReferenceBootstrapExpectedAccount>>();
  const categoryByKey = new Map<string, Readonly<InitialReferenceBootstrapExpectedCategory>>();

  classification.outcomes.forEach((outcome, index) => {
    if (outcome.classification !== 'FINANCIAL_RECORD') return;
    const row = rows[index];
    if (row === undefined || row.sourceOrdinal !== outcome.sourceOrdinal) {
      throw new InitialReferenceBootstrapVocabularyError('SOURCE_CLASSIFICATION_DECODE_MISMATCH');
    }
    const decoded = decodeLegacyFinancialRawPayload(row.rawPayload);
    if (!decoded.ok) {
      throw new InitialReferenceBootstrapVocabularyError('SOURCE_CLASSIFICATION_DECODE_MISMATCH');
    }

    const accountLabel = decoded.value.accountLabel;
    if (accountLabel !== null && accountLabel !== '') {
      assertKnownAccount(decoded.value.operationType, accountLabel);
      const normalized = normalizeSourceLabel(accountLabel);
      accountByKey.set(accountBootstrapKey(normalized), Object.freeze({ sourceLabel: normalized }));
    }

    const categoryLabel = decoded.value.categoryLabel;
    if (categoryLabel !== null) {
      const normalized = normalizeSourceLabel(categoryLabel);
      if (normalized.length > 0) {
        const kind = categoryKind(decoded.value.operationType);
        categoryByKey.set(
          categoryBootstrapKey(kind, normalized),
          Object.freeze({ kind, sourceLabel: normalized }),
        );
      }
    }
  });

  return Object.freeze({
    accounts: Object.freeze([...accountByKey.values()]
      .sort((left, right) => compareText(left.sourceLabel, right.sourceLabel))),
    categories: Object.freeze([...categoryByKey.values()]
      .sort((left, right) => compareText(left.kind, right.kind)
        || compareText(left.sourceLabel, right.sourceLabel))),
  });
}
